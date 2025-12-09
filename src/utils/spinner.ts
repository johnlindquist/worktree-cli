import ora, { Ora } from 'ora';

/**
 * Wrapper around ora spinner for long-running operations
 *
 * Provides a consistent interface for showing loading indicators
 * during long-running git operations, package installs, etc.
 */

/**
 * Run an operation with a spinner
 *
 * @param message - The message to display while the operation is running
 * @param operation - The async operation to run
 * @param successMessage - Optional message to display on success
 * @param failMessage - Optional message to display on failure
 * @returns The result of the operation
 *
 * @example
 * await withSpinner('Installing dependencies...', async () => {
 *   await execa('pnpm', ['install']);
 * }, 'Dependencies installed.');
 */
export async function withSpinner<T>(
    message: string,
    operation: (spinner: Ora) => Promise<T>,
    successMessage?: string,
    failMessage?: string
): Promise<T> {
    const spinner = ora(message).start();
    try {
        const result = await operation(spinner);
        if (successMessage) {
            spinner.succeed(successMessage);
        } else {
            spinner.stop();
        }
        return result;
    } catch (error) {
        if (failMessage) {
            spinner.fail(failMessage);
        } else {
            spinner.fail(`${message} failed`);
        }
        throw error;
    }
}

/**
 * Create a manual spinner instance for more complex operations
 *
 * Use this when you need fine-grained control over the spinner state
 * or when you have multiple steps within a single operation.
 *
 * @param message - The initial message to display
 * @returns Ora spinner instance
 *
 * @example
 * const spinner = createSpinner('Processing...');
 * try {
 *   spinner.text = 'Step 1...';
 *   await step1();
 *   spinner.text = 'Step 2...';
 *   await step2();
 *   spinner.succeed('Done!');
 * } catch (error) {
 *   spinner.fail('Failed!');
 * }
 */
export function createSpinner(message: string): Ora {
    return ora(message);
}
