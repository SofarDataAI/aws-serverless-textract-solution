import { StackProps } from "aws-cdk-lib";

/**
 * Properties for defining a AwsServerlessTextractSolutionStackProps.
 */
export interface AwsServerlessTextractSolutionStackProps extends StackProps {
    /**
     * A prefix to be used for naming resources.
     */
    readonly resourcePrefix: string;
    /**
     * The AWS region where the stack will be deployed.
     */
    readonly cdkDeployRegion?: string;
    /**
     * The environment where the stack will be deployed (e.g., development, staging, production).
     */
    readonly cdkDeployEnvironment: string;
    /**
     * The name of the application.
     */
    readonly appName: string;
}
