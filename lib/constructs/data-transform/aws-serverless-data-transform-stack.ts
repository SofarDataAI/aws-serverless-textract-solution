import { NestedStack } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as path from 'path';
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";

import { AwsServerlessDataTransformStackProps } from "./AwsServerlessDataTransformStackProps";
import { OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LlrtFunction } from "cdk-lambda-llrt";
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";

export class AwsServerlessDataTransformStack extends NestedStack {
    constructor(scope: Construct, id: string, props: AwsServerlessDataTransformStackProps) {
        super(scope, id);

        // retreive the master S3 bucket and PDF files bucket
        const s3MasterFilesBucket = s3.Bucket.fromBucketName(this, 's3MasterFilesBucket', props.masterBucketName);
        const s3PdfFilesBucket = s3.Bucket.fromBucketName(this, 's3PdfFilesBucket', props.pfdFilesBucketName);

        // todo define sqs named s3PdfFileUploadQueue
        // todo define sqs named s3ImageFileUploadQueue

        // todo define sns with file extension filter, named s3FileUploadSnsTopic

        const s3ObjectTransferLambdaFn = new LlrtFunction(this, `${props.resourcePrefix}-s3ObjectTransferLambdaFn`, {
            functionName: `${props.resourcePrefix}-s3ObjectTransferLambdaFn`,
            runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../../src/lambdas/s3-file-transfer/index.ts'),
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
            projectRoot: path.join(__dirname, '../../src/lambdas/s3-file-transfer'),
            depsLockFilePath: path.join(__dirname, '../../src/lambdas/s3-file-transfer/package-lock.json'),
        });

        const fileTransformLambdaFn = new PythonFunction(this, `${props.resourcePrefix}-fileTransformLambdaFn`, {
            functionName: `${props.resourcePrefix}-fileTransformLambdaFn`,
            runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
            entry: path.join(__dirname, '../src/lambdas/s3-file-transform'),
            handler: "handler",
            architecture: lambda.Architecture.ARM_64,
            runtimeManagementMode: lambda.RuntimeManagementMode.AUTO,
            memorySize: 1024,
            timeout: cdk.Duration.seconds(60), // 60 seconds
            logGroup: new cdk.aws_logs.LogGroup(this, `${props.resourcePrefix}-fileTransformLambdaFn-LogGroup`, {
                logGroupName: `${props.resourcePrefix}-fileTransformLambdaFn-LogGroup`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
            }),
        });
    }
}
