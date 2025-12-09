import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getDefaultEditor, shouldSkipEditor } from "../config.js";
import { isWorktreeClean, isMainRepoBare, stashChanges, applyAndDropStash, } from "./git.js";
import { handleDirtyState } from "./tui.js";
import { onShutdown } from "./shutdown.js";
/**
 * Execute a worktree workflow with standardized handling for:
 * - Git repository validation
 * - Bare repository detection
 * - Dirty state handling (stash/restore)
 * - Editor opening
 * - SIGINT cleanup
 *
 * This reduces code duplication across commands like `new`, `setup`, `extract`, and `pr`.
 *
 * @example
 * await executeWorkflow({
 *   operation: async (ctx) => {
 *     const path = await createMyWorktree(branch);
 *     return path;
 *   },
 *   openInEditor: true,
 *   options: { stashPrefix: 'wt-new' }
 * });
 */
export async function executeWorkflow(config) {
    const { operation, getEditorPath, openInEditor = true, options = {}, } = config;
    const { editor: customEditor, skipDirtyCheck = false, dirtyStateMessage = "Your main worktree has uncommitted changes.", stashPrefix = "wt-workflow", } = options;
    let stashHash = null;
    let wasStashed = false;
    // Register cleanup handler for SIGINT
    const unregisterShutdown = onShutdown(async () => {
        if (stashHash) {
            console.log(chalk.blue("Restoring stashed changes due to interruption..."));
            await applyAndDropStash(stashHash, ".");
        }
    });
    try {
        // 1. Validate we're in a git repo
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
        // 2. Check if this is a bare repository
        const isBare = await isMainRepoBare();
        // 3. Check if main worktree is clean (skip for bare repos)
        if (!isBare && !skipDirtyCheck) {
            console.log(chalk.blue("Checking if main worktree is clean..."));
            const isClean = await isWorktreeClean(".");
            if (!isClean) {
                const action = await handleDirtyState(dirtyStateMessage);
                if (action === 'abort') {
                    console.log(chalk.yellow("Operation cancelled."));
                    process.exit(0);
                }
                else if (action === 'stash') {
                    console.log(chalk.blue("Stashing your changes..."));
                    stashHash = await stashChanges(".", `${stashPrefix}: Before worktree operation`);
                    if (stashHash) {
                        console.log(chalk.green("Changes stashed successfully."));
                        wasStashed = true;
                    }
                }
                else {
                    console.log(chalk.yellow("Proceeding with uncommitted changes..."));
                }
            }
            else {
                console.log(chalk.green("Main worktree is clean."));
            }
        }
        // Create context for the operation
        const context = {
            isBare,
            stashHash,
            restoreStash: async () => {
                if (stashHash) {
                    console.log(chalk.blue("Restoring your stashed changes..."));
                    const restored = await applyAndDropStash(stashHash, ".");
                    if (restored) {
                        console.log(chalk.green("Changes restored successfully."));
                    }
                    stashHash = null; // Prevent double restore
                }
            },
        };
        // 4. Execute the main operation
        const result = await operation(context);
        // 5. Open in editor if requested
        if (openInEditor && getEditorPath) {
            const editorPath = getEditorPath(result);
            if (editorPath) {
                await openPathInEditor(editorPath, customEditor);
            }
        }
        return { result, wasStashed };
    }
    catch (error) {
        // Re-throw to let caller handle
        throw error;
    }
    finally {
        // Unregister shutdown handler
        unregisterShutdown();
        // Always try to restore stash on exit (success or failure)
        if (stashHash) {
            console.log(chalk.blue("Restoring your stashed changes..."));
            const restored = await applyAndDropStash(stashHash, ".");
            if (restored) {
                console.log(chalk.green("Changes restored successfully."));
            }
        }
    }
}
/**
 * Open a path in the configured or specified editor
 *
 * @param path - Path to open
 * @param customEditor - Optional custom editor command
 */
export async function openPathInEditor(path, customEditor) {
    const configuredEditor = getDefaultEditor();
    const editorCommand = customEditor || configuredEditor;
    if (shouldSkipEditor(editorCommand)) {
        console.log(chalk.gray(`Editor set to 'none', skipping editor open.`));
        return;
    }
    console.log(chalk.blue(`Opening ${path} in ${editorCommand}...`));
    try {
        await execa(editorCommand, [path], { stdio: "inherit" });
    }
    catch (editorError) {
        console.error(chalk.red(`Failed to open editor "${editorCommand}". Please ensure it's installed and in your PATH.`));
        console.warn(chalk.yellow(`Continuing without opening editor.`));
    }
}
/**
 * Check if a path exists and is a git worktree
 *
 * @param path - Path to check
 * @returns Object with exists and isWorktree flags
 */
export async function checkWorktreeStatus(path) {
    let exists = false;
    let isWorktree = false;
    try {
        await stat(path);
        exists = true;
        // Check if it's a git worktree by looking for .git
        try {
            await stat(join(path, ".git"));
            isWorktree = true;
        }
        catch {
            // Not a git worktree
        }
    }
    catch {
        // Directory doesn't exist
    }
    return { exists, isWorktree };
}
/**
 * Validate that we're in a git repository
 *
 * @throws Error if not in a git repository
 */
export async function validateGitRepo() {
    try {
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
    }
    catch {
        throw new Error("Not a git repository. Please run this command from within a git repository.");
    }
}
