import { AwsServerlessTextractSolutionStackProps } from "../../AwsServerlessTextractSolutionStackProps";

export interface AwsServerlessDataTransformStackProps extends AwsServerlessTextractSolutionStackProps {
    /**
     * The name of the master S3 bucket.
     */
    readonly masterBucketName: string;

    /**
     * The name of the S3 bucket for storing PDF files.
     */
    readonly pfdFilesBucketName: string;
}
