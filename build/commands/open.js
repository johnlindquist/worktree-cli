import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { getDefaultEditor, shouldSkipEditor } from "../config.js";
import { findWorktreeByBranch, findWorktreeByPath } from "../utils/git.js";
import { selectWorktree } from "../utils/tui.js";
export async function openWorktreeHandler(pathOrBranch = "", options) {
    try {
        // 1. Validate we're in a git repo
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
        let targetWorktree = null;
        // Improvement #4: Interactive TUI for missing arguments
        if (!pathOrBranch) {
            const selected = await selectWorktree({
                message: "Select a worktree to open",
                excludeMain: false,
            });
            if (!selected || Array.isArray(selected)) {
                console.log(chalk.yellow("No worktree selected."));
                process.exit(0);
            }
            targetWorktree = selected;
        }
        else {
            // Try to find by path first
            try {
                const stats = await stat(pathOrBranch);
                if (stats.isDirectory()) {
                    targetWorktree = await findWorktreeByPath(pathOrBranch);
                    if (!targetWorktree) {
                        // It's a directory but not a registered worktree
                        // Still try to open it if it has .git
                        try {
                            await stat(resolve(pathOrBranch, ".git"));
                            // It's a git worktree, create a minimal info object
                            targetWorktree = {
                                path: resolve(pathOrBranch),
                                head: '',
                                branch: null,
                                detached: false,
                                locked: false,
                                prunable: false,
                                isMain: false,
                                bare: false,
                            };
                        }
                        catch {
                            console.error(chalk.red(`The path "${pathOrBranch}" exists but is not a git worktree.`));
                            process.exit(1);
                        }
                    }
                }
            }
            catch {
                // Not a valid path, try as branch name
            }
            // If not found by path, try by branch name
            if (!targetWorktree) {
                targetWorktree = await findWorktreeByBranch(pathOrBranch);
                if (!targetWorktree) {
                    console.error(chalk.red(`Could not find a worktree for branch "${pathOrBranch}".`));
                    console.error(chalk.yellow("Use 'wt list' to see existing worktrees, or run 'wt open' without arguments to select interactively."));
                    process.exit(1);
                }
            }
        }
        const targetPath = targetWorktree.path;
        // Verify the target path exists
        try {
            await stat(targetPath);
        }
        catch {
            console.error(chalk.red(`The worktree path "${targetPath}" no longer exists.`));
            console.error(chalk.yellow("The worktree may have been removed. Run 'git worktree prune' to clean up."));
            process.exit(1);
        }
        // Display worktree info
        if (targetWorktree.branch) {
            console.log(chalk.blue(`Opening worktree for branch "${targetWorktree.branch}"...`));
        }
        else if (targetWorktree.detached) {
            console.log(chalk.blue(`Opening detached worktree at ${targetWorktree.head.substring(0, 7)}...`));
        }
        else {
            console.log(chalk.blue(`Opening worktree at ${targetPath}...`));
        }
        // Show status indicators
        if (targetWorktree.locked) {
            console.log(chalk.yellow(`Note: This worktree is locked${targetWorktree.lockReason ? `: ${targetWorktree.lockReason}` : ''}`));
        }
        if (targetWorktree.prunable) {
            console.log(chalk.yellow(`Warning: This worktree is marked as prunable${targetWorktree.pruneReason ? `: ${targetWorktree.pruneReason}` : ''}`));
        }
        // Open in the specified editor (or use configured default)
        const configuredEditor = getDefaultEditor();
        const editorCommand = options.editor || configuredEditor;
        if (shouldSkipEditor(editorCommand)) {
            console.log(chalk.gray(`Editor set to 'none', skipping editor open.`));
            console.log(chalk.green(`Worktree path: ${targetPath}`));
        }
        else {
            console.log(chalk.blue(`Opening ${targetPath} in ${editorCommand}...`));
            try {
                await execa(editorCommand, [targetPath], { stdio: "inherit" });
                console.log(chalk.green(`Successfully opened worktree in ${editorCommand}.`));
            }
            catch (editorError) {
                console.error(chalk.red(`Failed to open editor "${editorCommand}". Please ensure it's installed and in your PATH.`));
                process.exit(1);
            }
        }
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red("Failed to open worktree:"), error.message);
        }
        else {
            console.error(chalk.red("Failed to open worktree:"), error);
        }
        process.exit(1);
    }
}
