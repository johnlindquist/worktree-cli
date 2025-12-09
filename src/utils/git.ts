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

/**
 * Extract the hostname from a Git remote URL.
 *
 * Handles both HTTPS URLs (https://github.com/user/repo.git) and
 * SSH URLs (git@github.com:user/repo.git or ssh://git@github.com/repo).
 *
 * @param remoteUrl - The Git remote URL to parse
 * @returns The lowercase hostname, or null if parsing fails
 */
function getRemoteHostname(remoteUrl: string): string | null {
    try {
        // Handle SSH URLs (e.g., git@github.com:user/repo.git)
        if (remoteUrl.startsWith("git@")) {
            const match = remoteUrl.match(/^git@([^:]+):/);
            if (match) {
                return match[1].toLowerCase();
            }
        }
        // Handle ssh:// URLs (e.g., ssh://git@github.com/repo)
        if (remoteUrl.startsWith("ssh://")) {
            const match = remoteUrl.match(/^ssh:\/\/(?:[^@]+@)?([^/:]+)/);
            if (match) {
                return match[1].toLowerCase();
            }
        }
        // Handle HTTP/HTTPS URLs
        if (remoteUrl.startsWith("http://") || remoteUrl.startsWith("https://")) {
            const urlObj = new URL(remoteUrl);
            return urlObj.hostname.toLowerCase();
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Detect the Git hosting provider (GitHub or GitLab) for the repository.
 *
 * Examines the remote URL for the 'origin' remote and determines whether
 * it points to GitHub or GitLab by parsing the hostname.
 *
 * @param cwd - Working directory used to locate the Git repository (defaults to current directory)
 * @returns `'gh'` if the remote is GitHub, `'glab'` if the remote is GitLab, or `null` if undetectable
 */
export async function detectGitProvider(cwd: string = "."): Promise<'gh' | 'glab' | null> {
    try {
        const { stdout } = await execa("git", ["-C", cwd, "remote", "get-url", "origin"]);
        const remoteUrl = stdout.trim();
        const hostname = getRemoteHostname(remoteUrl);

        if (!hostname) {
            return null;
        }

        // Check for GitHub
        if (hostname === 'github.com') {
            return 'gh';
        }

        // Check for GitLab (gitlab.com or self-hosted gitlab.* domains)
        if (hostname === 'gitlab.com' || /^gitlab\.[a-z.]+$/.test(hostname)) {
            return 'glab';
        }

        return null;
    } catch (error) {
        // Could not get remote URL, return null
        return null;
    }
}

/**
 * Represents a parsed Git worktree with typed fields
 */
export interface WorktreeInfo {
    /** Absolute path to the worktree directory */
    path: string;
    /** HEAD commit hash */
    head: string;
    /** Branch name (short form, e.g., "main" not "refs/heads/main") */
    branch: string | null;
    /** Whether the worktree is in detached HEAD state */
    detached: boolean;
    /** Whether the worktree is locked */
    locked: boolean;
    /** Lock reason if locked */
    lockReason?: string;
    /** Whether the worktree is prunable (stale) */
    prunable: boolean;
    /** Prune reason if prunable */
    pruneReason?: string;
    /** Whether this is the main worktree (not a linked worktree) */
    isMain: boolean;
    /** Whether this is a bare repository worktree */
    bare: boolean;
}

/**
 * Parse git worktree list --porcelain output into typed WorktreeInfo objects
 *
 * Handles all edge cases including:
 * - Bare repositories
 * - Detached HEAD states
 * - Locked worktrees (with optional reason)
 * - Prunable (stale) worktrees
 *
 * @param cwd - Working directory to run git command from
 * @returns Array of WorktreeInfo objects sorted by path
 */
export async function getWorktrees(cwd: string = "."): Promise<WorktreeInfo[]> {
    try {
        const { stdout } = await execa("git", ["-C", cwd, "worktree", "list", "--porcelain"]);

        if (!stdout.trim()) {
            return [];
        }

        // Split by double newline to get individual worktree blocks
        // The porcelain format separates worktrees with blank lines
        const blocks = stdout.split('\n\n').filter(block => block.trim());
        const worktrees: WorktreeInfo[] = [];
        let isFirstWorktree = true;

        for (const block of blocks) {
            const lines = block.split('\n');
            const info: WorktreeInfo = {
                path: '',
                head: '',
                branch: null,
                detached: false,
                locked: false,
                prunable: false,
                isMain: isFirstWorktree,
                bare: false,
            };

            for (const line of lines) {
                if (line.startsWith('worktree ')) {
                    info.path = line.substring('worktree '.length);
                } else if (line.startsWith('HEAD ')) {
                    info.head = line.substring('HEAD '.length);
                } else if (line.startsWith('branch ')) {
                    // Convert refs/heads/branch-name to branch-name
                    const fullRef = line.substring('branch '.length);
                    info.branch = fullRef.replace('refs/heads/', '');
                } else if (line === 'detached') {
                    info.detached = true;
                } else if (line === 'bare') {
                    info.bare = true;
                } else if (line === 'locked') {
                    info.locked = true;
                } else if (line.startsWith('locked ')) {
                    info.locked = true;
                    info.lockReason = line.substring('locked '.length);
                } else if (line === 'prunable') {
                    info.prunable = true;
                } else if (line.startsWith('prunable ')) {
                    info.prunable = true;
                    info.pruneReason = line.substring('prunable '.length);
                }
            }

            if (info.path) {
                worktrees.push(info);
            }
            isFirstWorktree = false;
        }

        return worktrees;
    } catch (error: any) {
        console.error(chalk.red("Failed to list worktrees:"), error.stderr || error.message);
        return [];
    }
}

/**
 * Find a worktree by branch name
 *
 * @param branch - Short branch name to find
 * @param cwd - Working directory to run git command from
 * @returns WorktreeInfo if found, null otherwise
 */
export async function findWorktreeByBranch(branch: string, cwd: string = "."): Promise<WorktreeInfo | null> {
    const worktrees = await getWorktrees(cwd);
    return worktrees.find(wt => wt.branch === branch) || null;
}

/**
 * Find a worktree by path
 *
 * @param path - Path to find (will be compared against worktree paths)
 * @param cwd - Working directory to run git command from
 * @returns WorktreeInfo if found, null otherwise
 */
export async function findWorktreeByPath(targetPath: string, cwd: string = "."): Promise<WorktreeInfo | null> {
    const worktrees = await getWorktrees(cwd);
    const { resolve } = await import('node:path');
    const { realpath } = await import('node:fs/promises');

    // Resolve the target path to its real path (following symlinks)
    // This handles macOS where /var is a symlink to /private/var
    let resolvedTarget: string;
    try {
        resolvedTarget = await realpath(resolve(targetPath));
    } catch {
        resolvedTarget = resolve(targetPath);
    }

    for (const wt of worktrees) {
        let wtRealPath: string;
        try {
            wtRealPath = await realpath(wt.path);
        } catch {
            wtRealPath = resolve(wt.path);
        }

        if (wtRealPath === resolvedTarget) {
            return wt;
        }
    }

    return null;
}

/**
 * Get the repository name from the remote URL or directory name
 *
 * @param cwd - Working directory to run git command from
 * @returns Repository name (e.g., "my-project")
 */
export async function getRepoName(cwd: string = "."): Promise<string> {
    try {
        // Try to get from remote URL first
        const { stdout } = await execa("git", ["-C", cwd, "remote", "get-url", "origin"]);
        const remoteUrl = stdout.trim();

        // Extract repo name from URL
        // Handles: git@github.com:user/repo.git, https://github.com/user/repo.git, etc.
        const match = remoteUrl.match(/\/([^\/]+?)(\.git)?$/);
        if (match && match[1]) {
            return match[1];
        }
    } catch {
        // Fall through to directory name
    }

    // Fallback: use the directory name of the repo root
    const repoRoot = await getRepoRoot(cwd);
    if (repoRoot) {
        const { basename } = await import('node:path');
        return basename(repoRoot);
    }

    return 'repo';
}

/**
 * Stash changes in the current worktree using git stash create
 * This creates a unique, identifiable stash commit and returns its hash
 * to prevent race conditions with concurrent operations.
 *
 * @param cwd - Working directory
 * @param message - Optional stash message
 * @returns Stash hash if changes were stashed, null if working tree was clean
 */
export async function stashChanges(cwd: string = ".", message?: string): Promise<string | null> {
    try {
        // First check if there are any changes to stash
        const { stdout: statusOutput } = await execa("git", ["-C", cwd, "status", "--porcelain"]);
        if (!statusOutput.trim()) {
            // No changes to stash
            return null;
        }

        // Add untracked files to the index temporarily so they're included in the stash
        await execa("git", ["-C", cwd, "add", "-A"]);

        // Create a stash commit and get its hash
        const args = ["stash", "create"];
        if (message) {
            args.push(message);
        }
        const { stdout } = await execa("git", ["-C", cwd, ...args]);
        const stashHash = stdout.trim();

        if (!stashHash) {
            // No changes were stashed (shouldn't happen since we checked above)
            return null;
        }

        // Reset the working directory to HEAD to complete the stash effect
        await execa("git", ["-C", cwd, "reset", "--hard", "HEAD"]);

        // Clean untracked files
        await execa("git", ["-C", cwd, "clean", "-fd"]);

        return stashHash;
    } catch (error: any) {
        console.error(chalk.red("Failed to stash changes:"), error.stderr || error.message);
        return null;
    }
}

/**
 * Apply and drop a specific stash by hash
 * This ensures we restore the exact changes that were stashed, avoiding conflicts
 * with the shared stash stack.
 *
 * @param stashHash - The unique hash of the stash to apply
 * @param cwd - Working directory
 * @returns true if stash was applied successfully
 */
export async function applyAndDropStash(stashHash: string, cwd: string = "."): Promise<boolean> {
    try {
        // Apply the specific stash by hash
        await execa("git", ["-C", cwd, "stash", "apply", stashHash]);
        return true;
    } catch (error: any) {
        console.error(chalk.red("Failed to apply stash:"), error.stderr || error.message);
        return false;
    }
}

/**
 * Pop the most recent stash
 * @deprecated Use applyAndDropStash with a specific hash instead to prevent race conditions
 *
 * @param cwd - Working directory
 * @returns true if stash was popped successfully
 */
export async function popStash(cwd: string = "."): Promise<boolean> {
    try {
        await execa("git", ["-C", cwd, "stash", "pop"]);
        return true;
    } catch (error: any) {
        console.error(chalk.red("Failed to pop stash:"), error.stderr || error.message);
        return false;
    }
}