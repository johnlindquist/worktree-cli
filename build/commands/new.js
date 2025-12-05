import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { getDefaultEditor } from "../config.js";
import { isWorktreeClean, isMainRepoBare } from "../utils/git.js";
export async function newWorktreeHandler(branchName = "main", options) {
    try {
        // 1. Validate we're in a git repo
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
        console.log(chalk.blue("Checking if main worktree is clean..."));
        const isClean = await isWorktreeClean(".");
        if (!isClean) {
            console.error(chalk.red("❌ Error: Your main worktree is not clean."));
            console.error(chalk.yellow("Creating a new worktree requires a clean main worktree state."));
            console.error(chalk.cyan("Please commit, stash, or discard your changes. Run 'git status' to see the changes."));
            process.exit(1); // Exit if not clean
        }
        else {
            console.log(chalk.green("✅ Main worktree is clean."));
        }
        // 2. Build final path for the new worktree
        let folderName;
        if (options.path) {
            folderName = options.path;
        }
        else {
            // Derive the short name for the directory from the branch name
            // This handles cases like 'feature/login' -> 'login'
            const shortBranchName = branchName.split('/').filter(part => part.length > 0).pop() || branchName;
            const currentDir = process.cwd();
            const parentDir = dirname(currentDir);
            const currentDirName = basename(currentDir);
            // Create a sibling directory using the short branch name
            folderName = join(parentDir, `${currentDirName}-${shortBranchName}`);
        }
        const resolvedPath = resolve(folderName);
        // Check if directory already exists
        let directoryExists = false;
        try {
            await stat(resolvedPath);
            directoryExists = true;
        }
        catch (error) {
            // Directory doesn't exist, continue with creation
        }
        // 3. Check if branch exists
        const { stdout: localBranches } = await execa("git", ["branch", "--list", branchName]);
        const { stdout: remoteBranches } = await execa("git", ["branch", "-r", "--list", `origin/${branchName}`]);
        const branchExists = !!localBranches || !!remoteBranches;
        // 4. Create the new worktree or open the editor if it already exists
        if (directoryExists) {
            console.log(chalk.yellow(`Directory already exists at: ${resolvedPath}`));
            // Check if this is a git worktree by checking for .git file/folder
            let isGitWorktree = false;
            try {
                await stat(join(resolvedPath, ".git"));
                isGitWorktree = true;
            }
            catch (error) {
                // Not a git worktree
            }
            if (isGitWorktree) {
                console.log(chalk.green(`Using existing worktree at: ${resolvedPath}`));
            }
            else {
                console.log(chalk.yellow(`Warning: Directory exists but is not a git worktree.`));
            }
            // Skip to opening editor
        }
        else {
            console.log(chalk.blue(`Creating new worktree for branch "${branchName}" at: ${resolvedPath}`));
            if (await isMainRepoBare()) {
                console.error(chalk.red("❌ Error: The main repository is configured as 'bare' (core.bare=true)."));
                console.error(chalk.red("   This prevents normal Git operations. Please fix the configuration:"));
                console.error(chalk.cyan("   git config core.bare false"));
                process.exit(1);
            }
            if (!branchExists) {
                console.log(chalk.yellow(`Branch "${branchName}" doesn't exist. Creating new branch with worktree...`));
                // Create a new branch and worktree in one command with -b flag
                await execa("git", ["worktree", "add", "-b", branchName, resolvedPath]);
            }
            else {
                console.log(chalk.green(`Using existing branch "${branchName}".`));
                await execa("git", ["worktree", "add", resolvedPath, branchName]);
            }
            // 5. (Optional) Install dependencies if --install flag is provided
            if (options.install) {
                console.log(chalk.blue(`Installing dependencies using ${options.install} in ${resolvedPath}...`));
                await execa(options.install, ["install"], { cwd: resolvedPath, stdio: "inherit" });
            }
        }
        // 6. Open in the specified editor (or use configured default)
        const configuredEditor = getDefaultEditor();
        const editorCommand = options.editor || configuredEditor; // Use option, then config, fallback is handled by config default
        console.log(chalk.blue(`Opening ${resolvedPath} in ${editorCommand}...`));
        // Use try-catch to handle if the editor command fails
        try {
            await execa(editorCommand, [resolvedPath], { stdio: "inherit" });
        }
        catch (editorError) {
            console.error(chalk.red(`Failed to open editor "${editorCommand}". Please ensure it's installed and in your PATH.`));
            // Decide if you want to exit or just warn. Let's warn for now.
            console.warn(chalk.yellow(`Continuing without opening editor.`));
        }
        console.log(chalk.green(`Worktree ${directoryExists ? "opened" : "created"} at ${resolvedPath}.`));
        if (!directoryExists && options.install)
            console.log(chalk.green(`Dependencies installed using ${options.install}.`));
        console.log(chalk.green(`Attempted to open in ${editorCommand}.`));
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red("Failed to create new worktree:"), error.message);
        }
        else {
            console.error(chalk.red("Failed to create new worktree:"), error);
        }
        process.exit(1);
    }
}
