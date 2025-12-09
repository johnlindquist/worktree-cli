import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { getDefaultEditor, shouldSkipEditor, getGitProvider } from "../config.js";
import {
    isWorktreeClean,
    isMainRepoBare,
    detectGitProvider,
    getWorktrees,
    stashChanges,
    applyAndDropStash,
    getUpstreamRemote,
} from "../utils/git.js";
import { resolveWorktreePath } from "../utils/paths.js";
import { runSetupScriptsSecure } from "../utils/setup.js";
import { AtomicWorktreeOperation } from "../utils/atomic.js";
import { handleDirtyState, selectPullRequest } from "../utils/tui.js";
import { withSpinner } from "../utils/spinner.js";
import { onShutdown } from "../utils/shutdown.js";

type GitProvider = 'gh' | 'glab';

/**
 * Extract repository owner and name from git remote URL
 */
async function getRepoInfo(): Promise<{ owner: string; repo: string }> {
    const { stdout } = await execa("git", ["config", "--get", "remote.origin.url"]);
    const remoteUrl = stdout.trim();

    // Match patterns like:
    // - https://github.com/owner/repo.git
    // - git@github.com:owner/repo.git
    // - https://gitlab.com/owner/repo.git
    // - git@gitlab.com:owner/repo.git
    const match = remoteUrl.match(/[:/]([^/]+)\/([^/]+?)(\.git)?$/);
    if (!match) {
        throw new Error(`Could not parse repository info from remote URL: ${remoteUrl}`);
    }

    return {
        owner: match[1],
        repo: match[2],
    };
}

/**
 * Fetch PR branch name using GitHub REST API
 */
async function fetchGitHubPRBranch(prNumber: string): Promise<string> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw new Error(
            "GITHUB_TOKEN environment variable is required when 'gh' CLI is not installed.\n" +
            "Please set it with: export GITHUB_TOKEN=your_token_here\n" +
            "You can create a token at: https://github.com/settings/tokens"
        );
    }

    const { owner, repo } = await getRepoInfo();
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Pull Request #${prNumber} not found.`);
        }
        if (response.status === 401) {
            throw new Error("GitHub authentication failed. Please check your GITHUB_TOKEN.");
        }
        throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const branchName = data.head?.ref;

    if (!branchName) {
        throw new Error("Could not extract branch name from GitHub API response.");
    }

    return branchName;
}

/**
 * Fetch MR branch name using GitLab REST API
 */
async function fetchGitLabMRBranch(prNumber: string): Promise<string> {
    const token = process.env.GITLAB_TOKEN;
    if (!token) {
        throw new Error(
            "GITLAB_TOKEN environment variable is required when 'glab' CLI is not installed.\n" +
            "Please set it with: export GITLAB_TOKEN=your_token_here\n" +
            "You can create a token at: https://gitlab.com/-/profile/personal_access_tokens"
        );
    }

    const { owner, repo } = await getRepoInfo();
    // GitLab uses URL-encoded project path (owner/repo)
    const projectPath = encodeURIComponent(`${owner}/${repo}`);
    const url = `https://gitlab.com/api/v4/projects/${projectPath}/merge_requests/${prNumber}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Merge Request #${prNumber} not found.`);
        }
        if (response.status === 401) {
            throw new Error("GitLab authentication failed. Please check your GITLAB_TOKEN.");
        }
        throw new Error(`GitLab API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const branchName = data.source_branch;

    if (!branchName) {
        throw new Error("Could not extract branch name from GitLab API response.");
    }

    return branchName;
}

/**
 * Get PR/MR branch name using gh/glab CLI with API fallback
 */
async function getBranchNameFromPR(prNumber: string, provider: GitProvider): Promise<string> {
    const isPR = provider === 'gh';
    const requestType = isPR ? "Pull Request" : "Merge Request";
    const cliName = isPR ? "gh" : "glab";

    try {
        if (provider === 'gh') {
            const { stdout } = await execa("gh", [
                "pr", "view", prNumber,
                "--json", "headRefName",
                "-q", ".headRefName",
            ]);
            const branchName = stdout.trim();
            if (!branchName) {
                throw new Error("Could not extract branch name from PR details.");
            }
            return branchName;
        } else {
            const { stdout } = await execa("glab", ["mr", "view", prNumber, "-o", "json"]);
            let mrData;
            try {
                mrData = JSON.parse(stdout);
            } catch (parseError: any) {
                throw new Error(`Failed to parse GitLab MR response: ${parseError.message}`);
            }
            const branchName = mrData.source_branch;
            if (!branchName) {
                throw new Error("Could not extract branch name from MR details.");
            }
            return branchName;
        }
    } catch (error: any) {
        // Check if this is a "CLI not found" error (ENOENT)
        if (error.code === 'ENOENT' || error.message?.includes("ENOENT")) {
            console.log(chalk.yellow(`${cliName} CLI not found. Attempting to use ${isPR ? 'GitHub' : 'GitLab'} REST API...`));

            try {
                // Fallback to REST API
                if (provider === 'gh') {
                    return await fetchGitHubPRBranch(prNumber);
                } else {
                    return await fetchGitLabMRBranch(prNumber);
                }
            } catch (apiError: any) {
                throw new Error(
                    `Failed to fetch ${requestType} via API: ${apiError.message}\n` +
                    `Alternatively, install the ${cliName} CLI: brew install ${cliName}`
                );
            }
        }

        // Handle other errors from CLI
        if (error.stderr?.includes("Could not find") || error.stderr?.includes("not found")) {
            throw new Error(`${requestType} #${prNumber} not found.`);
        }
        if (error.stderr?.includes(`${cliName} not found`)) {
            throw new Error(`${isPR ? 'GitHub' : 'GitLab'} CLI ('${cliName}') not found. Please install it (brew install ${cliName}) and authenticate (${cliName} auth login).`);
        }
        throw new Error(`Failed to get ${requestType} details: ${error.message || error.stderr || error}`);
    }
}

