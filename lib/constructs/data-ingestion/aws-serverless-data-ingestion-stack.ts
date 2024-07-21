import { NestedStack } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as cdk from "aws-cdk-lib";
import * as path from "path";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import { AwsServerlessDataIngestionStackProps } from "./AwsServerlessDataIngestionStackProps";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";

export class AwsServerlessDataIngestionStack extends NestedStack {
    /**
     * @constructor
     * @param {Construct} scope - The scope in which to define this construct.
     * @param {string} id - The scoped construct ID.
     * @param {AwsServerlessDataIngestionStackProps} props - Properties for configuring the stack.
     * @throws {Error} Throws an error if required properties are missing.
     */
    constructor(scope: Construct, id: string, props: AwsServerlessDataIngestionStackProps) {
        super(scope, id);

        const pfdFilesBucket = s3.Bucket.fromBucketName(this, `${props.resourcePrefix}-pfdFilesBucketName`, props.pfdFilesBucketName);
        const jsonFilesBucket = s3.Bucket.fromBucketName(this, `${props.resourcePrefix}-jsonFilesBucketName`, props.jsonFilesBucketName);

        const textAnalysisQueue = new sqs.Queue(this, `${props.resourcePrefix}-textAnalysisQueue`, {
            visibilityTimeout: cdk.Duration.seconds(60), // 60 seconds
            queueName: `${props.resourcePrefix}-textAnalysisQueue`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: cdk.Duration.days(3), // 3 days
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // create an SQS queue for receiving Textract job completion notifications
        const textAnalysisResultQueue = new sqs.Queue(this, `${props.resourcePrefix}-textAnalysisResultQueue`, {
            visibilityTimeout: cdk.Duration.seconds(60), // one minute
            queueName: `${props.resourcePrefix}-textAnalysisResultQueue`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: cdk.Duration.days(3), // 3 days
            deliveryDelay: cdk.Duration.seconds(20), // wait 20 seconds for OCR to complete before processing
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // define a dead letter queue
        const textAnalysisResultQueueDLQ = new sqs.Queue(this, `${props.resourcePrefix}-textAnalysisResultQueueDLQ`, {
            visibilityTimeout: cdk.Duration.hours(12), // 12 hours
            retentionPeriod: cdk.Duration.days(3), // 3 days
            queueName: `${props.resourcePrefix}-textAnalysisResultQueueDLQ`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Define an IAM role for Amazon Textract service to access pfdFilesBucket
        const textractServiceRole = new iam.Role(this, `${props.resourcePrefix}-TextractServiceRole`, {
            assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonTextractFullAccess'),
            ],
            roleName: `${props.resourcePrefix}-TextractServiceRole`,
            description: 'IAM role for Amazon Textract service to access S3 buckets.',
        });

        // Grant Textract service role permissions to getObject and getObjectAcl from pfdFilesBucket
        pfdFilesBucket.grantRead(textractServiceRole);

        // lambda function to start a Textract job for analyzing tables in a document
        const textAnalysisLambdaFn = new NodejsFunction(this, `${props.resourcePrefix}-textAnalysisLambdaFn`, {
            runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../../../src/lambdas/textract-table-analysis/create-request-queue/index.ts'),
            handler: 'handler',
            environment: {
                TEXTRACT_RESULT_QUEUE_URL: textAnalysisResultQueue.queueUrl,
                TEXTRACT_QUEUE_URL: textAnalysisQueue.queueUrl,
            },
            timeout: cdk.Duration.seconds(60), // 60 seconds
            architecture: lambda.Architecture.ARM_64,
            logGroup: new cdk.aws_logs.LogGroup(this, `${props.resourcePrefix}-textAnalysisLambdaFnLogGroup`, {
                logGroupName: `${props.resourcePrefix}-textAnalysisLambdaFnLogGroup`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
            }),
            memorySize: 1024,
            bundling: {
                minify: true,
                sourceMap: true,
                sourcesContent: false,
                esbuildVersion: '0.23.0',
                target: 'ES2022',
                format: OutputFormat.ESM,
                forceDockerBundling: true,
            },
            projectRoot: path.join(__dirname, '../../../src/lambdas/textract-table-analysis/create-request-queue'),
            depsLockFilePath: path.join(__dirname, '../../../src/lambdas/textract-table-analysis/create-request-queue/package-lock.json'),
            role: new cdk.aws_iam.Role(this, `${props.resourcePrefix}-textAnalysisLambdaFnInlineRole`, {
                assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    // define the role for listObject, putObject, and deleteObject permissions from s3TextCachedBucket
                    s3PdfCachedBucketPolicy: new cdk.aws_iam.PolicyDocument({
                        statements: [
                            new cdk.aws_iam.PolicyStatement({
                                actions: ['textract:AnalyzeDocument', 'textract:StartDocumentAnalysis', 'textract:StartDocumentTextDetection'],
                                resources: ['*'], // Assuming Textract does not support resource-level permissions
                            }),
                        ],
                    }),
                },
            }),
        });

        // lambda function to receive and process Textract job completion notifications
        const textAnalysisResultLambdaFn = new NodejsFunction(this, `${props.resourcePrefix}-textAnalysisResultLambdaFn`, {
            runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../../../src/lambdas/textract-table-analysis/receive-textract-result/index.ts'),
            handler: 'handler',
            environment: {
                S3_JSON_FILES_BUCKET_NAME: jsonFilesBucket.bucketName,
                TEXTRACT_RESULT_QUEUE_URL: textAnalysisResultQueue.queueUrl,
                TEXTRACT_RESULT_DLQ_QUEUE_URL: textAnalysisResultQueueDLQ.queueUrl,
            },
            timeout: cdk.Duration.seconds(60), // 60 seconds
            architecture: lambda.Architecture.ARM_64,
            logGroup: new cdk.aws_logs.LogGroup(this, `${props.resourcePrefix}-textAnalysisResultLambdaFn-LogGroup`, {
                logGroupName: `${props.resourcePrefix}-textAnalysisResultLambdaFn-LogGroup`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
            }),
            memorySize: 1024,
            bundling: {
                minify: true,
                sourceMap: true,
                sourcesContent: false,
                esbuildVersion: '0.23.0',
                target: 'ES2022',
                format: OutputFormat.ESM,
                forceDockerBundling: true,
            },
            projectRoot: path.join(__dirname, '../../../src/lambdas/textract-table-analysis/receive-textract-result'),
            depsLockFilePath: path.join(__dirname, '../../../src/lambdas/textract-table-analysis/receive-textract-result/package-lock.json'),
            role: new cdk.aws_iam.Role(this, `${props.resourcePrefix}-textAnalysisResultLambdaFnInlineRole`, {
                assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    // define the role for listObject, putObject, and deleteObject permissions from s3TextCachedBucket
                    s3TextCachedBucketPolicy: new cdk.aws_iam.PolicyDocument({
                        statements: [
                            new cdk.aws_iam.PolicyStatement({
                                actions: ['textract:GetDocumentAnalysis', 'textract:GetDocumentTextDetection'],
                                resources: ['*'], // Assuming Textract does not support resource-level permissions
                            }),
                        ],
                    }),
                },
            }),
        });

        // grant permission for textractResultQueue to invoke textAnalysisResultLambdaFn
        textAnalysisResultLambdaFn.addPermission(`${props.resourcePrefix}-textAnalysisResultLambdaFn-AllowSQSInvocation`, {
            action: 'lambda:InvokeFunction',
            principal: new iam.ServicePrincipal('sqs.amazonaws.com'),
            sourceArn: textAnalysisResultQueue.queueArn,
        });

        // Add the SQS queue as an event source for the textAnalysisResultLambdaFn function
        textAnalysisResultLambdaFn.addEventSource(new lambdaEventSources.SqsEventSource(textAnalysisResultQueue, {
            batchSize: 10, // Set the batch size to 1
            reportBatchItemFailures: true, // Allow functions to return partially successful responses for a batch of records.
            enabled: true,
            maxBatchingWindow: cdk.Duration.seconds(60), // 60 seconds
        }));

        // grant permission for textractResultQueue to invoke textAnalysisLambdaFn
        textAnalysisLambdaFn.addPermission(`${props.resourcePrefix}-textAnalysisLambdaFn-AllowSQSInvocation`, {
            action: 'lambda:InvokeFunction',
            principal: new iam.ServicePrincipal('sqs.amazonaws.com'),
            sourceArn: textAnalysisQueue.queueArn,
        });

        // Add the SQS queue as an event source for the textAnalysisLambdaFn function
        textAnalysisLambdaFn.addEventSource(new lambdaEventSources.SqsEventSource(textAnalysisQueue, {
            batchSize: 10, // Set the batch size to 10
            reportBatchItemFailures: true, // Allow functions to return partially successful responses for a batch of records.
            enabled: true,
            maxBatchingWindow: cdk.Duration.seconds(60), // 60 seconds
        }));

        // Configure S3 event notifications to send a message to textAnalysisQueue when a new object is created
        pfdFilesBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(textAnalysisQueue));

        // Grant sqs message consumming for textAnalysisLambdaFn
        textAnalysisQueue.grantConsumeMessages(textAnalysisLambdaFn);

        // Grant sqs message consumming for textAnalysisResultLambdaFn
        textAnalysisResultQueue.grantSendMessages(textAnalysisLambdaFn);

        // Grant sqs message consumming for textAnalysisResultLambdaFn
        textAnalysisResultQueue.grantConsumeMessages(textAnalysisResultLambdaFn);

        // Grant sqs message consumming for textAnalysisResultLambdaFn to dead letter queue
        textAnalysisResultQueueDLQ.grantSendMessages(textAnalysisResultLambdaFn);

        // Grant permisson for textAnalysisLambdaFn to read object from pfdFilesBucket
        pfdFilesBucket.grantRead(textAnalysisLambdaFn);

        // Grant permisson for textAnalysisResultLambdaFn to write object to jsonFilesBucket
        jsonFilesBucket.grantWrite(textAnalysisResultLambdaFn);
    }
}
