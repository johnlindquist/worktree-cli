import { execa } from "execa";
import chalk from "chalk";
import { stat, rm } from "node:fs/promises";
import { isMainRepoBare } from "../utils/git.js";
export async function mergeWorktreeHandler(branchName, options) {
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
            }
            else if (line.startsWith("branch ")) {
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
        console.log(chalk.blue(`Merging changes from worktree branch "${branchName}" at ${targetPath} into current branch "${currentBranch}".`));
        // Step 1: Commit any pending changes in the target branch worktree
        try {
            await execa("git", ["-C", targetPath, "add", "."]);
            await execa("git", [
                "-C",
                targetPath,
                "commit",
                "-m",
                `Auto-commit changes before merging ${branchName}`,
            ]);
            console.log(chalk.green("Committed pending changes in target branch worktree."));
        }
        catch (commitError) {
            console.log(chalk.yellow("No pending changes to commit in the target branch or commit failed, proceeding with merge."));
        }
        // Step 2: Merge the target branch into the current branch
        await execa("git", ["merge", branchName]);
        console.log(chalk.green(`Merged branch "${branchName}" into "${currentBranch}".`));
        // Step 3: Remove the worktree for the merged branch (similar to 'wt remove')
        console.log(chalk.blue(`Removing worktree for branch "${branchName}"...`));
        if (await isMainRepoBare()) {
            console.error(chalk.red("❌ Error: The main repository is configured as 'bare' (core.bare=true)."));
            console.error(chalk.red("   This prevents normal Git operations. Please fix the configuration:"));
            console.error(chalk.cyan("   git config core.bare false"));
            process.exit(1);
        }
        const removeArgs = ["worktree", "remove", ...(options.force ? ["--force"] : []), targetPath];
        await execa("git", removeArgs);
        console.log(chalk.green(`Removed worktree at ${targetPath}.`));
        // Optionally remove the physical directory if it still exists
        try {
            await stat(targetPath);
            await rm(targetPath, { recursive: true, force: true });
            console.log(chalk.green(`Deleted folder ${targetPath}.`));
        }
        catch {
            // If the directory does not exist, it's fine
        }
        console.log(chalk.green("Merge command completed successfully!"));
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red("Failed to merge worktree:"), error.message);
        }
        else {
            console.error(chalk.red("Failed to merge worktree:"), error);
        }
        process.exit(1);
    }
}
