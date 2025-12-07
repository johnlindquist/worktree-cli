import { execa } from "execa";
import chalk from "chalk";
import { getWorktrees } from "../utils/git.js";
export async function listWorktreesHandler() {
    try {
        // Confirm we're in a git repo
        await execa("git", ["rev-parse", "--is-inside-work-tree"]);
        // Get worktrees using the robust parsing utility
        const worktrees = await getWorktrees();
        if (worktrees.length === 0) {
            console.log(chalk.yellow("No worktrees found."));
            return;
        }
        console.log(chalk.blue("Existing worktrees:\n"));
        for (const wt of worktrees) {
            // Build the display string
            const parts = [];
            // Path
            parts.push(wt.path);
            // Branch or detached state
            if (wt.branch) {
                parts.push(chalk.cyan(`[${wt.branch}]`));
            }
            else if (wt.detached) {
                parts.push(chalk.yellow(`(HEAD detached at ${wt.head.substring(0, 7)})`));
            }
            else if (wt.bare) {
                parts.push(chalk.gray('(bare)'));
            }
            // Status indicators
            const indicators = [];
            if (wt.isMain) {
                indicators.push(chalk.blue('main'));
            }
            if (wt.locked) {
                indicators.push(chalk.red('locked'));
            }
            if (wt.prunable) {
                indicators.push(chalk.yellow('prunable'));
            }
            if (indicators.length > 0) {
                parts.push(chalk.gray(`(${indicators.join(', ')})`));
            }
            console.log(parts.join(' '));
        }
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red("Error listing worktrees:"), error.message);
        }
        else {
            console.error(chalk.red("Error listing worktrees:"), error);
        }
        process.exit(1);
    }
}
