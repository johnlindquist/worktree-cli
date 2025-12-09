import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getRepoRoot } from "./git.js";
import { createSpinner } from "./spinner.js";
/**
 * Execute setup commands from worktrees.json or .cursor/worktrees.json
 *
 * Note: This function executes commands without the regex blocklist that was previously used.
 * The security model has shifted to displaying commands before execution and requiring
 * user confirmation (handled by the caller). Use the --trust flag in CI environments.
 *
 * @param worktreePath - Path to the worktree where commands should be executed
 * @returns true if setup commands were found and executed, false if no setup file exists
 */
export async function runSetupScripts(worktreePath) {
    const repoRoot = await getRepoRoot();
    if (!repoRoot) {
        console.warn(chalk.yellow("Could not determine repository root. Skipping setup scripts."));
        return false;
    }
    let setupFilePath = null;
    let setupData = null;
    // Check for Cursor's worktrees.json first
    const cursorSetupPath = join(repoRoot, ".cursor", "worktrees.json");
    try {
        await stat(cursorSetupPath);
        setupFilePath = cursorSetupPath;
    }
    catch {
        // Check for worktrees.json
        const fallbackSetupPath = join(repoRoot, "worktrees.json");
        try {
            await stat(fallbackSetupPath);
            setupFilePath = fallbackSetupPath;
        }
        catch {
            // No setup file found
            return false;
        }
    }
    if (!setupFilePath) {
        return false;
    }
    try {
        console.log(chalk.blue(`Found setup file: ${setupFilePath}, executing setup commands...`));
        const setupContent = await readFile(setupFilePath, "utf-8");
        setupData = JSON.parse(setupContent);
        let commands = [];
        if (setupData && typeof setupData === 'object' && !Array.isArray(setupData) && Array.isArray(setupData["setup-worktree"])) {
            commands = setupData["setup-worktree"];
        }
        else if (setupFilePath.includes("worktrees.json") && Array.isArray(setupData)) {
            // Handle Cursor's format if it's just an array
            commands = setupData;
        }
        if (commands.length === 0) {
            console.warn(chalk.yellow(`${setupFilePath} does not contain valid setup commands.`));
            return false;
        }
        // Execute commands (security is handled by the trust model in the caller)
        const env = { ...process.env, ROOT_WORKTREE_PATH: repoRoot };
        for (const command of commands) {
            const spinner = createSpinner(`Executing: ${command}`).start();
            try {
                await execa(command, { shell: true, cwd: worktreePath, env, stdio: "inherit" });
                spinner.succeed(`Completed: ${command}`);
            }
            catch (cmdError) {
                spinner.fail(`Failed: ${command}`);
                if (cmdError instanceof Error) {
                    console.error(chalk.red(`Setup command failed: ${command}`), cmdError.message);
                }
                else {
                    console.error(chalk.red(`Setup command failed: ${command}`), cmdError);
                }
                // Continue with other commands
            }
        }
        console.log(chalk.green("Setup commands completed."));
        return true;
    }
    catch (error) {
        if (error instanceof Error) {
            console.warn(chalk.yellow(`Failed to parse setup file ${setupFilePath}:`), error.message);
        }
        else {
            console.warn(chalk.yellow(`Failed to parse setup file ${setupFilePath}:`), error);
        }
        return false;
    }
}
