import { execa } from "execa";
import chalk from "chalk";
export async function getCurrentBranch(cwd = ".") {
    try {
        const { stdout } = await execa("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
        return stdout.trim();
    }
    catch (error) {
        // Handle case where HEAD is detached or not in a git repo
        console.error(chalk.yellow("Could not determine current branch."), error);
        return null;
    }
}
export async function isWorktreeClean(worktreePath = ".") {
    try {
        // Use --porcelain to get easily parsable output.
        // An empty output means clean (for tracked files).
        // We check the specific worktree path provided, defaulting to current dir.
        const { stdout } = await execa("git", ["-C", worktreePath, "status", "--porcelain"]);
        // If stdout is empty, the worktree is clean regarding tracked/staged files.
        // You might also consider ignoring untracked files depending on strictness,
        // but for operations like checkout, it's safer if it's fully clean.
        // If stdout has anything, it means there are changes (modified, staged, untracked, conflicts etc.)
        if (stdout.trim() === "") {
            return true;
        }
        else {
            // Optional: Log *why* it's not clean for better user feedback
            // console.warn(chalk.yellow("Git status details:\n" + stdout));
            return false;
        }
    }
    catch (error) {
        // If git status itself fails (e.g., not a git repo)
        console.error(chalk.red(`Failed to check git status for ${worktreePath}:`), error.stderr || error.message);
        // Treat failure to check as "not clean" or rethrow, depending on desired behavior.
        // Let's treat it as potentially unsafe to proceed.
        return false;
    }
}
// Add other git-related utilities here in the future
export async function isMainRepoBare(cwd = '.') {
    try {
        // Find the root of the git repository
        const { stdout: gitDir } = await execa('git', ['-C', cwd, 'rev-parse', '--git-dir']);
        const mainRepoDir = gitDir.endsWith('/.git') ? gitDir.slice(0, -5) : gitDir; // Handle bare repo paths vs normal .git
        // Check the core.bare setting specifically for that repository path
        const { stdout: bareConfig } = await execa('git', ['config', '--get', '--bool', 'core.bare'], {
            cwd: mainRepoDir, // Check config in the main repo dir, not the potentially detached worktree CWD
        });
        // stdout will be 'true' or 'false' as a string
        return bareConfig.trim() === 'true';
    }
    catch (error) {
        // If the command fails (e.g., not a git repo, or config not set),
        // assume it's not bare, but log a warning.
        // A non-existent core.bare config defaults to false.
        if (error.exitCode === 1 && error.stdout === '' && error.stderr === '') {
            // This specific exit code/output means the config key doesn't exist, which is fine (defaults to false).
            return false;
        }
        console.warn(chalk.yellow(`Could not reliably determine if the main repository is bare. Proceeding cautiously. Error:`), error.stderr || error.message);
        return false; // Default to non-bare to avoid blocking unnecessarily, but warn the user.
    }
}
export async function getRepoRoot(cwd = ".") {
    try {
        const { stdout } = await execa("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
        return stdout.trim();
    }
    catch (error) {
        console.error(chalk.yellow("Could not determine repository root."), error);
        return null;
    }
}
// Function to detect git provider from remote URL
export async function detectGitProvider(cwd = ".") {
    try {
        const { stdout } = await execa("git", ["-C", cwd, "remote", "get-url", "origin"]);
        const remoteUrl = stdout.trim().toLowerCase();
        if (remoteUrl.includes('github.com')) {
            return 'gh';
        }
        else if (remoteUrl.includes('gitlab.com') || remoteUrl.includes('gitlab.')) {
            return 'glab';
        }
        return null;
    }
    catch (error) {
        // Could not get remote URL, return null
        return null;
    }
}
