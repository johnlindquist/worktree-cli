import { execa } from "execa";
import chalk from "chalk";

export async function getCurrentBranch(cwd: string = "."): Promise<string | null> {
    try {
        const { stdout } = await execa("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
        return stdout.trim();
    } catch (error) {
        // Handle case where HEAD is detached or not in a git repo
        console.error(chalk.yellow("Could not determine current branch."), error);
        return null;
    }
}

export async function isWorktreeClean(worktreePath: string = "."): Promise<boolean> {
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
        } else {
            // Optional: Log *why* it's not clean for better user feedback
            // console.warn(chalk.yellow("Git status details:\n" + stdout));
            return false;
        }
    } catch (error: any) {
        // If git status itself fails (e.g., not a git repo)
        console.error(chalk.red(`Failed to check git status for ${worktreePath}:`), error.stderr || error.message);
        // Treat failure to check as "not clean" or rethrow, depending on desired behavior.
        // Let's treat it as potentially unsafe to proceed.
        return false;
    }
}

/**
 * Determine whether the main (non-worktree) Git repository is configured as a bare repository.
 *
 * Checks the repository root for the `core.bare` setting and returns its boolean value. If the
 * `core.bare` key does not exist or the check cannot be performed, the function returns `false`
 * and emits a warning.
 *
 * @param cwd - Working directory used to locate the Git repository (defaults to current directory)
 * @returns `true` if the repository's `core.bare` configuration is `true`, `false` otherwise
 */

export async function isMainRepoBare(cwd: string = '.'): Promise<boolean> {
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
    } catch (error: any) {
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

/**
 * Determine the top-level directory of the Git repository containing the given working directory.
 *
 * @param cwd - Path of the working directory to query (defaults to the current directory)
 * @returns The absolute path to the repository's top-level directory, or `null` if it cannot be determined
 */
export async function getRepoRoot(cwd: string = "."): Promise<string | null> {
    try {
        const { stdout } = await execa("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
        return stdout.trim();
    } catch (error) {
        console.error(chalk.yellow("Could not determine repository root."), error);
        return null;
    }
}