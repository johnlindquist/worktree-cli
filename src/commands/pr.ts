import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { getDefaultEditor, shouldSkipEditor } from "../config.js";
import { getCurrentBranch, isWorktreeClean, isMainRepoBare } from "../utils/git.js";

// Helper function to get PR branch name using gh cli
async function getBranchNameFromPR(prNumber: string): Promise<string> {
    try {
        // Use GitHub CLI to get the head ref name (branch name)
        const { stdout } = await execa("gh", [
            "pr",
            "view",
            prNumber,
            "--json",
            "headRefName",
            "-q", // Suppress gh warnings if not tty
            ".headRefName", // Query the JSON output for the branch name
        ]);
        const branchName = stdout.trim();
        if (!branchName) {
            throw new Error("Could not extract branch name from PR details.");
        }
        return branchName;
    } catch (error: any) {
        if (error.stderr?.includes("Could not find pull request")) {
            throw new Error(`Pull Request #${prNumber} not found.`);
        }
        if (error.stderr?.includes("gh not found") || error.message?.includes("ENOENT")) {
            throw new Error("GitHub CLI ('gh') not found. Please install it (brew install gh) and authenticate (gh auth login).");
        }
        throw new Error(`Failed to get PR details: ${error.message || error.stderr || error}`);
    }
}


