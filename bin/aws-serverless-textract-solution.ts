#!/usr/bin/env node
import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';
import * as dotenv from 'dotenv';
import { Aspects } from 'aws-cdk-lib';
import { ApplyTags, MissingEnvVarError } from '../utils/apply-tag';
import { AwsSolutionsChecks } from 'cdk-nag';
import { checkEnvVariables, Environment, VALID_ENVIRONMENTS } from '../utils/check-environment-variable';
import { AwsServerlessTextractSolutionStack } from '../lib/aws-serverless-textract-solution-stack';

dotenv.config(); // Load environment variables from .env file

const { CDK_DEFAULT_ACCOUNT: account } = process.env;

if (!account) {
  throw new MissingEnvVarError('CDK_DEFAULT_ACCOUNT');
}

// check variables
checkEnvVariables('APP_NAME',
    'ENVIRONMENT',
    'CDK_DEPLOY_REGION',
    'OWNER',
);

// Function to get required environment variables. Throws an error if any required environment variable is not set.
const getRequiredEnvVariables = (keys: string[]): { [key: string]: string } => {
  return keys.reduce((envVars, key) => {
    const value = process.env[key];
    if (!value) {
      throw new MissingEnvVarError(key);
    }
    envVars[key] = value;
    return envVars;
  }, {} as { [key: string]: string });
};

// required environment variables
const { APP_NAME: appName, ENVIRONMENT: deployEnvironment, CDK_DEPLOY_REGION: deployRegion, OWNER: owner } = getRequiredEnvVariables(['APP_NAME', 'ENVIRONMENT', 'CDK_DEPLOY_REGION', 'OWNER']) as { [key: string]: string };

const app = new cdk.App();
const appAspects = Aspects.of(app);

// validate the stack environment
function isValidEnvironment(env: string): env is Environment {
  if (VALID_ENVIRONMENTS.includes(env as Environment)) {
    return true;
  }
  throw new Error(`Unexpected environment value: ${env}`);
}

if (!isValidEnvironment(deployEnvironment)) {
  throw new Error(`Invalid environment: ${deployEnvironment}`);
}

// apply tags to all resources
appAspects.add(new ApplyTags({
  environment: deployEnvironment,
  project: appName,
  owner: owner,
}));

// apply cdk-nag checks based on security matrix best practices
appAspects.add(new AwsSolutionsChecks());

new AwsServerlessTextractSolutionStack(app, `${appName}-${deployRegion}-${deployEnvironment}-AwsServerlessTextractSolutionStack`, {
  resourcePrefix: `${appName}-${deployRegion}-${deployEnvironment}`,
  cdkDeployRegion: deployRegion,
  cdkDeployEnvironment: deployEnvironment,
  env: {
      account,
      region: deployRegion,
  },
  appName,
  description: `${appName}-${deployRegion}-${deployEnvironment}-AwsServerlessTextractSolutionStack`,
  stackName: `${appName}-${deployRegion}-${deployEnvironment}-AwsServerlessTextractSolutionStack`,
});

app.synth();