/**
 * Fetch PR branch directly without checkout (Improvement #3)
 *
 * This fetches the PR ref into a local branch without switching the current working directory.
 */
async function fetchPRBranch(prNumber: string, localBranchName: string, provider: GitProvider): Promise<void> {
    const isPR = provider === 'gh';
    const requestType = isPR ? "PR" : "MR";
    const remote = await getUpstreamRemote();

    if (provider === 'gh') {
        // Fetch the PR head ref directly into a local branch
        // This doesn't require checking out or changing the current branch
        await withSpinner(
            `Fetching ${requestType} #${prNumber} from remote...`,
            async () => {
                await execa("git", [
                    "fetch", remote,
                    `refs/pull/${prNumber}/head:${localBranchName}`,
                ]);
            },
            `Successfully fetched ${requestType} #${prNumber} branch "${localBranchName}".`
        );
    } else {
        // For GitLab, fetch the MR source branch
        // First get the source branch name from the MR
        const branchName = await getBranchNameFromPR(prNumber, provider);
        await withSpinner(
            `Fetching ${requestType} #${prNumber} from remote...`,
            async () => {
                await execa("git", [
                    "fetch", remote,
                    `${branchName}:${localBranchName}`,
                ]);
            },
            `Successfully fetched ${requestType} #${prNumber} branch "${localBranchName}".`
        );
    }
}

