import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { getDefaultEditor, shouldSkipEditor, getDefaultWorktreePath } from "../config.js";
import { isWorktreeClean, isMainRepoBare, getRepoRoot } from "../utils/git.js";
/**
 * Create or reuse a Git worktree for the given branch, optionally run repository-defined setup commands, install dependencies, and open the worktree in an editor.
 *
 * This handler validates the current repository state (requires a clean main worktree and a non-bare repo), determines or creates a target directory, adds or reuses a worktree for the specified branch, executes safe setup commands from .cursor/worktrees.json or worktrees.json (with a denylist for dangerous patterns), optionally runs an install command in the worktree, and attempts to open the resolved path in the provided or configured editor.
 *
 * @param branchName - Branch to create or open (defaults to "main")
 * @param options.path - Explicit filesystem path or folder name to use for the worktree (if omitted, a sibling folder name is derived from the current directory and branch)
 * @param options.checkout - (unused by this handler) reserved flag to indicate checkout behavior
 * @param options.install - Package manager command to run install (e.g., "npm", "pnpm") inside the worktree
 * @param options.editor - Editor command to open the worktree (overrides the configured default)
 */
export async function setupWorktreeHandler(branchName = "main", options) {
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
            // Check for configured default worktree path
            const defaultWorktreePath = getDefaultWorktreePath();
            if (defaultWorktreePath) {
                // Use configured global worktree directory
                folderName = join(defaultWorktreePath, shortBranchName);
            }
            else {
                // Create a sibling directory using the short branch name
                const currentDir = process.cwd();
                const parentDir = dirname(currentDir);
                const currentDirName = basename(currentDir);
                folderName = join(parentDir, `${currentDirName}-${shortBranchName}`);
            }
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
            // 5. Execute setup-worktree commands if setup file exists
            const repoRoot = await getRepoRoot();
            if (repoRoot) {
                let setupFilePath = null;
                let setupData = null;
                // Check for Cursor's worktrees.json first
                const cursorSetupPath = join(repoRoot, ".cursor", "worktrees.json");
                try {
                    await stat(cursorSetupPath);
                    setupFilePath = cursorSetupPath;
                }
                catch (error) {
                    // Check for worktrees.json
                    const fallbackSetupPath = join(repoRoot, "worktrees.json");
                    try {
                        await stat(fallbackSetupPath);
                        setupFilePath = fallbackSetupPath;
                    }
                    catch (error) {
                        // No setup file found, skip
                    }
                }
                if (setupFilePath) {
                    try {
                        console.log(chalk.blue(`Found setup file: ${setupFilePath}, executing setup commands...`));
                        const setupContent = await readFile(setupFilePath, "utf-8");
                        setupData = JSON.parse(setupContent);
                        let commands = [];
                        if (setupData && typeof setupData === 'object' && !Array.isArray(setupData) && Array.isArray(setupData["setup-worktree"])) {
                            commands = setupData["setup-worktree"];
                        }
                        else if (setupFilePath.includes("worktrees.json") && Array.isArray(setupData)) {
                            // Handle Cursor's format if it's just an array
                            commands = setupData;
                        }
                        if (commands.length > 0) {
                            // Define a denylist of dangerous command patterns
                            const deniedPatterns = [
                                /\brm\s+-rf\b/i, // rm -rf
                                /\brm\s+--recursive\b/i, // rm --recursive
                                /\bsudo\b/i, // sudo
                                /\bsu\b/i, // su (switch user)
                                /\bchmod\b/i, // chmod
                                /\bchown\b/i, // chown
                                /\bcurl\b.*\|\s*sh/i, // curl ... | sh
                                /\bwget\b.*\|\s*sh/i, // wget ... | sh
                                /\bmkfs\b/i, // mkfs (format filesystem)
                                /\bdd\b/i, // dd (disk operations)
                                />\s*\/dev\//i, // redirect to /dev/
                                /\bmv\b.*\/dev\//i, // move to /dev/
                                /\bformat\b/i, // format command
                                /\bshutdown\b/i, // shutdown
                                /\breboot\b/i, // reboot
                                /\binit\s+0/i, // init 0
                                /\bkill\b.*-9/i, // kill -9
                                /:\(\)\{.*\}:/, // fork bomb pattern
                            ];
                            const env = { ...process.env, ROOT_WORKTREE_PATH: repoRoot };
                            for (const command of commands) {
                                // Check if command matches any denied pattern
                                const isDangerous = deniedPatterns.some(pattern => pattern.test(command));
                                if (isDangerous) {
                                    console.warn(chalk.red(`⚠️  Blocked potentially dangerous command: "${command}"`));
                                    console.warn(chalk.yellow(`   This command matches security filters and will not be executed.`));
                                }
                                else {
                                    console.log(chalk.gray(`Executing: ${command}`));
                                    try {
                                        await execa(command, { shell: true, cwd: resolvedPath, env, stdio: "inherit" });
                                    }
                                    catch (cmdError) {
                                        if (cmdError instanceof Error) {
                                            console.error(chalk.red(`Setup command failed: ${command}`), cmdError.message);
                                        }
                                        else {
                                            console.error(chalk.red(`Setup command failed: ${command}`), cmdError);
                                        }
                                        // Continue with other commands
                                    }
                                }
                            }
                            console.log(chalk.green("Setup commands completed."));
                        }
                        else {
                            console.warn(chalk.yellow(`${setupFilePath} does not contain valid setup commands.`));
                        }
                    }
                    catch (error) {
                        if (error instanceof Error) {
                            console.warn(chalk.yellow(`Failed to parse setup file ${setupFilePath}:`), error.message);
                        }
                        else {
                            console.warn(chalk.yellow(`Failed to parse setup file ${setupFilePath}:`), error);
                        }
                    }
                }
                else {
                    console.log(chalk.yellow("No setup file found (.cursor/worktrees.json or worktrees.json)."));
                    console.log(chalk.yellow("Tip: Create a worktrees.json file to automate setup commands."));
                }
            }
            // 6. (Optional) Install dependencies if --install flag is provided
            if (options.install) {
                console.log(chalk.blue(`Installing dependencies using ${options.install} in ${resolvedPath}...`));
                await execa(options.install, ["install"], { cwd: resolvedPath, stdio: "inherit" });
            }
        }
        // 7. Open in the specified editor (or use configured default)
        const configuredEditor = getDefaultEditor();
        const editorCommand = options.editor || configuredEditor; // Use option, then config, fallback is handled by config default
        if (shouldSkipEditor(editorCommand)) {
            console.log(chalk.gray(`Editor set to 'none', skipping editor open.`));
        }
        else {
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
        }
        console.log(chalk.green(`Worktree ${directoryExists ? "opened" : "created"} at ${resolvedPath}.`));
        if (!directoryExists && options.install)
            console.log(chalk.green(`Dependencies installed using ${options.install}.`));
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
