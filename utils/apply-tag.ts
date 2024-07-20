import { IAspect, ITaggable, TagManager } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { createLogger, transports, format, Logger } from 'winston';

let logger: ReturnType<typeof createLogger>;

/**
 * Gets or creates a Winston logger instance.
 * @returns {Logger} The Winston logger instance.
 */
export function getLogger(): Logger {
  if (!logger) {
    logger = createLogger({
      level: 'info',
      format: format.combine(
        format.colorize(),
        format.simple()
      ),
      transports: [new transports.Console()],
    });
  }
  return logger;
}

// Get the logger instance for this module
getLogger();

/**
 * Represents the structure of tags to be applied.
 * @typedef {Object} Tags
 * @property {'development' | 'staging' | 'production' | 'demonstration'} environment - The deployment environment.
 * @property {string} project - The project name.
 * @property {string} owner - The owner of the resource.
 * @property {string} [key: string] - Any additional key-value pairs.
 */
export type Tags = { [key: string]: string } & {
    environment: 'development' | 'staging' | 'production' | 'demonstration';
    project: string;
    owner: string;
};

/**
 * Custom error class for missing required tags.
 * @extends Error
 */
class MissingTagError extends Error {
  /**
   * Creates an instance of MissingTagError.
   * @param {string} tag - The name of the missing tag.
   */
  constructor(tag: string) {
    super(`Missing required tag: ${tag}.`);
    this.name = 'MissingTagError';
  }
}

/**
 * Custom error class for tag application failures.
 * @extends Error
 */
class TagApplicationError extends Error {
  /**
   * Creates an instance of TagApplicationError.
   * @param {string} message - The error message.
   * @param {ErrorOptions} [options] - Optional error options.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TagApplicationError';
  }
}

/**
 * Custom error class for missing environment variables.
 * @extends Error
 */
export class MissingEnvVarError extends Error {
  /**
   * Creates an instance of MissingEnvVarError.
   * @param {string} variable - The name of the missing environment variable.
   */
  constructor(variable: string) {
    super(`Required environment variable ${variable} is not set.`);
    this.name = 'MissingEnvVarError';
  }
}

/**
 * Class for applying tags to AWS CDK constructs.
 * @implements {IAspect}
 */
export class ApplyTags implements IAspect {
  #tags: Tags;

  /**
   * Creates an instance of ApplyTags.
   * @param {Tags} tags - The tags to be applied.
   * @throws {MissingTagError} If any required tag is missing.
   */
  constructor(tags: Tags) {
    const requiredTags = ['environment', 'project', 'owner'];
    requiredTags.forEach(tag => {
      if (!tags[tag]) {
        throw new MissingTagError(tag);
      }
    });
    this.#tags = tags;
  }

  /**
   * Applies tags to the given construct.
   * @param {IConstruct} node - The construct to apply tags to.
   * @throws {TagApplicationError} If there's an error while applying tags.
   */
  visit(node: IConstruct) {
    if (TagManager.isTaggable(node)) {
      try {
        Object.entries(this.#tags).forEach(([key, value]) => {
          logger.info(`Applying tag ${key}=${value} to ${node.node.path}.`);
          (node as ITaggable)?.tags.setTag(key, value);
        });
      } catch (err) {
        const errorMessage = `Failed to apply tags to ${node.node.path}: ${err instanceof Error ? err.message : JSON.stringify(err)}.`;
        logger.error(errorMessage);
        throw new TagApplicationError(errorMessage, { cause: err });
      }
    }
  }
}
