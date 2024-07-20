/*
* Check if the environment variables are set
* @param args - Environment variables to check
* @throws Error if any of the environment variables is not set
* @returns void
* */
export function checkEnvVariables(...args: string[]) {
    const allVariablesSet = args.every(arg => {
        if (process.env[arg] === undefined) {
          throw new Error(`Environment variable ${arg} is not set. Please set it in .env file or pipeline environments.`);
        }
        return true;
    });
    return allVariablesSet;
};

/**
 * Parses a string to a boolean value.
 * @param enable - The string to parse.
 * @returns {boolean} - Returns true if the string is "true" or "TRUE", otherwise false.
 */
export function booleanParser(enable: string | undefined): boolean {
    if (enable == null) {
        return false;
    }
    return ['true', 'yes', '1'].includes(enable.toLowerCase());
}

/**
 * Checks if the input is an array and not empty.
 * @param inputArray - The array to check.
 * @returns {boolean} - Returns true if the input is an array and not empty, otherwise false.
 */
export function isNotEmptyOrUndefinedArray<T>(inputArray: T[] | undefined): inputArray is T[] {
    return Array.isArray(inputArray) && inputArray.length > 0;
}

export const VALID_ENVIRONMENTS = ['development', 'staging', 'production', 'demonstration'] as const;

export type Environment = typeof VALID_ENVIRONMENTS[number];