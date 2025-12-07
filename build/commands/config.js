import chalk from 'chalk';
import { getDefaultEditor, setDefaultEditor, getGitProvider, setGitProvider, getConfigPath, getDefaultWorktreePath, setDefaultWorktreePath, clearDefaultWorktreePath } from '../config.js';
export async function configHandler(action, key, value) {
    try {
        switch (action) {
            case 'get':
                if (key === 'editor') {
                    const editor = getDefaultEditor();
                    console.log(chalk.blue(`Default editor is currently set to: ${chalk.bold(editor)}`));
                }
                else if (key === 'provider') {
                    const provider = getGitProvider();
                    console.log(chalk.blue(`Git provider is currently set to: ${chalk.bold(provider)}`));
                }
                else if (key === 'worktreepath') {
                    const worktreePath = getDefaultWorktreePath();
                    if (worktreePath) {
                        console.log(chalk.blue(`Default worktree path is currently set to: ${chalk.bold(worktreePath)}`));
                    }
                    else {
                        console.log(chalk.blue(`Default worktree path is not set (using sibling directory behavior).`));
                    }
                }
                else {
                    console.error(chalk.red(`Unknown configuration key to get: ${key}`));
                    console.error(chalk.yellow(`Available keys: editor, provider, worktreepath`));
                    process.exit(1);
                }
                break;
            case 'set':
                if (key === 'editor' && value) {
                    setDefaultEditor(value);
                    console.log(chalk.green(`Default editor set to: ${chalk.bold(value)}`));
                }
                else if (key === 'provider' && value) {
                    if (value !== 'gh' && value !== 'glab') {
                        console.error(chalk.red(`Invalid provider: ${value}`));
                        console.error(chalk.yellow(`Valid providers: gh, glab`));
                        process.exit(1);
                    }
                    setGitProvider(value);
                    console.log(chalk.green(`Git provider set to: ${chalk.bold(value)}`));
                }
                else if (key === 'worktreepath' && value) {
                    setDefaultWorktreePath(value);
                    const resolvedPath = getDefaultWorktreePath();
                    console.log(chalk.green(`Default worktree path set to: ${chalk.bold(resolvedPath)}`));
                }
                else if (key === 'editor') {
                    console.error(chalk.red(`You must provide an editor name.`));
                    process.exit(1);
                }
                else if (key === 'provider') {
                    console.error(chalk.red(`You must provide a provider (gh or glab).`));
                    process.exit(1);
                }
                else if (key === 'worktreepath') {
                    console.error(chalk.red(`You must provide a path.`));
                    process.exit(1);
                }
                else {
                    console.error(chalk.red(`Unknown configuration key to set: ${key}`));
                    console.error(chalk.yellow(`Available keys: editor, provider, worktreepath`));
                    process.exit(1);
                }
                break;
            case 'clear':
                if (key === 'worktreepath') {
                    clearDefaultWorktreePath();
                    console.log(chalk.green(`Default worktree path cleared. Will now use sibling directory behavior.`));
                }
                else {
                    console.error(chalk.red(`Unknown configuration key to clear: ${key}`));
                    console.error(chalk.yellow(`Available keys: worktreepath`));
                    process.exit(1);
                }
                break;
            case 'path':
                const configPath = getConfigPath();
                console.log(chalk.blue(`Configuration file path: ${configPath}`));
                break;
            default:
                console.error(chalk.red(`Unknown config action: ${action}`));
                process.exit(1);
        }
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(chalk.red('Configuration command failed:'), error.message);
        }
        else {
            console.error(chalk.red('Configuration command failed:'), error);
        }
        process.exit(1);
    }
}
