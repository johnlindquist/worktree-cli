import { execa } from "execa";
import chalk from "chalk";
import { stat, rm } from "node:fs/promises";
import { findWorktreeByBranch, findWorktreeByPath } from "../utils/git.js";
import { selectWorktree, confirm } from "../utils/tui.js";
export async function removeWorktreeHandler(pathOrBranch = "", options) {
    try {
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
        let targetWorktree = null;
        // Improvement #4: Interactive TUI for missing arguments
        if (!pathOrBranch) {
            const selected = await selectWorktree({
                message: "Select a worktree to remove",
                excludeMain: true, // Don't allow removing main worktree
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
                }
            }
            catch {
                // Not a valid path, try as branch name
            }
            // If not found by path, try by branch name
            if (!targetWorktree) {
                targetWorktree = await findWorktreeByBranch(pathOrBranch);
            }
            if (!targetWorktree) {
                console.error(chalk.red(`Could not find a worktree for "${pathOrBranch}".`));
                console.error(chalk.yellow("Use 'wt list' to see existing worktrees, or run 'wt remove' without arguments to select interactively."));
                process.exit(1);
            }
        }
        const targetPath = targetWorktree.path;
        // Prevent removing main worktree
        if (targetWorktree.isMain) {
            console.error(chalk.red("Cannot remove the main worktree."));
            process.exit(1);
        }
        // Show what will be removed
        console.log(chalk.blue(`Worktree to remove:`));
        if (targetWorktree.branch) {
            console.log(chalk.cyan(`  Branch: ${targetWorktree.branch}`));
        }
        console.log(chalk.cyan(`  Path: ${targetPath}`));
        // Warn about locked worktrees
        if (targetWorktree.locked) {
            console.log(chalk.yellow(`  Warning: This worktree is locked${targetWorktree.lockReason ? `: ${targetWorktree.lockReason}` : ''}`));
            if (!options.force) {
                console.error(chalk.red("Use --force to remove a locked worktree."));
                process.exit(1);
            }
        }
        // Confirm removal (skip in non-interactive mode or with force flag)
        const isNonInteractive = !process.stdin.isTTY;
        if (!options.force && !isNonInteractive) {
            const confirmed = await confirm("Are you sure you want to remove this worktree?", false);
            if (!confirmed) {
                console.log(chalk.yellow("Removal cancelled."));
                process.exit(0);
            }
        }
        console.log(chalk.blue(`Removing worktree: ${targetPath}`));
        // Remove the worktree
        try {
            await execa("git", ["worktree", "remove", ...(options.force ? ["--force"] : []), targetPath]);
            console.log(chalk.green("Git worktree metadata removed."));
        }
        catch (removeError) {
            if (removeError.stderr?.includes("modified or untracked files") && !options.force) {
                console.log(chalk.yellow("Worktree contains modified or untracked files."));
                const forceRemove = await confirm("Do you want to force remove this worktree (this may lose changes)?", false);
                if (forceRemove) {
                    await execa("git", ["worktree", "remove", "--force", targetPath]);
                    console.log(chalk.green("Git worktree metadata force removed."));
                }
                else {
                    console.log(chalk.yellow("Removal cancelled."));
                    process.exit(0);
                }
            }
            else {
                throw removeError;
            }
        }
        // Also remove the physical directory if it still exists
        try {
            await stat(targetPath);
            await rm(targetPath, { recursive: true, force: true });
            console.log(chalk.green(`Deleted folder ${targetPath}`));
        }
        catch {
            // Directory doesn't exist, which is fine
        }
        console.log(chalk.green("Worktree removed successfully!"));
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red("Failed to remove worktree:"), error.message);
        }
        else {
            console.error(chalk.red("Failed to remove worktree:"), error);
        }
        process.exit(1);
    }
}
