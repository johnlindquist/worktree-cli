import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { getDefaultEditor, shouldSkipEditor } from "../config.js";
import {
    isWorktreeClean,
    isMainRepoBare,
    stashChanges,
    popStash,
    getUpstreamRemote,
} from "../utils/git.js";
import { resolveWorktreePath, validateBranchName } from "../utils/paths.js";
import { AtomicWorktreeOperation } from "../utils/atomic.js";
import { handleDirtyState } from "../utils/tui.js";
import { runSetupScriptsSecure } from "../utils/setup.js";

export async function setupWorktreeHandler(
    branchName: string = "main",
    options: { path?: string; checkout?: boolean; install?: string; editor?: string; trust?: boolean } = {}
) {
    let stashed = false;

    try {
        // 1. Validate we're in a git repo
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);

        // Validate branch name
        const validation = validateBranchName(branchName);
        if (!validation.isValid) {
            console.error(chalk.red(`Error: ${validation.error}`));
            process.exit(1);
        }

        // 2. Check if this is a bare repository
        const isBare = await isMainRepoBare();

        // 3. Check if main worktree is clean (skip for bare repos)
        if (!isBare) {
            console.log(chalk.blue("Checking if main worktree is clean..."));
            const isClean = await isWorktreeClean(".");

            if (!isClean) {
                const action = await handleDirtyState(
                    "Your main worktree has uncommitted changes."
                );

                if (action === 'abort') {
                    console.log(chalk.yellow("Operation cancelled."));
                    process.exit(0);
                } else if (action === 'stash') {
                    console.log(chalk.blue("Stashing your changes..."));
                    stashed = await stashChanges(".", `wt-setup: Before creating worktree for ${branchName}`);
                    if (stashed) {
                        console.log(chalk.green("Changes stashed successfully."));
                    }
                } else {
                    console.log(chalk.yellow("Proceeding with uncommitted changes..."));
                }
            } else {
                console.log(chalk.green("Main worktree is clean."));
            }
        }

        // 4. Build final path for the new worktree
        const resolvedPath = await resolveWorktreePath(branchName, {
            customPath: options.path,
            useRepoNamespace: true,
        });

        // Check if directory already exists
        let directoryExists = false;
        try {
            await stat(resolvedPath);
            directoryExists = true;
        } catch {
            // Directory doesn't exist, continue with creation
        }

        // 5. Check if branch exists
        const remote = await getUpstreamRemote();
        const { stdout: localBranches } = await execa("git", ["branch", "--list", branchName]);
        const { stdout: remoteBranches } = await execa("git", ["branch", "-r", "--list", `${remote}/${branchName}`]);
        const branchExists = !!localBranches || !!remoteBranches;

        // 6. Create the new worktree or open the editor if it already exists
        if (directoryExists) {
            console.log(chalk.yellow(`Directory already exists at: ${resolvedPath}`));

            let isGitWorktree = false;
            try {
                await stat(join(resolvedPath, ".git"));
                isGitWorktree = true;
            } catch {
                // Not a git worktree
            }

            if (isGitWorktree) {
                console.log(chalk.green(`Using existing worktree at: ${resolvedPath}`));
            } else {
                console.log(chalk.yellow(`Warning: Directory exists but is not a git worktree.`));
            }
        } else {
            console.log(chalk.blue(`Creating new worktree for branch "${branchName}" at: ${resolvedPath}`));

            const atomic = new AtomicWorktreeOperation();

            try {
                if (!branchExists) {
                    console.log(chalk.yellow(`Branch "${branchName}" doesn't exist. Creating new branch with worktree...`));
                    await atomic.createWorktree(resolvedPath, branchName, true);
                } else {
                    console.log(chalk.green(`Using existing branch "${branchName}".`));
                    await atomic.createWorktree(resolvedPath, branchName, false);
                }

                // 7. Execute setup-worktree commands if setup file exists
                // Improvement #6: Replace regex security with trust model
                const setupRan = await runSetupScriptsSecure(resolvedPath, {
                    trust: options.trust,
                });

                if (!setupRan) {
                    console.log(chalk.yellow("No setup file found (.cursor/worktrees.json or worktrees.json)."));
                    console.log(chalk.yellow("Tip: Create a worktrees.json file to automate setup commands."));
                }

                // 8. Install dependencies if specified
                if (options.install) {
                    await atomic.runInstall(options.install, resolvedPath);
                }

                atomic.commit();
            } catch (error: any) {
                console.error(chalk.red("Failed to create worktree:"), error.message);
                await atomic.rollback();
                throw error;
            }
        }

        // 9. Open in the specified editor (or use configured default)
        const configuredEditor = getDefaultEditor();
        const editorCommand = options.editor || configuredEditor;

        if (shouldSkipEditor(editorCommand)) {
            console.log(chalk.gray(`Editor set to 'none', skipping editor open.`));
        } else {
            console.log(chalk.blue(`Opening ${resolvedPath} in ${editorCommand}...`));
            try {
                await execa(editorCommand, [resolvedPath], { stdio: "inherit" });
            } catch (editorError) {
                console.error(chalk.red(`Failed to open editor "${editorCommand}". Please ensure it's installed and in your PATH.`));
                console.warn(chalk.yellow(`Continuing without opening editor.`));
            }
        }

        console.log(chalk.green(`Worktree ${directoryExists ? "opened" : "created"} at ${resolvedPath}.`));
        if (!directoryExists && options.install) {
            console.log(chalk.green(`Dependencies installed using ${options.install}.`));
        }

    } catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red("Failed to create new worktree:"), error.message);
        } else {
            console.error(chalk.red("Failed to create new worktree:"), error);
        }
        process.exit(1);
    } finally {
        // Restore stashed changes if we stashed them
        if (stashed) {
            console.log(chalk.blue("Restoring your stashed changes..."));
            const restored = await popStash(".");
            if (restored) {
                console.log(chalk.green("Changes restored successfully."));
            }
        }
    }
}