export async function prWorktreeHandler(
    prNumber?: string,
    options: { path?: string; install?: string; editor?: string; setup?: boolean; trust?: boolean } = {}
) {
    let stashHash: string | null = null;
    let unregisterShutdown: (() => void) | null = null;

    try {
        // 1. Validate we're in a git repo
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);

        // 2. Determine git provider (from config or auto-detect)
        let provider = getGitProvider();
        const detectedProvider = await detectGitProvider();
        if (detectedProvider && detectedProvider !== provider) {
            console.log(chalk.yellow(`Detected ${detectedProvider === 'gh' ? 'GitHub' : 'GitLab'} repository, but config is set to '${provider}'.`));
            console.log(chalk.yellow(`Using detected provider: ${detectedProvider}`));
            provider = detectedProvider;
        }
        const isPR = provider === 'gh';
        const requestType = isPR ? "PR" : "MR";

        // 3. Interactive PR selection if no number provided (Improvement #4)
        if (!prNumber) {
            const selectedPR = await selectPullRequest(provider);
            if (!selectedPR) {
                console.log(chalk.yellow("No PR/MR selected. Exiting."));
                process.exit(0);
            }
            prNumber = selectedPR;
        }

        // 4. Check if main worktree is clean (Improvement #5)
        const isBare = await isMainRepoBare();

        if (!isBare) {
            console.log(chalk.blue("Checking if main worktree is clean..."));
            const isClean = await isWorktreeClean(".");

            if (!isClean) {
                const action = await handleDirtyState(
                    `Your main worktree has uncommitted changes.`
                );

                if (action === 'abort') {
                    console.log(chalk.yellow("Operation cancelled."));
                    process.exit(0);
                } else if (action === 'stash') {
                    console.log(chalk.blue("Stashing your changes..."));
                    stashHash = await stashChanges(".", `wt-pr: Before creating worktree for ${requestType} #${prNumber}`);
                    if (stashHash) {
                        console.log(chalk.green("Changes stashed successfully."));
                        // Register SIGINT handler to restore stash if interrupted
                        unregisterShutdown = onShutdown(async () => {
                            if (stashHash) {
                                console.log(chalk.blue("Restoring stashed changes due to interruption..."));
                                await applyAndDropStash(stashHash, ".");
                            }
                        });
                    }
                } else {
                    console.log(chalk.yellow("Proceeding with uncommitted changes..."));
                }
            } else {
                console.log(chalk.green("Main worktree is clean."));
            }
        }

        // 5. Get the target branch name from the PR/MR
        console.log(chalk.blue(`Fetching branch name for ${requestType} #${prNumber}...`));
        const prBranchName = await getBranchNameFromPR(prNumber, provider);
        console.log(chalk.green(`${requestType} head branch name: "${prBranchName}"`));

        // 6. Improvement #3: Fetch the PR branch directly without checkout
        // This avoids the dangerous context switching that was happening before
        try {
            await fetchPRBranch(prNumber, prBranchName, provider);
        } catch (fetchError: any) {
            // If fetch fails, the branch might already exist locally
            // Try to check if the branch exists
            try {
                await execa("git", ["rev-parse", "--verify", `refs/heads/${prBranchName}`]);
                console.log(chalk.yellow(`Branch "${prBranchName}" already exists locally.`));
            } catch {
                throw new Error(`Failed to fetch ${requestType} branch: ${fetchError.message}`);
            }
        }

        // 7. Build final path for the new worktree (Improvement #1 & #7)
        const resolvedPath = await resolveWorktreePath(prBranchName, {
            customPath: options.path,
            useRepoNamespace: true,
        });

        // 8. Check if directory already exists
        let directoryExists = false;
        try {
            await stat(resolvedPath);
            directoryExists = true;
        } catch {
            // Directory doesn't exist, proceed
        }

        let worktreeCreated = false;

        if (directoryExists) {
            console.log(chalk.yellow(`Directory already exists at: ${resolvedPath}`));

            // Check if it's a git worktree linked to the correct branch
            const worktrees = await getWorktrees();
            const existingWorktree = worktrees.find(wt => wt.path === resolvedPath);

            if (existingWorktree && existingWorktree.branch === prBranchName) {
                console.log(chalk.green(`Existing worktree found at ${resolvedPath} for branch "${prBranchName}".`));
            } else if (existingWorktree) {
                console.error(chalk.red(`Error: Directory "${resolvedPath}" is a worktree, but it's linked to branch "${existingWorktree.branch}", not "${prBranchName}".`));
                process.exit(1);
            } else {
                console.error(chalk.red(`Error: Directory "${resolvedPath}" exists but is not a Git worktree. Please remove it or choose a different path using --path.`));
                process.exit(1);
            }
        } else {
            // 9. Create the worktree using atomic operations (Improvement #9)
            console.log(chalk.blue(`Creating new worktree for branch "${prBranchName}" at: ${resolvedPath}`));

            const atomic = new AtomicWorktreeOperation();

            try {
                await atomic.createWorktree(resolvedPath, prBranchName, false);
                worktreeCreated = true;

                // 10. Run setup scripts if requested (with secure confirmation)
                if (options.setup) {
                    console.log(chalk.blue("Running setup scripts..."));
                    const setupRan = await runSetupScriptsSecure(resolvedPath, {
                        trust: options.trust,
                    });
                    if (!setupRan) {
                        console.log(chalk.yellow("No setup file found (.cursor/worktrees.json or worktrees.json)."));
                    }
                }

                // 11. Install dependencies if requested
                if (options.install) {
                    await atomic.runInstall(options.install, resolvedPath);
                }

                atomic.commit();
            } catch (error: any) {
                console.error(chalk.red(`Failed to create worktree for ${requestType} #${prNumber}:`), error.message);
                await atomic.rollback();
                throw error;
            }
        }

        // 12. Open in editor
        const configuredEditor = getDefaultEditor();
        const editorCommand = options.editor || configuredEditor;

        if (shouldSkipEditor(editorCommand)) {
            console.log(chalk.gray(`Editor set to 'none', skipping editor open.`));
        } else {
            console.log(chalk.blue(`Opening ${resolvedPath} in ${editorCommand}...`));
            try {
                await execa(editorCommand, [resolvedPath], { stdio: "ignore", detached: true });
            } catch (editorError) {
                console.error(chalk.red(`Failed to open editor "${editorCommand}". Please ensure it's installed and in your PATH.`));
                console.warn(chalk.yellow(`Worktree is ready at ${resolvedPath}. You can open it manually.`));
            }
        }

        console.log(chalk.green(`Worktree for ${requestType} #${prNumber} (${prBranchName}) ${worktreeCreated ? "created" : "found"} at ${resolvedPath}.`));
        if (worktreeCreated && options.install) {
            console.log(chalk.green(`Dependencies installed using ${options.install}.`));
        }
        console.log(chalk.green(`Ready for work. Use 'git push' inside the worktree directory to update the ${requestType}.`));

    } catch (error: any) {
        console.error(chalk.red(`Failed to set up worktree from ${prNumber ? `PR/MR #${prNumber}` : 'PR/MR'}:`), error.message || error);
        process.exit(1);
    } finally {
        // Unregister shutdown handler
        if (unregisterShutdown) {
            unregisterShutdown();
        }

        // Restore stashed changes if we stashed them
        if (stashHash) {
            console.log(chalk.blue("Restoring your stashed changes..."));
            const restored = await applyAndDropStash(stashHash, ".");
            if (restored) {
                console.log(chalk.green("Changes restored successfully."));
            }
        }
    }
}
