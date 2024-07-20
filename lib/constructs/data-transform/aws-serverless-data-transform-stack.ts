import { NestedStack } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as path from 'path';
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";

import { AwsServerlessDataTransformStackProps } from "./AwsServerlessDataTransformStackProps";
import { OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LlrtFunction } from "cdk-lambda-llrt";
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";

/**
 * @class AwsServerlessDataTransformStack
 * @extends {NestedStack}
 * @description This class represents a nested stack for AWS Serverless Data Transform infrastructure.
 * It sets up S3 buckets, SNS topics, SQS queues, and Lambda functions to handle file uploads and transformations.
 */
export class AwsServerlessDataTransformStack extends NestedStack {
    /**
     * @constructor
     * @param {Construct} scope - The scope in which to define this construct.
     * @param {string} id - The scoped construct ID.
     * @param {AwsServerlessDataTransformStackProps} props - Properties for configuring the stack.
     * @throws {Error} Throws an error if required properties are missing.
     */
    constructor(scope: Construct, id: string, props: AwsServerlessDataTransformStackProps) {
        super(scope, id);

        // Retrieve the master S3 bucket and PDF files bucket
        const s3MasterFilesBucket = s3.Bucket.fromBucketName(this, 's3MasterFilesBucket', props.masterBucketName);
        const s3PdfFilesBucket = s3.Bucket.fromBucketName(this, 's3PdfFilesBucket', props.pfdFilesBucketName);

        /**
         * @type {sns.Topic}
         * @description SNS topic for file upload notifications.
         */
        const s3FileUploadSnsTopic: sns.Topic = new sns.Topic(this, 's3FileUploadSnsTopic', {
            topicName: `${props.resourcePrefix}-s3-file-upload-topic`,
            displayName: 'S3 File Upload Notifications',
            fifo: false, // Standard SNS topic for better scalability
        });

        /**
         * @type {sqs.Queue}
         * @description SQS queue for PDF file processing.
         */
        const s3PdfFileUploadQueue: sqs.Queue = new sqs.Queue(this, 's3PdfFileUploadQueue', {
            queueName: `${props.resourcePrefix}-pdf-file-upload-queue`,
            visibilityTimeout: cdk.Duration.seconds(300), // 5 minutes
            retentionPeriod: cdk.Duration.days(14),
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        /**
         * @type {sqs.Queue}
         * @description SQS queue for image file processing.
         */
        const s3ImageFileUploadQueue: sqs.Queue = new sqs.Queue(this, 's3ImageFileUploadQueue', {
            queueName: `${props.resourcePrefix}-image-file-upload-queue`,
            visibilityTimeout: cdk.Duration.seconds(300), // 5 minutes
            retentionPeriod: cdk.Duration.days(14),
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Subscribe SQS queues to SNS topic with message filtering
        s3FileUploadSnsTopic.addSubscription(new subscriptions.SqsSubscription(s3PdfFileUploadQueue, {
            filterPolicy: {
                fileExtension: sns.SubscriptionFilter.stringFilter({
                    allowlist: ['.pdf'],
                }),
            },
        }));

        s3FileUploadSnsTopic.addSubscription(new subscriptions.SqsSubscription(s3ImageFileUploadQueue, {
            filterPolicy: {
                fileExtension: sns.SubscriptionFilter.stringFilter({
                    allowlist: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff'],
                }),
            },
        }));

        // Configure S3 bucket to send notifications to SNS topic
        s3MasterFilesBucket.addEventNotification(
            s3.EventType.OBJECT_CREATED,
            new s3n.SnsDestination(s3FileUploadSnsTopic),
        );

        /**
         * @type {LlrtFunction}
         * @description Lambda function for S3 object transfer.
         */
        const s3ObjectTransferLambdaFn: LlrtFunction = new LlrtFunction(this, `${props.resourcePrefix}-s3ObjectTransferLambdaFn`, {
            functionName: `${props.resourcePrefix}-s3ObjectTransferLambdaFn`,
            runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../../../src/lambdas/s3-file-transfer/index.ts'),
            handler: 'handler',
            llrtVersion: 'latest',
            timeout: cdk.Duration.seconds(60), // one minute
            architecture: lambda.Architecture.ARM_64,
            runtimeManagementMode: lambda.RuntimeManagementMode.AUTO,
            logGroup: new cdk.aws_logs.LogGroup(this, `${props.resourcePrefix}-s3ObjectTransferLambdaFnLogGroup`, {
                logGroupName: `${props.resourcePrefix}-s3ObjectTransferLambdaFnLogGroup`,
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
            projectRoot: path.join(__dirname, '../../../src/lambdas/s3-file-transfer'),
            depsLockFilePath: path.join(__dirname, '../../../src/lambdas/s3-file-transfer/package-lock.json'),
        });

        /**
         * @type {PythonFunction}
         * @description Lambda function for file transformation.
         */
        const fileTransformLambdaFn: PythonFunction = new PythonFunction(this, `${props.resourcePrefix}-fileTransformLambdaFn`, {
            functionName: `${props.resourcePrefix}-fileTransformLambdaFn`,
            runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
            entry: path.join(__dirname, '../../../src/lambdas/s3-file-transform'),
            handler: "handler",
            architecture: lambda.Architecture.ARM_64,
            runtimeManagementMode: lambda.RuntimeManagementMode.AUTO,
            memorySize: 1024,
            timeout: cdk.Duration.seconds(60), // 60 seconds
            logGroup: new cdk.aws_logs.LogGroup(this, `${props.resourcePrefix}-fileTransformLambdaFnLogGroup`, {
                logGroupName: `${props.resourcePrefix}-fileTransformLambdaFnLogGroup`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
            }),
        });

        // Grant necessary permissions
        s3MasterFilesBucket.grantRead(s3ObjectTransferLambdaFn);
        s3PdfFilesBucket.grantWrite(s3ObjectTransferLambdaFn);

        s3MasterFilesBucket.grantRead(fileTransformLambdaFn);
        s3PdfFilesBucket.grantWrite(fileTransformLambdaFn);

        s3PdfFileUploadQueue.grantConsumeMessages(s3ObjectTransferLambdaFn);
        s3ImageFileUploadQueue.grantConsumeMessages(fileTransformLambdaFn);

        // grant permission for s3PdfFileUploadQueue to invoke s3ObjectTransferLambdaFn
        s3ObjectTransferLambdaFn.addPermission('AllowSQSInvocation', {
            action: 'lambda:InvokeFunction',
            principal: new iam.ServicePrincipal('sqs.amazonaws.com'),
            sourceArn: s3PdfFileUploadQueue.queueArn,
        });

        // Add the SQS queue as an event source for the s3ObjectTransferLambdaFn function
        s3ObjectTransferLambdaFn.addEventSource(new lambdaEventSources.SqsEventSource(s3PdfFileUploadQueue, {
            batchSize: 10, // Set the batch size to 10
            reportBatchItemFailures: true, // Allow functions to return partially successful responses for a batch of records.
            enabled: true,
            maxBatchingWindow: cdk.Duration.seconds(60), // 60 seconds
        }));

        // grant permission for s3ImageFileUploadQueue to invoke fileTransformLambdaFn
        fileTransformLambdaFn.addPermission('AllowSQSInvocation', {
            action: 'lambda:InvokeFunction',
            principal: new iam.ServicePrincipal('sqs.amazonaws.com'),
            sourceArn: s3ImageFileUploadQueue.queueArn,
        });

        // Add the SQS queue as an event source for the fileTransformLambdaFn function
        fileTransformLambdaFn.addEventSource(new lambdaEventSources.SqsEventSource(s3ImageFileUploadQueue, {
            batchSize: 10, // Set the batch size to 10
            reportBatchItemFailures: true, // Allow functions to return partially successful responses for a batch of records.
            enabled: true,
            maxBatchingWindow: cdk.Duration.seconds(60), // 60 seconds
        }));
    }
}
