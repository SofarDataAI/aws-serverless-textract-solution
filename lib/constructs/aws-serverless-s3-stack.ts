import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { AwsServerlessS3StackProps } from "./AwsServerlessS3StackProps";

/**
 * Represents a nested stack for creating and managing S3 buckets in an AWS Serverless application.
 *
 * This class creates three S3 buckets: a master bucket, a PDF files bucket, and a JSON files bucket.
 * It also applies lifecycle rules to each bucket for efficient management of objects.
 *
 * @extends NestedStack
 */
export class AwsServerlessS3Stack extends NestedStack {
    /** The name of the master S3 bucket */
    public masterS3BucketName: string;
    /** The name of the S3 bucket for storing PDF files */
    public pfdFilesBucketName: string;
    /** The name of the S3 bucket for storing JSON files */
    public jsonFilesBucketName: string;

    /**
     * Constructs a new instance of the AwsServerlessS3Stack.
     *
     * @param {Construct} scope - The scope in which to define this construct.
     * @param {string} id - The scoped construct ID.
     * @param {AwsServerlessS3StackProps} props - Properties for configuring the stack.
     * @throws {Error} If any required properties are missing from props.
     */
    constructor(scope: Construct, id: string, props: AwsServerlessS3StackProps) {
        super(scope, id, props);

        // create master S3 bucket
        const masterS3Bucket = this.createS3Bucket(this, `${props.resourcePrefix}-${props.masterBucketName}`, cdk.RemovalPolicy.DESTROY);

        // apply life cycle rules for master bucket
        this.createS3BucketLifecycleRule(masterS3Bucket, `${props.resourcePrefix}-${props.masterBucketName}-LifecycleRule`);

        // assign the master bucket as an input for the next stack
        this.masterS3BucketName = masterS3Bucket.bucketName;

        // create pdf files S3 bucket
        const pfdFilesBucket = this.createS3Bucket(this, `${props.resourcePrefix}-${props.pfdFilesBucketName}`, cdk.RemovalPolicy.DESTROY);

        // apply life cycle rules for pdf files bucket
        this.createS3BucketLifecycleRule(pfdFilesBucket, `${props.resourcePrefix}-${props.pfdFilesBucketName}-LifecycleRule`);

        // assign the pdf files bucket as an input for the next stack
        this.pfdFilesBucketName = pfdFilesBucket.bucketName;

        // create json files S3 bucket
        const jsonFilesBucket = this.createS3Bucket(this, `${props.resourcePrefix}-${props.jsonFilesBucketName}`, cdk.RemovalPolicy.DESTROY);

        // apply life cycle rules for json files bucket
        this.createS3BucketLifecycleRule(jsonFilesBucket, `${props.resourcePrefix}-${props.jsonFilesBucketName}-LifecycleRule`);

        // assign the json files bucket as an input for the next stack
        this.jsonFilesBucketName = jsonFilesBucket.bucketName;
    }

    /**
     * Creates an S3 bucket with specified configurations.
     *
     * @param {Construct} scope - The scope in which to define this construct.
     * @param {string} bucketName - The name of the S3 bucket to create.
     * @param {cdk.RemovalPolicy} removalPolicy - The removal policy to apply to the bucket.
     * @returns {s3.Bucket} The created S3 bucket.
     * @throws {Error} If bucket creation fails due to invalid parameters or AWS API errors.
     */
    createS3Bucket(scope: Construct, bucketName: string, removalPolicy: cdk.RemovalPolicy): s3.Bucket {
        return new s3.Bucket(scope, bucketName, {
            bucketName: bucketName,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            publicReadAccess: false,
            removalPolicy: removalPolicy,
            autoDeleteObjects: removalPolicy === cdk.RemovalPolicy.DESTROY,
            accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
            versioned: true, // Enable versioning
            enforceSSL: true,
        });
    }

    /**
     * Applies lifecycle rules to an S3 bucket for efficient object management.
     *
     * This method configures rules for aborting incomplete multipart uploads,
     * transitioning objects to different storage classes, and expiring noncurrent versions.
     *
     * @param {s3.Bucket} s3Bucket - The S3 bucket to which the lifecycle rules will be applied.
     * @param {string} id - A unique identifier for the lifecycle rule.
     * @throws {Error} If the lifecycle rule cannot be applied due to invalid parameters or AWS API errors.
     */
    createS3BucketLifecycleRule(s3Bucket: s3.Bucket, id: string) {
        const ABORT_MULTIPART_UPLOAD_DAYS = 7;
        const NONCURRENT_VERSION_EXPIRATION_DAYS = 365;
        const INFREQUENT_ACCESS_TRANSITION_DAYS = 30;
        const INTELLIGENT_TIERING_TRANSITION_DAYS = 60;

        // Add lifecycle rule to abort incomplete multipart uploads after 7 days,
        // transition objects to different storage classes, and expire noncurrent versions after 365 days.
        s3Bucket.addLifecycleRule({
            id: id,
            abortIncompleteMultipartUploadAfter: cdk.Duration.days(ABORT_MULTIPART_UPLOAD_DAYS), // After 7 days, incomplete multipart uploads will be aborted
            enabled: true,
            noncurrentVersionExpiration: cdk.Duration.days(NONCURRENT_VERSION_EXPIRATION_DAYS),
            noncurrentVersionTransitions: [
                {
                    storageClass: cdk.aws_s3.StorageClass.INFREQUENT_ACCESS, // Transition to Infrequent Access storage class after 30 days
                    transitionAfter: cdk.Duration.days(INFREQUENT_ACCESS_TRANSITION_DAYS),
                },
            ],
            transitions: [
                {
                    storageClass: cdk.aws_s3.StorageClass.INTELLIGENT_TIERING, // Transition to Intelligent Tiering storage class after 60 days
                    transitionAfter: cdk.Duration.days(INTELLIGENT_TIERING_TRANSITION_DAYS),
                },
            ],
        });
    }
}
