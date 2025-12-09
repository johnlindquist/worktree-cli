import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getRepoRoot } from "./git.js";
import { createSpinner } from "./spinner.js";
import { confirmCommands } from "./tui.js";
/**
 * Load and parse setup commands from worktrees.json
 */
async function loadSetupCommands(repoRoot) {
    // Check for .cursor/worktrees.json first
    const cursorSetupPath = join(repoRoot, ".cursor", "worktrees.json");
    try {
        await stat(cursorSetupPath);
        const content = await readFile(cursorSetupPath, "utf-8");
        const data = JSON.parse(content);
        let commands = [];
        if (Array.isArray(data)) {
            commands = data;
        }
        else if (data && typeof data === 'object' && Array.isArray(data["setup-worktree"])) {
            commands = data["setup-worktree"];
        }
        if (commands.length > 0) {
            return { commands, filePath: cursorSetupPath };
        }
    }
    catch {
        // Not found, try fallback
    }
    // Check for worktrees.json
    const fallbackSetupPath = join(repoRoot, "worktrees.json");
    try {
        await stat(fallbackSetupPath);
        const content = await readFile(fallbackSetupPath, "utf-8");
        const data = JSON.parse(content);
        let commands = [];
        if (Array.isArray(data)) {
            commands = data;
        }
        else if (data && typeof data === 'object' && Array.isArray(data["setup-worktree"])) {
            commands = data["setup-worktree"];
        }
        if (commands.length > 0) {
            return { commands, filePath: fallbackSetupPath };
        }
    }
    catch {
        // Not found
    }
    return null;
}
/**
 * Execute setup commands with user confirmation (SECURE)
 *
 * This is the centralized, secure function for loading and executing setup commands.
 * It ensures commands are displayed to the user and requires confirmation before execution,
 * unless the --trust flag is set.
 *
 * SECURITY: This function implements the trust model - all commands are shown to the user
 * and require confirmation before execution. Use --trust flag in CI environments only.
 *
 * @param worktreePath - Path to the worktree where commands should be executed
 * @param options - Execution options (trust flag bypasses confirmation)
 * @returns true if setup commands were found and executed, false if no setup file exists
 */
export async function runSetupScriptsSecure(worktreePath, options = {}) {
    const repoRoot = await getRepoRoot();
    if (!repoRoot) {
        console.warn(chalk.yellow("Could not determine repository root. Skipping setup scripts."));
        return false;
    }
    const setupResult = await loadSetupCommands(repoRoot);
    if (!setupResult) {
        return false;
    }
    console.log(chalk.blue(`Found setup file: ${setupResult.filePath}`));
    // Show commands and ask for confirmation (unless --trust flag is set)
    const shouldRun = await confirmCommands(setupResult.commands, {
        title: "The following setup commands will be executed:",
        trust: options.trust,
    });
    if (!shouldRun) {
        console.log(chalk.yellow("Setup commands skipped."));
        return false;
    }
    // Execute commands
    const env = { ...process.env, ROOT_WORKTREE_PATH: repoRoot };
    for (const command of setupResult.commands) {
        console.log(chalk.gray(`Executing: ${command}`));
        try {
            await execa(command, { shell: true, cwd: worktreePath, env, stdio: "inherit" });
        }
        catch (cmdError) {
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
/**
 * Execute setup commands from worktrees.json or .cursor/worktrees.json
 *
 * @deprecated Use runSetupScriptsSecure() instead for secure command execution with confirmation
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
