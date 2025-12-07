import { execa } from "execa";
import chalk from "chalk";
import { rm, stat } from "node:fs/promises";

type RollbackAction = () => Promise<void>;

/**
 * Atomic operation manager for worktree creation
 *
 * Tracks actions and provides rollback capability if any step fails.
 * Use this to wrap multi-step operations that should be all-or-nothing.
 *
 * @example
 * const atomic = new AtomicWorktreeOperation();
 * try {
 *   await atomic.createWorktree(path, branch);
 *   await atomic.runInstall('pnpm', path);
 *   await atomic.commit();
 * } catch (error) {
 *   await atomic.rollback();
 * }
 */
export class AtomicWorktreeOperation {
    private rollbackActions: RollbackAction[] = [];
    private worktreePath: string | null = null;
    private committed: boolean = false;

    /**
     * Create a git worktree with rollback support
     *
     * @param path - Path for the new worktree
     * @param branch - Branch name
     * @param createBranch - Whether to create a new branch with -b flag
     */
    async createWorktree(path: string, branch: string, createBranch: boolean = false): Promise<void> {
        const args = ["worktree", "add"];
        if (createBranch) {
            args.push("-b", branch);
        }
        args.push(path);
        if (!createBranch) {
            args.push(branch);
        }

        await execa("git", args);
        this.worktreePath = path;

        // Register rollback action
        this.rollbackActions.unshift(async () => {
            console.log(chalk.yellow(`Rolling back: Removing worktree at ${path}...`));
            try {
                await execa("git", ["worktree", "remove", "--force", path]);
            } catch (removeError) {
                // If git worktree remove fails, try to clean up manually
                console.warn(chalk.yellow(`Git worktree remove failed, attempting manual cleanup...`));
            }

            // Also remove the directory if it still exists
            try {
                await stat(path);
                await rm(path, { recursive: true, force: true });
                console.log(chalk.gray(`Cleaned up directory: ${path}`));
            } catch {
                // Directory doesn't exist, which is fine
            }
        });
    }

    /**
     * Create a worktree from a remote tracking branch
     *
     * @param path - Path for the new worktree
     * @param branch - Local branch name to create
     * @param remoteBranch - Remote branch to track (e.g., "origin/branch-name")
     */
    async createWorktreeFromRemote(path: string, branch: string, remoteBranch: string): Promise<void> {
        await execa("git", ["worktree", "add", "--track", "-b", branch, path, remoteBranch]);
        this.worktreePath = path;

        this.rollbackActions.unshift(async () => {
            console.log(chalk.yellow(`Rolling back: Removing worktree at ${path}...`));
            try {
                await execa("git", ["worktree", "remove", "--force", path]);
            } catch {
                // Fallback to manual cleanup
            }

            try {
                await stat(path);
                await rm(path, { recursive: true, force: true });
            } catch {
                // Directory doesn't exist
            }

            // Also delete the local branch we created
            try {
                await execa("git", ["branch", "-D", branch]);
                console.log(chalk.gray(`Deleted local branch: ${branch}`));
            } catch {
                // Branch might not exist or be checked out elsewhere
            }
        });
    }

    /**
     * Run package install with rollback awareness
     *
     * @param packageManager - Package manager command (npm, pnpm, yarn, bun)
     * @param cwd - Working directory for the install
     */
    async runInstall(packageManager: string, cwd: string): Promise<void> {
        console.log(chalk.blue(`Installing dependencies with ${packageManager}...`));
        await execa(packageManager, ["install"], { cwd, stdio: "inherit" });
        // No rollback action needed for install - the worktree removal handles it
    }

    /**
     * Run setup commands with rollback awareness
     *
     * @param commands - Array of commands to run
     * @param cwd - Working directory
     * @param env - Environment variables
     */
    async runSetupCommands(commands: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
        console.log(chalk.blue("Running setup commands..."));
        for (const command of commands) {
            console.log(chalk.gray(`Executing: ${command}`));
            await execa(command, { shell: true, cwd, env, stdio: "inherit" });
        }
        // No specific rollback - worktree removal handles cleanup
    }

    /**
     * Execute a custom action with a rollback handler
     *
     * @param action - The action to perform
     * @param rollback - The rollback handler if this or subsequent actions fail
     */
    async execute(action: () => Promise<void>, rollback: RollbackAction): Promise<void> {
        await action();
        this.rollbackActions.unshift(rollback);
    }

    /**
     * Commit the operation - disables rollback
     *
     * Call this when all steps have completed successfully.
     */
    commit(): void {
        this.committed = true;
        this.rollbackActions = [];
    }

    /**
     * Roll back all actions in reverse order
     *
     * Call this if any step fails to restore the system to its previous state.
     */
    async rollback(): Promise<void> {
        if (this.committed) {
            console.log(chalk.yellow("Operation already committed, skipping rollback."));
            return;
        }

        if (this.rollbackActions.length === 0) {
            return;
        }

        console.log(chalk.yellow("\nRolling back changes..."));

        for (const action of this.rollbackActions) {
            try {
                await action();
            } catch (error: any) {
                console.error(chalk.red(`Rollback step failed:`), error.message);
                // Continue with other rollback actions
            }
        }

        console.log(chalk.yellow("Rollback complete."));
        this.rollbackActions = [];
    }

    /**
     * Get the worktree path if one was created
     */
    getWorktreePath(): string | null {
        return this.worktreePath;
    }
}

/**
 * Helper to wrap an operation with automatic rollback on failure
 *
 * @param operation - Function that performs the atomic operation
 * @returns Result of the operation or throws after rollback
 */
export async function withAtomicRollback<T>(
    operation: (atomic: AtomicWorktreeOperation) => Promise<T>
): Promise<T> {
    const atomic = new AtomicWorktreeOperation();

    try {
        const result = await operation(atomic);
        atomic.commit();
        return result;
    } catch (error) {
        await atomic.rollback();
        throw error;
    }
}
