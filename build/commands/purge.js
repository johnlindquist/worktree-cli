import { execa } from "execa";
import chalk from "chalk";
import { stat, rm } from "node:fs/promises";
import readline from "node:readline";
// Utility function for interactive confirmation
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => rl.question(query, (ans) => {
        rl.close();
        resolve(ans);
    }));
}
export async function purgeWorktreesHandler() {
    try {
        // Ensure we're in a Git repository
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
        // Retrieve worktree list in porcelain format
        const { stdout } = await execa("git", ["worktree", "list", "--porcelain"]);
        const lines = stdout.split("\n");
        const worktrees = [];
        let currentPath = "";
        // Parse worktree information from porcelain output
        for (const line of lines) {
            if (line.startsWith("worktree ")) {
                currentPath = line.replace("worktree ", "").trim();
            }
            else if (line.startsWith("branch ")) {
                const fullBranch = line.replace("branch ", "").trim();
                const branch = fullBranch.replace("refs/heads/", "");
                worktrees.push({ path: currentPath, branch });
            }
        }
        if (worktrees.length === 0) {
            console.log(chalk.yellow("No worktrees found."));
            return;
        }
        // Filter out the main branch worktree
        const purgeWorktrees = worktrees.filter((wt) => wt.branch !== "main");
        if (purgeWorktrees.length === 0) {
            console.log(chalk.green("No worktrees to purge (only main remains)."));
            return;
        }
        console.log(chalk.blue(`Found ${purgeWorktrees.length} worktree(s) to potentially purge:`));
        // Loop through each worktree and ask for confirmation before removal
        for (const wt of purgeWorktrees) {
            console.log(chalk.blue(`Worktree: Branch "${wt.branch}" at path "${wt.path}"`));
            const answer = await askQuestion(`Do you want to remove this worktree? (y/N): `);
            if (answer.toLowerCase() === "y") {
                console.log(chalk.blue(`Removing worktree for branch "${wt.branch}"...`));
                let removedSuccessfully = false; // Flag to track successful removal
                try {
                    // Remove worktree using Git
                    await execa("git", ["worktree", "remove", wt.path]);
                    console.log(chalk.green(`Removed worktree metadata for ${wt.path}.`));
                    removedSuccessfully = true; // Mark as successfully removed by git command
                }
                catch (removeError) { // Catch potential errors
                    const execaError = removeError; // Type assertion
                    const stderr = execaError?.stderr || '';
                    const message = execaError?.message || String(removeError);
                    // --- Enhanced Error Handling ---
                    if (stderr.includes("modified or untracked files")) {
                        // Specific handling for dirty worktrees
                        console.log(chalk.yellow(`Worktree contains modified or untracked files.`));
                        const forceAnswer = await askQuestion(`Do you want to force remove this worktree (this may lose changes)? (y/N): `);
                        if (forceAnswer.toLowerCase() === "y") {
                            try {
                                await execa("git", ["worktree", "remove", "--force", wt.path]);
                                console.log(chalk.green(`Force removed worktree metadata for ${wt.path}.`));
                                removedSuccessfully = true; // Mark as successfully removed by git command
                            }
                            catch (forceError) {
                                const forceExecaError = forceError;
                                console.error(chalk.red(`Failed to force remove worktree metadata for "${wt.branch}":`), forceExecaError.stderr || forceExecaError.message);
                                // Do not attempt rm -rf if even force remove failed
                            }
                        }
                        else {
                            console.log(chalk.yellow(`Skipping removal for worktree "${wt.branch}".`));
                            // continue; // Skip to next worktree if not forcing
                        }
                    }
                    else if (stderr.includes("fatal: validation failed") && stderr.includes("is not a .git file")) {
                        // Specific handling for the validation error
                        console.error(chalk.red(`❌ Error removing worktree for branch "${wt.branch}" at "${wt.path}".`));
                        console.error(chalk.red(`   Git detected an inconsistency: The directory exists, but its '.git' file is missing, corrupted, or not what Git expected.`));
                        console.error(chalk.yellow(`   This means the worktree metadata in your main repo points to a directory that isn't a valid linked worktree anymore.`));
                        console.log(chalk.cyan(`   Suggested next steps:`));
                        console.log(chalk.cyan(`     1. Try running 'git worktree prune' in your main repository directory. This might clean up the stale metadata.`));
                        console.log(chalk.cyan(`     2. Manually inspect the directory: 'ls -la "${wt.path}/.git"'`));
                        console.log(chalk.cyan(`     3. If you are CERTAIN you don't need the contents, you might need to manually delete the directory: 'rm -rf "${wt.path}"'`));
                        console.log(chalk.cyan(`        (Do this AFTER trying 'git worktree prune' if possible).`));
                        console.log(chalk.yellow(`   Skipping automatic folder deletion for this inconsistent worktree.`));
                        // Do not set removedSuccessfully = true
                        // Do not attempt rm -rf below for this case
                    }
                    else {
                        // Generic error handling for other 'git worktree remove' failures
                        console.error(chalk.red(`Failed to remove worktree metadata for "${wt.branch}":`), stderr || message);
                        // Do not attempt rm -rf if git remove failed unexpectedly
                    }
                } // End of inner try-catch for git worktree remove
                // --- Optional Folder Deletion (Only if Git remove succeeded) ---
                if (removedSuccessfully) {
                    // Optionally remove the physical directory if it still exists *after* git remove succeeded
                    try {
                        await stat(wt.path); // Check if directory still exists
                        console.log(chalk.blue(`Attempting to delete folder ${wt.path}...`));
                        await rm(wt.path, { recursive: true, force: true });
                        console.log(chalk.green(`Deleted folder ${wt.path}.`));
                    }
                    catch (statError) {
                        // If stat fails with 'ENOENT', the directory doesn't exist, which is fine.
                        if (statError.code !== 'ENOENT') {
                            console.warn(chalk.yellow(`Could not check or delete folder ${wt.path}: ${statError.message}`));
                        }
                        else {
                            // Directory already gone, maybe git remove --force deleted it, or it was never there
                            console.log(chalk.grey(`Folder ${wt.path} does not exist or was already removed.`));
                        }
                    }
                }
                else {
                    console.log(chalk.yellow(`Skipping folder deletion for "${wt.path}" because Git worktree removal did not complete successfully.`));
                }
            }
            else {
                console.log(chalk.yellow(`Skipping removal for worktree "${wt.branch}".`));
            }
        } // End of for loop
        console.log(chalk.green("Purge command finished."));
    }
    catch (error) { // Outer catch for initial git worktree list or other setup errors
        if (error instanceof Error) {
            console.error(chalk.red("Failed during purge operation:"), error.message);
        }
        else {
            console.error(chalk.red("Failed during purge operation:"), error);
        }
        process.exit(1);
    }
}
