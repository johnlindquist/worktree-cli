import prompts from "prompts";
import chalk from "chalk";
import { getWorktrees } from "./git.js";
/**
 * Interactive worktree selector
 *
 * Shows a fuzzy-searchable list of worktrees for the user to select from.
 *
 * @param options.message - Prompt message
 * @param options.excludeMain - Exclude the main worktree from the list
 * @param options.multiSelect - Allow multiple selections
 * @returns Selected worktree(s) or null if cancelled
 */
export async function selectWorktree(options) {
    const { message = "Select a worktree", excludeMain = false, multiSelect = false } = options;
    const worktrees = await getWorktrees();
    if (worktrees.length === 0) {
        console.log(chalk.yellow("No worktrees found."));
        return null;
    }
    let filteredWorktrees = worktrees;
    if (excludeMain) {
        filteredWorktrees = worktrees.filter(wt => !wt.isMain);
        if (filteredWorktrees.length === 0) {
            console.log(chalk.yellow("No worktrees to select (only main worktree exists)."));
            return null;
        }
    }
    const choices = filteredWorktrees.map(wt => ({
        title: formatWorktreeChoice(wt),
        value: wt,
    }));
    if (multiSelect) {
        const response = await prompts({
            type: 'multiselect',
            name: 'worktrees',
            message,
            choices,
            hint: '- Space to select. Enter to confirm.',
            instructions: false,
        });
        if (!response.worktrees || response.worktrees.length === 0) {
            return null;
        }
        return response.worktrees;
    }
    else {
        const response = await prompts({
            type: 'autocomplete',
            name: 'worktree',
            message,
            choices,
            suggest: (input, choices) => {
                const lowercaseInput = input.toLowerCase();
                return Promise.resolve(choices.filter((choice) => choice.title.toLowerCase().includes(lowercaseInput)));
            },
        });
        return response.worktree;
    }
}
/**
 * Format a worktree for display in the selection list
 */
function formatWorktreeChoice(wt) {
    const parts = [];
    // Branch name or detached state
    if (wt.branch) {
        parts.push(chalk.cyan(wt.branch));
    }
    else if (wt.detached) {
        parts.push(chalk.yellow(`(detached at ${wt.head.substring(0, 7)})`));
    }
    else if (wt.bare) {
        parts.push(chalk.gray('(bare)'));
    }
    // Path
    parts.push(chalk.gray(` → ${wt.path}`));
    // Status indicators
    const indicators = [];
    if (wt.isMain) {
        indicators.push(chalk.blue('[main]'));
    }
    if (wt.locked) {
        indicators.push(chalk.red('[locked]'));
    }
    if (wt.prunable) {
        indicators.push(chalk.yellow('[prunable]'));
    }
    if (indicators.length > 0) {
        parts.push(' ' + indicators.join(' '));
    }
    return parts.join('');
}
/**
 * Ask for confirmation with a specific prompt
 *
 * @param message - The confirmation message
 * @param defaultValue - Default value (default: false)
 * @returns true if confirmed, false otherwise
 */
export async function confirm(message, defaultValue = false) {
    const response = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message,
        initial: defaultValue,
    });
    return response.confirmed ?? false;
}
/**
 * Ask the user to input text
 *
 * @param message - The prompt message
 * @param options - Additional options
 * @returns The entered text or null if cancelled
 */
export async function inputText(message, options = {}) {
    const response = await prompts({
        type: 'text',
        name: 'value',
        message,
        initial: options.initial,
        validate: options.validate,
    });
    return response.value ?? null;
}
/**
 * Show commands that will be executed and ask for confirmation
 *
 * @param commands - Array of commands to display
 * @param options - Display options
 * @returns true if user confirms execution
 */
export async function confirmCommands(commands, options = {}) {
    const { title = "The following commands will be executed:", trust = false } = options;
    if (trust) {
        return true;
    }
    console.log(chalk.blue(title));
    console.log();
    for (const cmd of commands) {
        console.log(chalk.gray(`  $ ${cmd}`));
    }
    console.log();
    return confirm("Execute these commands?", false);
}
/**
 * Handle dirty worktree state by offering stash options
 *
 * @param message - Optional custom message
 * @returns 'stash' if user wants to stash, 'abort' to abort, 'continue' to proceed anyway
 */
export async function handleDirtyState(message) {
    console.log(chalk.yellow(message || "Your worktree has uncommitted changes."));
    console.log();
    const response = await prompts({
        type: 'select',
        name: 'action',
        message: 'How would you like to proceed?',
        choices: [
            { title: 'Stash changes (will restore after)', value: 'stash' },
            { title: 'Abort operation', value: 'abort' },
            { title: 'Continue anyway (may cause issues)', value: 'continue' },
        ],
        initial: 0,
    });
    return response.action ?? 'abort';
}
/**
 * Fetch and display open PRs/MRs for selection
 *
 * @param provider - 'gh' for GitHub or 'glab' for GitLab
 * @returns Selected PR/MR number or null if cancelled
 */
export async function selectPullRequest(provider) {
    const { execa } = await import('execa');
    const isPR = provider === 'gh';
    console.log(chalk.blue(`Fetching open ${isPR ? 'Pull Requests' : 'Merge Requests'}...`));
    try {
        let prs = [];
        if (provider === 'gh') {
            const { stdout } = await execa('gh', [
                'pr', 'list',
                '--json', 'number,title,author,headRefName',
                '--limit', '20',
            ]);
            const data = JSON.parse(stdout);
            prs = data.map((pr) => ({
                number: String(pr.number),
                title: pr.title,
                author: pr.author?.login || 'unknown',
                branch: pr.headRefName,
            }));
        }
        else {
            const { stdout } = await execa('glab', [
                'mr', 'list',
                '-o', 'json',
                '--per-page', '20',
            ]);
            const data = JSON.parse(stdout);
            prs = data.map((mr) => ({
                number: String(mr.iid),
                title: mr.title,
                author: mr.author?.username || 'unknown',
                branch: mr.source_branch,
            }));
        }
        if (prs.length === 0) {
            console.log(chalk.yellow(`No open ${isPR ? 'PRs' : 'MRs'} found.`));
            return null;
        }
        const choices = prs.map(pr => ({
            title: `#${pr.number} ${chalk.cyan(pr.title)} ${chalk.gray(`(${pr.branch} by ${pr.author})`)}`,
            value: pr.number,
        }));
        const response = await prompts({
            type: 'autocomplete',
            name: 'pr',
            message: `Select a ${isPR ? 'PR' : 'MR'} to create a worktree from`,
            choices,
            suggest: (input, choices) => {
                const lowercaseInput = input.toLowerCase();
                return Promise.resolve(choices.filter((choice) => choice.title.toLowerCase().includes(lowercaseInput)));
            },
        });
        return response.pr ?? null;
    }
    catch (error) {
        console.error(chalk.red(`Failed to fetch ${isPR ? 'PRs' : 'MRs'}:`), error.message);
        return null;
    }
}
