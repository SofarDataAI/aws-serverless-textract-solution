import { AwsServerlessTextractSolutionStackProps } from "../../AwsServerlessTextractSolutionStackProps";

export interface AwsServerlessDataIngestionStackProps extends AwsServerlessTextractSolutionStackProps {
    /**
     * The name of the S3 bucket for storing PDF files.
     */
    readonly pfdFilesBucketName: string;
    /**
     * The name of the S3 bucket for storing JSON files.
     */
    readonly jsonFilesBucketName: string;
}
