import { execa } from "execa";
import chalk from "chalk";
import { stat, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { isMainRepoBare, isWorktreeClean } from "../utils/git.js";
import { withSpinner } from "../utils/spinner.js";

export async function mergeWorktreeHandler(
    branchName: string,
    options: {
        force?: boolean;
        autoCommit?: boolean;
        message?: string;
        remove?: boolean;
    }
) {
    try {
        // Validate that we're in a git repository
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);

        // Get the current branch name (the target for merging)
        const { stdout: currentBranch } = await execa("git", ["branch", "--show-current"]);
        if (!currentBranch) {
            console.error(chalk.red("Failed to determine the current branch."));
            process.exit(1);
        }

        // Parse worktree list to find the worktree for the target branch
        const { stdout } = await execa("git", ["worktree", "list", "--porcelain"]);
        let targetPath = "";
        let tempPath = "";
        const lines = stdout.split("\n");
        for (const line of lines) {
            if (line.startsWith("worktree ")) {
                tempPath = line.replace("worktree ", "").trim();
            } else if (line.startsWith("branch ")) {
                const fullBranchRef = line.replace("branch ", "").trim();
                const shortBranch = fullBranchRef.replace("refs/heads/", "");
                if (shortBranch === branchName) {
                    targetPath = tempPath;
                    break;
                }
            }
        }

        if (!targetPath) {
            console.error(chalk.red(`Could not find a worktree for branch "${branchName}".`));
            process.exit(1);
        }

        console.log(
            chalk.blue(
                `Merging changes from worktree branch "${branchName}" at ${targetPath} into current branch "${currentBranch}".`
            )
        );

        // Step 1: Check if target worktree is dirty (both staged and unstaged changes)
        const isClean = await isWorktreeClean(targetPath);

        if (!isClean && !options.autoCommit) {
            console.error(chalk.red(`Error: The target worktree for branch "${branchName}" has uncommitted changes.`));
            console.error(chalk.yellow("Please commit or stash your changes first, or use the --auto-commit flag."));
            process.exit(1);
        }

        // Step 2: Auto-commit if enabled and there are changes
        if (options.autoCommit && !isClean) {
            try {
                await execa("git", ["-C", targetPath, "add", "."]);
                const commitMessage = options.message || `Auto-commit changes before merging ${branchName}`;
                await execa("git", [
                    "-C",
                    targetPath,
                    "commit",
                    "-m",
                    commitMessage,
                ]);
                console.log(chalk.green("Committed pending changes in target branch worktree."));
            } catch (commitError) {
                console.log(
                    chalk.yellow("No pending changes to commit in the target branch or commit failed, proceeding with merge.")
                );
            }
        }

        // Step 3: Merge the target branch into the current branch
        await withSpinner(
            `Merging branch "${branchName}" into "${currentBranch}"...`,
            async () => {
                await execa("git", ["merge", branchName]);
            },
            `Merged branch "${branchName}" into "${currentBranch}".`
        );

        // Step 4: Remove the worktree if --remove flag is set
        if (options.remove) {
            if (await isMainRepoBare()) {
                console.error(chalk.red("❌ Error: The main repository is configured as 'bare' (core.bare=true)."));
                console.error(chalk.red("   This prevents normal Git operations. Please fix the configuration:"));
                console.error(chalk.cyan("   git config core.bare false"));
                process.exit(1);
            }

            const removeArgs = ["worktree", "remove", ...(options.force ? ["--force"] : []), targetPath];
            await withSpinner(
                `Removing worktree for branch "${branchName}"...`,
                async () => {
                    await execa("git", removeArgs);
                },
                `Removed worktree at ${targetPath}.`
            );

            // Optionally remove the physical directory if it still exists
            try {
                await stat(targetPath);
                await rm(targetPath, { recursive: true, force: true });
                console.log(chalk.green(`Deleted folder ${targetPath}.`));
            } catch {
                // If the directory does not exist, it's fine
            }
        } else {
            console.log(chalk.blue(`Worktree for branch "${branchName}" at ${targetPath} has been preserved.`));
            console.log(chalk.yellow(`Use 'wt remove ${branchName}' to clean it up when ready.`));
        }

        console.log(chalk.green("Merge command completed successfully!"));
    } catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red("Failed to merge worktree:"), error.message);
        } else {
            console.error(chalk.red("Failed to merge worktree:"), error);
        }
        process.exit(1);
    }
} 