export async function prWorktreeHandler(
    prNumber: string,
    options: { path?: string; install?: string; editor?: string }
) {
    let originalBranch: string | null = null;
    try {
        // 1. Validate we're in a git repo
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);

        // ====> ADD THE CLEAN CHECK HERE <====
        console.log(chalk.blue("Checking if main worktree is clean..."));
        const isClean = await isWorktreeClean("."); // Check current directory (main worktree)
        if (!isClean) {
            console.error(chalk.red("❌ Error: Your main worktree is not clean."));
            console.error(chalk.yellow("Running 'wt pr' requires a clean worktree to safely check out the PR branch temporarily."));
            console.error(chalk.yellow("Please commit, stash, or discard your changes in the main worktree."));
            console.error(chalk.cyan("Run 'git status' to see the changes."));
            process.exit(1); // Exit cleanly
        }
        console.log(chalk.green("✅ Main worktree is clean."));
        // ====> END OF CLEAN CHECK <====

        // 2. Get current branch name to switch back later
        originalBranch = await getCurrentBranch();
        if (!originalBranch) {
            throw new Error("Could not determine the current branch. Ensure you are in a valid git repository.");
        }
        console.log(chalk.blue(`Current branch is "${originalBranch}".`));


        // 3. Get the target branch name from the PR (needed for worktree add)
        console.log(chalk.blue(`Fetching branch name for PR #${prNumber}...`));
        const prBranchName = await getBranchNameFromPR(prNumber);
        console.log(chalk.green(`PR head branch name: "${prBranchName}"`));

        // 4. Use 'gh pr checkout' to fetch PR and setup tracking in the main worktree
        console.log(chalk.blue(`Using 'gh pr checkout ${prNumber}' to fetch PR and set up local branch tracking...`));
        try {
            await execa("gh", ["pr", "checkout", prNumber], { stdio: 'pipe' }); // Use pipe to capture output/errors if needed
            console.log(chalk.green(`Successfully checked out PR #${prNumber} branch "${prBranchName}" locally.`));
        } catch (ghError: any) {
            if (ghError.stderr?.includes("is already checked out")) {
                console.log(chalk.yellow(`Branch "${prBranchName}" for PR #${prNumber} is already checked out.`));
                // It's already checked out, we might not need to switch, but ensure tracking is set
                // 'gh pr checkout' likely handled tracking. We'll proceed.
            } else if (ghError.stderr?.includes("Could not find pull request")) {
                throw new Error(`Pull Request #${prNumber} not found.`);
            } else if (ghError.stderr?.includes("gh not found") || ghError.message?.includes("ENOENT")) {
                throw new Error("GitHub CLI ('gh') not found. Please install it (brew install gh) and authenticate (gh auth login).");
            } else {
                console.error(chalk.red("Error during 'gh pr checkout':"), ghError.stderr || ghError.stdout || ghError.message);
                throw new Error(`Failed to checkout PR using gh: ${ghError.message}`);
            }
        }

        // 4.5 Switch back to original branch IMMEDIATELY after gh checkout ensures the main worktree is clean
        if (originalBranch) {
            try {
                const currentBranchAfterGh = await getCurrentBranch();
                if (currentBranchAfterGh === prBranchName && currentBranchAfterGh !== originalBranch) {
                    console.log(chalk.blue(`Switching main worktree back to "${originalBranch}" before creating worktree...`));
                    await execa("git", ["checkout", originalBranch]);
                } else if (currentBranchAfterGh !== originalBranch) {
                    console.log(chalk.yellow(`Current branch is ${currentBranchAfterGh}, not ${prBranchName}. Assuming gh handled checkout correctly.`));
                    // If gh failed but left us on a different branch, still try to go back
                    await execa("git", ["checkout", originalBranch]);
                }
            } catch (checkoutError: any) {
                console.warn(chalk.yellow(`⚠️ Warning: Failed to switch main worktree back to original branch "${originalBranch}" after gh checkout. Please check manually.`));
                console.warn(checkoutError.stderr || checkoutError.message);
                // Proceed with caution, worktree add might fail
            }
        }

        // 5. Build final path for the new worktree
        let folderName: string;
        if (options.path) {
            folderName = options.path;
        } else {
            const currentDir = process.cwd();
            const parentDir = dirname(currentDir);
            const currentDirName = basename(currentDir);
            const sanitizedBranchName = prBranchName.replace(/\//g, '-'); // Use PR branch name for consistency
            folderName = join(parentDir, `${currentDirName}-${sanitizedBranchName}`);
        }
        const resolvedPath = resolve(folderName);

        // 6. Check if directory already exists
        let directoryExists = false;
        try {
            await stat(resolvedPath);
            directoryExists = true;
        } catch (error) {
            // Directory doesn't exist, proceed
        }

        let worktreeCreated = false;
        if (directoryExists) {
            console.log(chalk.yellow(`Directory already exists at: ${resolvedPath}`));
            // Check if it's a git worktree linked to the correct branch
            try {
                const worktreeList = await execa("git", ["worktree", "list", "--porcelain"]);
                const worktreeInfo = worktreeList.stdout.split('\n\n').find(info => info.includes(`worktree ${resolvedPath}`));
                if (worktreeInfo && worktreeInfo.includes(`branch refs/heads/${prBranchName}`)) {
                    console.log(chalk.green(`Existing worktree found at ${resolvedPath} for branch "${prBranchName}".`));
                } else if (worktreeInfo) {
                    console.error(chalk.red(`Error: Directory "${resolvedPath}" is a worktree, but it's linked to a different branch, not "${prBranchName}".`));
                    process.exit(1);
                } else {
                    // Directory exists but is not a worktree
                    console.error(chalk.red(`Error: Directory "${resolvedPath}" exists but is not a Git worktree. Please remove it or choose a different path using --path.`));
                    process.exit(1);
                }
            } catch (listError: any) {
                console.error(chalk.red("Failed to verify existing worktree status."), listError);
                process.exit(1);
            }
        } else {
            // 7. Create the worktree using the PR branch (now only fetched/tracked, not checked out here)
            console.log(chalk.blue(`Creating new worktree for branch "${prBranchName}" at: ${resolvedPath}`));
            try {
                // >>> ADD SAFETY CHECK HERE <<<
                if (await isMainRepoBare()) {
                    console.error(chalk.red("❌ Error: The main repository is configured as 'bare' (core.bare=true)."));
                    console.error(chalk.red("   This prevents normal Git operations. Please fix the configuration:"));
                    console.error(chalk.cyan("   git config core.bare false"));
                    process.exit(1);
                }
                // Use the PR branch name which 'gh pr checkout' fetched/tracked locally
                await execa("git", ["worktree", "add", resolvedPath, prBranchName]);
                worktreeCreated = true;
            } catch (worktreeError: any) {
                // The "already checked out" error should ideally not happen with the new flow.
                // Handle other potential worktree add errors.
                console.error(chalk.red(`❌ Failed to create worktree for branch "${prBranchName}" at ${resolvedPath}:`), worktreeError.stderr || worktreeError.message);
                // Suggest checking if the branch exists locally if it fails
                if (worktreeError.stderr?.includes("fatal:")) {
                    console.error(chalk.cyan(`   Suggestion: Verify branch "${prBranchName}" exists locally ('git branch') and the path "${resolvedPath}" is valid and empty.`));
                }
                throw worktreeError; // Rethrow to trigger main catch block and cleanup
            }

            // 8. (Optional) Install dependencies
            if (options.install) {
                console.log(chalk.blue(`Installing dependencies using ${options.install} in ${resolvedPath}...`));
                // Add error handling for install step if desired
                try {
                    await execa(options.install, ["install"], { cwd: resolvedPath, stdio: "inherit" });
                } catch (installError: any) {
                    console.error(chalk.red(`Failed to install dependencies using ${options.install}:`), installError.message);
                    // Decide if you want to continue or exit
                    console.warn(chalk.yellow("Continuing without successful dependency installation."));
                }
            }
        }

        // 9. Open in editor
        const configuredEditor = getDefaultEditor();
        const editorCommand = options.editor || configuredEditor;

        if (shouldSkipEditor(editorCommand)) {
            console.log(chalk.gray(`Editor set to 'none', skipping editor open.`));
        } else {
            console.log(chalk.blue(`Opening ${resolvedPath} in ${editorCommand}...`));
            try {
                await execa(editorCommand, [resolvedPath], { stdio: "ignore", detached: true }); // Detach editor process
            } catch (editorError) {
                console.error(chalk.red(`Failed to open editor "${editorCommand}". Please ensure it's installed and in your PATH.`));
                console.warn(chalk.yellow(`Worktree is ready at ${resolvedPath}. You can open it manually.`));
            }
        }

        console.log(chalk.green(`✅ Worktree for PR #${prNumber} (${prBranchName}) ${worktreeCreated ? "created" : "found"} at ${resolvedPath}.`));
        if (worktreeCreated && options.install) console.log(chalk.green(`   Dependencies installed using ${options.install}.`));
        console.log(chalk.green(`   Ready for work. Use 'git push' inside the worktree directory to update the PR.`));


    } catch (error: any) {
        console.error(chalk.red("❌ Failed to set up worktree from PR:"), error.message || error);
        if (error.stack && !(error.stderr || error.stdout)) { // Avoid printing stack for execa errors if stderr/stdout is present
            console.error(error.stack);
        }
        process.exit(1);
    } finally {
        // 10. Ensure we are back on the original branch in the main worktree
        // This is now mostly a safeguard, as we attempted to switch back earlier.
        if (originalBranch) {
            try {
                const currentBranchNow = await getCurrentBranch();
                if (currentBranchNow !== originalBranch) {
                    console.log(chalk.blue(`Ensuring main worktree is back on "${originalBranch}"...`));
                    await execa("git", ["checkout", originalBranch]);
                }
            } catch (checkoutError: any) {
                // Don't warn again if the previous attempt already warned
                if (!checkoutError.message.includes("already warned")) { // Avoid redundant warnings
                    console.warn(chalk.yellow(`⚠️ Warning: Final check failed to switch main worktree back to original branch "${originalBranch}". Please check manually.`));
                    console.warn(checkoutError.stderr || checkoutError.message);
                }
            }
        }
    }
} 