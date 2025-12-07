import { execa } from "execa";
import chalk from "chalk";
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getRepoRoot } from "./git.js";

/**
 * Execute setup commands from worktrees.json or .cursor/worktrees.json
 *
 * @param worktreePath - Path to the worktree where commands should be executed
 * @returns true if setup commands were found and executed, false if no setup file exists
 */
export async function runSetupScripts(worktreePath: string): Promise<boolean> {
    const repoRoot = await getRepoRoot();
    if (!repoRoot) {
        console.warn(chalk.yellow("Could not determine repository root. Skipping setup scripts."));
        return false;
    }

    let setupFilePath: string | null = null;
    interface WorktreeSetupData {
        "setup-worktree"?: string[];
        [key: string]: unknown;
    }
    let setupData: WorktreeSetupData | string[] | null = null;

    // Check for Cursor's worktrees.json first
    const cursorSetupPath = join(repoRoot, ".cursor", "worktrees.json");
    try {
        await stat(cursorSetupPath);
        setupFilePath = cursorSetupPath;
    } catch (error) {
        // Check for worktrees.json
        const fallbackSetupPath = join(repoRoot, "worktrees.json");
        try {
            await stat(fallbackSetupPath);
            setupFilePath = fallbackSetupPath;
        } catch (error) {
            // No setup file found
            return false;
        }
    }

    if (!setupFilePath) {
        return false;
    }

    try {
        console.log(chalk.blue(`Found setup file: ${setupFilePath}, executing setup commands...`));
        const setupContent = await readFile(setupFilePath, "utf-8");
        setupData = JSON.parse(setupContent);

        let commands: string[] = [];
        if (setupData && typeof setupData === 'object' && !Array.isArray(setupData) && Array.isArray(setupData["setup-worktree"])) {
            commands = setupData["setup-worktree"];
        } else if (setupFilePath.includes("worktrees.json") && Array.isArray(setupData)) {
            // Handle Cursor's format if it's just an array
            commands = setupData;
        }

        if (commands.length === 0) {
            console.warn(chalk.yellow(`${setupFilePath} does not contain valid setup commands.`));
            return false;
        }

        // Define a denylist of dangerous command patterns
        const deniedPatterns = [
            /\brm\s+-rf\b/i,           // rm -rf
            /\brm\s+--recursive\b/i,   // rm --recursive
            /\bsudo\b/i,               // sudo
            /\bsu\b/i,                 // su (switch user)
            /\bchmod\b/i,              // chmod
            /\bchown\b/i,              // chown
            /\bcurl\b.*\|\s*sh/i,      // curl ... | sh
            /\bwget\b.*\|\s*sh/i,      // wget ... | sh
            /\bmkfs\b/i,               // mkfs (format filesystem)
            /\bdd\b/i,                 // dd (disk operations)
            />\s*\/dev\//i,            // redirect to /dev/
            /\bmv\b.*\/dev\//i,        // move to /dev/
            /\bformat\b/i,             // format command
            /\bshutdown\b/i,           // shutdown
            /\breboot\b/i,             // reboot
            /\binit\s+0/i,             // init 0
            /\bkill\b.*-9/i,           // kill -9
            /:\(\)\{.*\}:/,            // fork bomb pattern
        ];

        const env = { ...process.env, ROOT_WORKTREE_PATH: repoRoot };
        for (const command of commands) {
            // Check if command matches any denied pattern
            const isDangerous = deniedPatterns.some(pattern => pattern.test(command));

            if (isDangerous) {
                console.warn(chalk.red(`⚠️  Blocked potentially dangerous command: "${command}"`));
                console.warn(chalk.yellow(`   This command matches security filters and will not be executed.`));
            } else {
                console.log(chalk.gray(`Executing: ${command}`));
                try {
                    await execa(command, { shell: true, cwd: worktreePath, env, stdio: "inherit" });
                } catch (cmdError: unknown) {
                    if (cmdError instanceof Error) {
                        console.error(chalk.red(`Setup command failed: ${command}`), cmdError.message);
                    } else {
                        console.error(chalk.red(`Setup command failed: ${command}`), cmdError);
                    }
                    // Continue with other commands
                }
            }
        }
        console.log(chalk.green("Setup commands completed."));
        return true;
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.warn(chalk.yellow(`Failed to parse setup file ${setupFilePath}:`), error.message);
        } else {
            console.warn(chalk.yellow(`Failed to parse setup file ${setupFilePath}:`), error);
        }
        return false;
    }
}
