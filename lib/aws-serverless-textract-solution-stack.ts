import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AwsServerlessTextractSolutionStackProps } from './AwsServerlessTextractSolutionStackProps';

export class AwsServerlessTextractSolutionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AwsServerlessTextractSolutionStackProps) {
    super(scope, id, props);

    if (!props.resourcePrefix || !props.cdkDeployEnvironment || !props.appName) {
      throw new Error('Missing required properties in CxObPrivateLlmProviderStackProps.');
    }
  }
}
