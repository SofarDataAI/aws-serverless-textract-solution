import * as s3 from 'aws-cdk-lib/aws-s3';
import { AwsServerlessTextractSolutionStackProps } from "../../AwsServerlessTextractSolutionStackProps";

/**
 * Properties for defining a AwsServerlessS3StackProps.
 */
export interface AwsServerlessS3StackProps extends AwsServerlessTextractSolutionStackProps {
    /**
     * The name of the master S3 bucket.
     */
    readonly masterBucketName: string;

    /**
     * The name of the S3 bucket for storing PDF files.
     */
    readonly pfdFilesBucketName: string;

    /**
     * The name of the S3 bucket for storing JSON files.
     */
    readonly jsonFilesBucketName: string;

    /**
     * The encryption setting for the S3 buckets.
     */
    readonly encryption: s3.BucketEncryption;
}
