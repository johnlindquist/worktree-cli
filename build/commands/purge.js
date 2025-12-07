import { execa } from "execa";
import chalk from "chalk";
import { stat, rm } from "node:fs/promises";
import { getWorktrees } from "../utils/git.js";
import { selectWorktree, confirm } from "../utils/tui.js";
export async function purgeWorktreesHandler() {
    try {
        // Ensure we're in a Git repository
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
        // Get all worktrees using the robust parsing utility
        const worktrees = await getWorktrees();
        if (worktrees.length === 0) {
            console.log(chalk.yellow("No worktrees found."));
            return;
        }
        // Filter out the main worktree
        const purgeWorktrees = worktrees.filter(wt => !wt.isMain);
        if (purgeWorktrees.length === 0) {
            console.log(chalk.green("No worktrees to purge (only main remains)."));
            return;
        }
        console.log(chalk.blue(`Found ${purgeWorktrees.length} worktree(s) to potentially purge:`));
        console.log();
        // Display all worktrees that can be purged
        for (const wt of purgeWorktrees) {
            let status = '';
            if (wt.locked)
                status += chalk.red(' [locked]');
            if (wt.prunable)
                status += chalk.yellow(' [prunable]');
            console.log(chalk.cyan(`  ${wt.branch || '(detached)'}`), chalk.gray(`→ ${wt.path}`), status);
        }
        console.log();
        // Use interactive multi-select
        const selectedWorktrees = await selectWorktree({
            message: "Select worktrees to remove",
            excludeMain: true,
            multiSelect: true,
        });
        if (!selectedWorktrees || !Array.isArray(selectedWorktrees) || selectedWorktrees.length === 0) {
            console.log(chalk.yellow("No worktrees selected for removal."));
            return;
        }
        // Confirm the selection
        console.log(chalk.blue(`\nYou selected ${selectedWorktrees.length} worktree(s) for removal:`));
        for (const wt of selectedWorktrees) {
            console.log(chalk.cyan(`  ${wt.branch || '(detached)'}`), chalk.gray(`→ ${wt.path}`));
        }
        console.log();
        const confirmed = await confirm("Are you sure you want to remove these worktrees?", false);
        if (!confirmed) {
            console.log(chalk.yellow("Purge cancelled."));
            return;
        }
        // Process each selected worktree
        for (const wt of selectedWorktrees) {
            console.log(chalk.blue(`\nRemoving worktree for branch "${wt.branch || '(detached)'}"`));
            let removedSuccessfully = false;
            try {
                // Handle locked worktrees
                if (wt.locked) {
                    console.log(chalk.yellow(`Worktree is locked${wt.lockReason ? `: ${wt.lockReason}` : ''}`));
                    const forceUnlock = await confirm("Force remove this locked worktree?", false);
                    if (!forceUnlock) {
                        console.log(chalk.yellow(`Skipping locked worktree.`));
                        continue;
                    }
                }
                // Try to remove the worktree
                await execa("git", ["worktree", "remove", wt.path]);
                console.log(chalk.green(`Removed worktree metadata for ${wt.path}.`));
                removedSuccessfully = true;
            }
            catch (removeError) {
                const execaError = removeError;
                const stderr = execaError?.stderr || '';
                const message = execaError?.message || String(removeError);
                if (stderr.includes("modified or untracked files")) {
                    console.log(chalk.yellow(`Worktree contains modified or untracked files.`));
                    const forceAnswer = await confirm("Force remove this worktree (may lose changes)?", false);
                    if (forceAnswer) {
                        try {
                            await execa("git", ["worktree", "remove", "--force", wt.path]);
                            console.log(chalk.green(`Force removed worktree metadata for ${wt.path}.`));
                            removedSuccessfully = true;
                        }
                        catch (forceError) {
                            const forceExecaError = forceError;
                            console.error(chalk.red(`Failed to force remove worktree:`), forceExecaError.stderr || forceExecaError.message);
                        }
                    }
                    else {
                        console.log(chalk.yellow(`Skipping worktree.`));
                    }
                }
                else if (stderr.includes("fatal: validation failed") && stderr.includes("is not a .git file")) {
                    console.error(chalk.red(`Error: Git detected an inconsistency with this worktree.`));
                    console.error(chalk.yellow(`The directory exists but its '.git' file is missing or corrupted.`));
                    console.log(chalk.cyan(`Suggested: Run 'git worktree prune' to clean up stale metadata.`));
                }
                else {
                    console.error(chalk.red(`Failed to remove worktree:`), stderr || message);
                }
            }
            // Clean up the physical directory if git remove succeeded
            if (removedSuccessfully) {
                try {
                    await stat(wt.path);
                    console.log(chalk.blue(`Deleting folder ${wt.path}...`));
                    await rm(wt.path, { recursive: true, force: true });
                    console.log(chalk.green(`Deleted folder ${wt.path}.`));
                }
                catch (statError) {
                    if (statError.code !== 'ENOENT') {
                        console.warn(chalk.yellow(`Could not delete folder: ${statError.message}`));
                    }
                }
            }
        }
        console.log(chalk.green("\nPurge command finished."));
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red("Failed during purge operation:"), error.message);
        }
        else {
            console.error(chalk.red("Failed during purge operation:"), error);
        }
        process.exit(1);
    }
}
