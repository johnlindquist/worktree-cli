import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { getDefaultEditor, shouldSkipEditor } from "../config.js";
import { isWorktreeClean, isMainRepoBare } from "../utils/git.js";
export async function extractWorktreeHandler(branchName, options = {}) {
    try {
        // 1. Validate we're in a git repo
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
        console.log(chalk.blue("Checking if main worktree is clean..."));
        const isClean = await isWorktreeClean(".");
        if (!isClean) {
            console.error(chalk.red("❌ Error: Your main worktree is not clean."));
            console.error(chalk.yellow("Creating a new worktree requires a clean main worktree state."));
            console.error(chalk.cyan("Please commit, stash, or discard your changes. Run 'git status' to see the changes."));
            process.exit(1);
        }
        else {
            console.log(chalk.green("✅ Main worktree is clean."));
        }
        // 2. Determine which branch to extract
        let selectedBranch = branchName;
        if (!selectedBranch) {
            // Get current branch if no branch specified
            const { stdout: currentBranch } = await execa("git", ["branch", "--show-current"]);
            selectedBranch = currentBranch.trim();
            if (!selectedBranch) {
                console.error(chalk.red("❌ Error: Could not determine current branch (possibly in detached HEAD state)."));
                console.error(chalk.yellow("Please specify a branch name: wt extract <branch-name>"));
                process.exit(1);
            }
            console.log(chalk.blue(`No branch specified. Using current branch: ${selectedBranch}`));
        }
        // 3. Get existing worktrees to check if branch already has one
        const { stdout: worktrees } = await execa("git", ["worktree", "list", "--porcelain"]);
        const worktreeBranches = worktrees
            .split('\n')
            .filter(line => line.startsWith('branch refs/heads/'))
            .map(line => line.replace('branch refs/heads/', ''));
        if (worktreeBranches.includes(selectedBranch)) {
            console.error(chalk.red(`❌ Error: Branch "${selectedBranch}" already has a worktree.`));
            console.error(chalk.yellow("Use 'wt list' to see existing worktrees."));
            process.exit(1);
        }
        // 4. Verify the branch exists (either locally or remotely)
        const { stdout: localBranches } = await execa("git", ["branch", "--format=%(refname:short)"]);
        const { stdout: remoteBranches } = await execa("git", ["branch", "-r", "--format=%(refname:short)"]);
        const localBranchList = localBranches.split('\n').filter(b => b.trim() !== '');
        const remoteBranchList = remoteBranches
            .split('\n')
            .filter(b => b.trim() !== '' && b.startsWith('origin/'))
            .map(b => b.replace('origin/', ''));
        const branchExistsLocally = localBranchList.includes(selectedBranch);
        const branchExistsRemotely = remoteBranchList.includes(selectedBranch);
        if (!branchExistsLocally && !branchExistsRemotely) {
            console.error(chalk.red(`❌ Error: Branch "${selectedBranch}" does not exist locally or remotely.`));
            process.exit(1);
        }
        // 5. Build final path for the new worktree
        let folderName;
        if (options.path) {
            folderName = options.path;
        }
        else {
            // Derive the short name for the directory from the branch name
            const shortBranchName = selectedBranch.split('/').filter(part => part.length > 0).pop() || selectedBranch;
            const currentDir = process.cwd();
            const parentDir = dirname(currentDir);
            const currentDirName = basename(currentDir);
            // Create a sibling directory using the short branch name
            folderName = join(parentDir, `${currentDirName}-${shortBranchName}`);
        }
        const resolvedPath = resolve(folderName);
        // Check if directory already exists
        try {
            await stat(resolvedPath);
            console.error(chalk.red(`❌ Error: Directory already exists at: ${resolvedPath}`));
            console.error(chalk.yellow("Please choose a different path with --path option."));
            process.exit(1);
        }
        catch (error) {
            // Directory doesn't exist, continue with creation
        }
        // 6. Check if this is a bare repository
        if (await isMainRepoBare()) {
            console.error(chalk.red("❌ Error: The main repository is configured as 'bare' (core.bare=true)."));
            console.error(chalk.red("   This prevents normal Git operations. Please fix the configuration:"));
            console.error(chalk.cyan("   git config core.bare false"));
            process.exit(1);
        }
        // 7. Create the worktree
        console.log(chalk.blue(`Extracting branch "${selectedBranch}" to worktree at: ${resolvedPath}`));
        // Check if we need to fetch the branch first (if it's only remote)
        if (!branchExistsLocally && branchExistsRemotely) {
            console.log(chalk.yellow(`Branch "${selectedBranch}" is remote-only. Creating local tracking branch...`));
            // Create worktree with remote branch
            await execa("git", ["worktree", "add", "--track", "-b", selectedBranch, resolvedPath, `origin/${selectedBranch}`]);
        }
        else {
            // Branch exists locally
            await execa("git", ["worktree", "add", resolvedPath, selectedBranch]);
        }
        console.log(chalk.green(`✅ Successfully extracted branch "${selectedBranch}" to worktree.`));
        // 8. (Optional) Install dependencies if --install flag is provided
        if (options.install) {
            console.log(chalk.blue(`Installing dependencies using ${options.install} in ${resolvedPath}...`));
            await execa(options.install, ["install"], { cwd: resolvedPath, stdio: "inherit" });
        }
        // 9. Open in the specified editor (or use configured default)
        const configuredEditor = getDefaultEditor();
        const editorCommand = options.editor || configuredEditor;
        if (shouldSkipEditor(editorCommand)) {
            console.log(chalk.gray(`Editor set to 'none', skipping editor open.`));
        }
        else {
            console.log(chalk.blue(`Opening ${resolvedPath} in ${editorCommand}...`));
            try {
                await execa(editorCommand, [resolvedPath], { stdio: "inherit" });
            }
            catch (editorError) {
                console.error(chalk.red(`Failed to open editor "${editorCommand}". Please ensure it's installed and in your PATH.`));
                console.warn(chalk.yellow(`Continuing without opening editor.`));
            }
        }
        console.log(chalk.green(`\n✅ Worktree extracted at ${resolvedPath}.`));
        if (options.install)
            console.log(chalk.green(`✅ Dependencies installed using ${options.install}.`));
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red("Failed to extract worktree:"), error.message);
        }
        else {
            console.error(chalk.red("Failed to extract worktree:"), error);
        }
        process.exit(1);
    }
}
