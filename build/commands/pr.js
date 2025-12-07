import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { getDefaultEditor, shouldSkipEditor, getGitProvider, getDefaultWorktreePath } from "../config.js";
import { getCurrentBranch, isWorktreeClean, isMainRepoBare, detectGitProvider } from "../utils/git.js";
import { runSetupScripts } from "../utils/setup.js";
// Helper function to get PR/MR branch name using gh or glab cli
async function getBranchNameFromPR(prNumber, provider) {
    try {
        if (provider === 'gh') {
            const { stdout } = await execa("gh", [
                "pr",
                "view",
                prNumber,
                "--json",
                "headRefName",
                "-q",
                ".headRefName",
            ]);
            const branchName = stdout.trim();
            if (!branchName) {
                throw new Error("Could not extract branch name from PR details.");
            }
            return branchName;
        }
        else {
            const { stdout } = await execa("glab", [
                "mr",
                "view",
                prNumber,
                "-F",
                "json",
            ]);
            const mrData = JSON.parse(stdout);
            const branchName = mrData.source_branch;
            if (!branchName) {
                throw new Error("Could not extract branch name from MR details.");
            }
            return branchName;
        }
    }
    catch (error) {
        const isPR = provider === 'gh';
        const requestType = isPR ? "Pull Request" : "Merge Request";
        const cliName = isPR ? "gh" : "glab";
        if (error.stderr?.includes("Could not find") || error.stderr?.includes("not found")) {
            throw new Error(`${requestType} #${prNumber} not found.`);
        }
        if (error.stderr?.includes(`${cliName} not found`) || error.message?.includes("ENOENT")) {
            throw new Error(`${isPR ? 'GitHub' : 'GitLab'} CLI ('${cliName}') not found. Please install it (brew install ${cliName}) and authenticate (${cliName} auth login).`);
        }
        throw new Error(`Failed to get ${requestType} details: ${error.message || error.stderr || error}`);
    }
}
export async function prWorktreeHandler(prNumber, options) {
    let originalBranch = null;
    try {
        // 1. Validate we're in a git repo
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
        // 2. Determine git provider (from config or auto-detect)
        let provider = getGitProvider();
        const detectedProvider = await detectGitProvider();
        if (detectedProvider && detectedProvider !== provider) {
            console.log(chalk.yellow(`Detected ${detectedProvider === 'gh' ? 'GitHub' : 'GitLab'} repository, but config is set to '${provider}'.`));
            console.log(chalk.yellow(`Using detected provider: ${detectedProvider}`));
            provider = detectedProvider;
        }
        const isPR = provider === 'gh';
        const requestType = isPR ? "PR" : "MR";
        // 3. Check if main worktree is clean
        console.log(chalk.blue("Checking if main worktree is clean..."));
        const isClean = await isWorktreeClean(".");
        if (!isClean) {
            console.error(chalk.red("❌ Error: Your main worktree is not clean."));
            console.error(chalk.yellow(`Running 'wt pr' requires a clean worktree to safely check out the ${requestType} branch temporarily.`));
            console.error(chalk.yellow("Please commit, stash, or discard your changes in the main worktree."));
            console.error(chalk.cyan("Run 'git status' to see the changes."));
            process.exit(1);
        }
        console.log(chalk.green("✅ Main worktree is clean."));
        // 4. Get current branch name to switch back later
        originalBranch = await getCurrentBranch();
        if (!originalBranch) {
            throw new Error("Could not determine the current branch. Ensure you are in a valid git repository.");
        }
        console.log(chalk.blue(`Current branch is "${originalBranch}".`));
        // 5. Get the target branch name from the PR/MR (needed for worktree add)
        console.log(chalk.blue(`Fetching branch name for ${requestType} #${prNumber}...`));
        const prBranchName = await getBranchNameFromPR(prNumber, provider);
        console.log(chalk.green(`${requestType} head branch name: "${prBranchName}"`));
        // 6. Use 'gh pr checkout' or 'glab mr checkout' to fetch and setup tracking in the main worktree
        const cliName = isPR ? 'gh' : 'glab';
        const subCommand = isPR ? 'pr' : 'mr';
        console.log(chalk.blue(`Using '${cliName} ${subCommand} checkout ${prNumber}' to fetch ${requestType} and set up local branch tracking...`));
        try {
            await execa(cliName, [subCommand, "checkout", prNumber], { stdio: 'pipe' });
            console.log(chalk.green(`Successfully checked out ${requestType} #${prNumber} branch "${prBranchName}" locally.`));
        }
        catch (checkoutError) {
            if (checkoutError.stderr?.includes("is already checked out")) {
                console.log(chalk.yellow(`Branch "${prBranchName}" for ${requestType} #${prNumber} is already checked out.`));
            }
            else if (checkoutError.stderr?.includes("Could not find")) {
                throw new Error(`${isPR ? 'Pull Request' : 'Merge Request'} #${prNumber} not found.`);
            }
            else if (checkoutError.stderr?.includes(`${cliName} not found`) || checkoutError.message?.includes("ENOENT")) {
                throw new Error(`${isPR ? 'GitHub' : 'GitLab'} CLI ('${cliName}') not found. Please install it (brew install ${cliName}) and authenticate (${cliName} auth login).`);
            }
            else {
                console.error(chalk.red(`Error during '${cliName} ${subCommand} checkout':`), checkoutError.stderr || checkoutError.stdout || checkoutError.message);
                throw new Error(`Failed to checkout ${requestType} using ${cliName}: ${checkoutError.message}`);
            }
        }
        // 7. Switch back to original branch IMMEDIATELY after checkout
        if (originalBranch) {
            try {
                const currentBranchAfterCheckout = await getCurrentBranch();
                if (currentBranchAfterCheckout === prBranchName && currentBranchAfterCheckout !== originalBranch) {
                    console.log(chalk.blue(`Switching main worktree back to "${originalBranch}" before creating worktree...`));
                    await execa("git", ["checkout", originalBranch]);
                }
                else if (currentBranchAfterCheckout !== originalBranch) {
                    console.log(chalk.yellow(`Current branch is ${currentBranchAfterCheckout}, not ${prBranchName}. Assuming ${cliName} handled checkout correctly.`));
                    await execa("git", ["checkout", originalBranch]);
                }
            }
            catch (checkoutError) {
                console.warn(chalk.yellow(`⚠️ Warning: Failed to switch main worktree back to original branch "${originalBranch}" after ${cliName} checkout. Please check manually.`));
                console.warn(checkoutError.stderr || checkoutError.message);
            }
        }
        // 8. Build final path for the new worktree
        let folderName;
        if (options.path) {
            folderName = options.path;
        }
        else {
            const sanitizedBranchName = prBranchName.replace(/\//g, '-');
            // Check for configured default worktree path
            const defaultWorktreePath = getDefaultWorktreePath();
            if (defaultWorktreePath) {
                // Use configured global worktree directory
                folderName = join(defaultWorktreePath, sanitizedBranchName);
            }
            else {
                // Create a sibling directory using the branch name
                const currentDir = process.cwd();
                const parentDir = dirname(currentDir);
                const currentDirName = basename(currentDir);
                folderName = join(parentDir, `${currentDirName}-${sanitizedBranchName}`);
            }
        }
        const resolvedPath = resolve(folderName);
        // 9. Check if directory already exists
        let directoryExists = false;
        try {
            await stat(resolvedPath);
            directoryExists = true;
        }
        catch (error) {
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
                }
                else if (worktreeInfo) {
                    console.error(chalk.red(`Error: Directory "${resolvedPath}" is a worktree, but it's linked to a different branch, not "${prBranchName}".`));
                    process.exit(1);
                }
                else {
                    console.error(chalk.red(`Error: Directory "${resolvedPath}" exists but is not a Git worktree. Please remove it or choose a different path using --path.`));
                    process.exit(1);
                }
            }
            catch (listError) {
                console.error(chalk.red("Failed to verify existing worktree status."), listError);
                process.exit(1);
            }
        }
        else {
            // 10. Create the worktree using the PR/MR branch
            console.log(chalk.blue(`Creating new worktree for branch "${prBranchName}" at: ${resolvedPath}`));
            try {
                if (await isMainRepoBare()) {
                    console.error(chalk.red("❌ Error: The main repository is configured as 'bare' (core.bare=true)."));
                    console.error(chalk.red("   This prevents normal Git operations. Please fix the configuration:"));
                    console.error(chalk.cyan("   git config core.bare false"));
                    process.exit(1);
                }
                await execa("git", ["worktree", "add", resolvedPath, prBranchName]);
                worktreeCreated = true;
            }
            catch (worktreeError) {
                console.error(chalk.red(`❌ Failed to create worktree for branch "${prBranchName}" at ${resolvedPath}:`), worktreeError.stderr || worktreeError.message);
                if (worktreeError.stderr?.includes("fatal:")) {
                    console.error(chalk.cyan(`   Suggestion: Verify branch "${prBranchName}" exists locally ('git branch') and the path "${resolvedPath}" is valid and empty.`));
                }
                throw worktreeError;
            }
            // 11. (Optional) Run setup scripts
            if (options.setup) {
                console.log(chalk.blue("Running setup scripts..."));
                const setupRan = await runSetupScripts(resolvedPath);
                if (!setupRan) {
                    console.log(chalk.yellow("No setup file found (.cursor/worktrees.json or worktrees.json)."));
                }
            }
            // 12. (Optional) Install dependencies
            if (options.install) {
                console.log(chalk.blue(`Installing dependencies using ${options.install} in ${resolvedPath}...`));
                try {
                    await execa(options.install, ["install"], { cwd: resolvedPath, stdio: "inherit" });
                }
                catch (installError) {
                    console.error(chalk.red(`Failed to install dependencies using ${options.install}:`), installError.message);
                    console.warn(chalk.yellow("Continuing without successful dependency installation."));
                }
            }
        }
        // 12. Open in editor
        const configuredEditor = getDefaultEditor();
        const editorCommand = options.editor || configuredEditor;
        if (shouldSkipEditor(editorCommand)) {
            console.log(chalk.gray(`Editor set to 'none', skipping editor open.`));
        }
        else {
            console.log(chalk.blue(`Opening ${resolvedPath} in ${editorCommand}...`));
            try {
                await execa(editorCommand, [resolvedPath], { stdio: "ignore", detached: true });
            }
            catch (editorError) {
                console.error(chalk.red(`Failed to open editor "${editorCommand}". Please ensure it's installed and in your PATH.`));
                console.warn(chalk.yellow(`Worktree is ready at ${resolvedPath}. You can open it manually.`));
            }
        }
        console.log(chalk.green(`✅ Worktree for ${requestType} #${prNumber} (${prBranchName}) ${worktreeCreated ? "created" : "found"} at ${resolvedPath}.`));
        if (worktreeCreated && options.install)
            console.log(chalk.green(`   Dependencies installed using ${options.install}.`));
        console.log(chalk.green(`   Ready for work. Use 'git push' inside the worktree directory to update the ${requestType}.`));
    }
    catch (error) {
        console.error(chalk.red("❌ Failed to set up worktree from PR/MR:"), error.message || error);
        if (error.stack && !(error.stderr || error.stdout)) {
            console.error(error.stack);
        }
        process.exit(1);
    }
    finally {
        // 13. Ensure we are back on the original branch in the main worktree
        if (originalBranch) {
            try {
                const currentBranchNow = await getCurrentBranch();
                if (currentBranchNow !== originalBranch) {
                    console.log(chalk.blue(`Ensuring main worktree is back on "${originalBranch}"...`));
                    await execa("git", ["checkout", originalBranch]);
                }
            }
            catch (checkoutError) {
                if (!checkoutError.message.includes("already warned")) {
                    console.warn(chalk.yellow(`⚠️ Warning: Final check failed to switch main worktree back to original branch "${originalBranch}". Please check manually.`));
                    console.warn(checkoutError.stderr || checkoutError.message);
                }
            }
        }
    }
}
