import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { AwsServerlessTextractSolutionStackProps } from './AwsServerlessTextractSolutionStackProps';
import { AwsServerlessS3StackProps } from './constructs/AwsServerlessS3StackProps';
import { checkEnvVariables } from '../utils/check-environment-variable';
import { AwsServerlessS3Stack } from './constructs/aws-serverless-s3-stack';

export class AwsServerlessTextractSolutionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AwsServerlessTextractSolutionStackProps) {
    super(scope, id, props);

    if (!props.resourcePrefix || !props.cdkDeployEnvironment || !props.appName) {
      throw new Error('Missing required properties in CxObPrivateLlmProviderStackProps.');
    }

    // check s3 bucket names
    checkEnvVariables('MASTER_BUCKET_NAME', 'PFDFILES_BUCKET_NAME', 'JSONFILES_BUCKET_NAME');

    if (!process.env.MASTER_BUCKET_NAME || !process.env.PFDFILES_BUCKET_NAME || !process.env.JSONFILES_BUCKET_NAME) {
      throw new Error('One or more required environment variables are missing.');
    }

    // create s3 buckets stack
    const awsServerlessS3StackProps: AwsServerlessS3StackProps = {
      ...props,
      masterBucketName: process.env.MASTER_BUCKET_NAME,
      pfdFilesBucketName: process.env.PFDFILES_BUCKET_NAME,
      jsonFilesBucketName: process.env.JSONFILES_BUCKET_NAME,
      encryption: s3.BucketEncryption.S3_MANAGED,
    };
    const awsServerlessS3Stack = new AwsServerlessS3Stack(this, 'AwsServerlessS3Stack', awsServerlessS3StackProps);
  }
}
