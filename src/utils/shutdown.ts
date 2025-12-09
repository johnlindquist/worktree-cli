import chalk from "chalk";

type CleanupHandler = () => Promise<void> | void;

/**
 * Graceful shutdown manager for handling SIGINT (Ctrl+C) interruptions
 *
 * This utility ensures that when users interrupt long-running operations,
 * partial state is cleaned up properly (e.g., incomplete worktrees, stashed changes).
 *
 * @example
 * const shutdown = new ShutdownManager();
 * shutdown.register(async () => {
 *   await cleanupPartialWorktree(path);
 * });
 * // ... do work ...
 * shutdown.unregister();
 */
class ShutdownManager {
    private handlers: CleanupHandler[] = [];
    private isShuttingDown: boolean = false;
    private originalSigintHandler: NodeJS.SignalsListener | undefined;

    constructor() {
        this.setupSignalHandlers();
    }

    /**
     * Set up signal handlers for graceful shutdown
     */
    private setupSignalHandlers(): void {
        // Store original handler if it exists
        this.originalSigintHandler = process.listeners('SIGINT')[0] as NodeJS.SignalsListener | undefined;

        // Remove existing handlers to prevent duplicate handling
        process.removeAllListeners('SIGINT');

        // Add our handler
        process.on('SIGINT', async () => {
            await this.handleShutdown('SIGINT');
        });

        // Also handle SIGTERM for completeness
        process.on('SIGTERM', async () => {
            await this.handleShutdown('SIGTERM');
        });
    }

    /**
     * Handle the shutdown signal
     */
    private async handleShutdown(signal: string): Promise<void> {
        if (this.isShuttingDown) {
            // Already shutting down, force exit on second signal
            console.log(chalk.red("\nForce exiting..."));
            process.exit(1);
        }

        this.isShuttingDown = true;
        console.log(chalk.yellow(`\n\nReceived ${signal}. Cleaning up...`));

        // Run all cleanup handlers in reverse order (LIFO)
        for (let i = this.handlers.length - 1; i >= 0; i--) {
            try {
                await this.handlers[i]();
            } catch (error: any) {
                console.error(chalk.red(`Cleanup error: ${error.message}`));
                // Continue with other handlers
            }
        }

        console.log(chalk.yellow("Cleanup complete. Exiting."));
        process.exit(130); // Standard exit code for SIGINT
    }

    /**
     * Register a cleanup handler to run on shutdown
     *
     * @param handler - Async function to run during shutdown
     * @returns A function to unregister this specific handler
     */
    register(handler: CleanupHandler): () => void {
        this.handlers.push(handler);

        // Return unregister function
        return () => {
            const index = this.handlers.indexOf(handler);
            if (index !== -1) {
                this.handlers.splice(index, 1);
            }
        };
    }

    /**
     * Unregister all handlers (call when operation completes successfully)
     */
    clear(): void {
        this.handlers = [];
    }

    /**
     * Check if we're currently in shutdown mode
     */
    isInShutdown(): boolean {
        return this.isShuttingDown;
    }
}

// Singleton instance
let shutdownManager: ShutdownManager | null = null;

/**
 * Get the singleton shutdown manager instance
 */
export function getShutdownManager(): ShutdownManager {
    if (!shutdownManager) {
        shutdownManager = new ShutdownManager();
    }
    return shutdownManager;
}

/**
 * Register a cleanup handler for graceful shutdown
 *
 * @param handler - Function to call during shutdown
 * @returns Function to unregister the handler
 *
 * @example
 * const unregister = onShutdown(async () => {
 *   await restoreStash(stashHash);
 * });
 * try {
 *   // do work
 * } finally {
 *   unregister();
 * }
 */
export function onShutdown(handler: CleanupHandler): () => void {
    return getShutdownManager().register(handler);
}

/**
 * Higher-order function to wrap an async operation with automatic cleanup on SIGINT
 *
 * @param operation - The async operation to perform
 * @param cleanup - Cleanup function to run if interrupted
 * @returns Result of the operation
 *
 * @example
 * const result = await withCleanup(
 *   async () => {
 *     await createWorktree(path, branch);
 *     return path;
 *   },
 *   async () => {
 *     await removeWorktree(path);
 *   }
 * );
 */
export async function withCleanup<T>(
    operation: () => Promise<T>,
    cleanup: CleanupHandler
): Promise<T> {
    const unregister = onShutdown(cleanup);
    try {
        return await operation();
    } finally {
        unregister();
    }
}
