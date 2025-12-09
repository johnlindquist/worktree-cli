import Conf from 'conf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Read package.json dynamically instead of using named imports
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const packageName = packageJson.name;

// Define the structure of the configuration
interface ConfigSchema {
    defaultEditor: string;
    gitProvider: 'gh' | 'glab';
    defaultWorktreePath?: string;
    trust?: boolean;
    worktreeSubfolder?: boolean;
}

// Initialize conf with a schema and project name
// Using the package name ensures a unique storage namespace
const schema = {
    defaultEditor: {
        type: 'string',
        default: 'cursor', // Default editor is 'cursor'
    },
    gitProvider: {
        type: 'string',
        enum: ['gh', 'glab'],
        default: 'gh', // Default provider is GitHub CLI
    },
    defaultWorktreePath: {
        type: 'string',
        // No default - falls back to sibling directory behavior when not set
    },
    trust: {
        type: 'boolean',
        default: false, // Default is to require confirmation for setup commands
    },
    worktreeSubfolder: {
        type: 'boolean',
        default: false, // Default is sibling directory behavior (my-app-feature)
        // When true: my-app-worktrees/feature subfolder pattern
    },
} as const;

const config = new Conf<ConfigSchema>({
    projectName: packageName, // Use the actual package name
    schema,
});

// Function to get the default editor
export function getDefaultEditor(): string {
    return config.get('defaultEditor');
}

// Function to set the default editor
export function setDefaultEditor(editor: string): void {
    config.set('defaultEditor', editor);
}

// Function to get the git provider
export function getGitProvider(): 'gh' | 'glab' {
    return config.get('gitProvider');
}

// Function to set the git provider
export function setGitProvider(provider: 'gh' | 'glab'): void {
    config.set('gitProvider', provider);
}

// Function to get the path to the config file (for debugging/info)
export function getConfigPath(): string {
    return config.path;
}

// Function to check if the editor should be skipped (value is "none")
export function shouldSkipEditor(editor: string): boolean {
    return editor.toLowerCase() === 'none';
}

// Function to get the default worktree path
export function getDefaultWorktreePath(): string | undefined {
    return config.get('defaultWorktreePath');
}

// Function to set the default worktree path
export function setDefaultWorktreePath(worktreePath: string): void {
    // Resolve to absolute path and expand ~ to home directory
    let resolvedPath: string;
    if (worktreePath.startsWith('~')) {
        const home = process.env.HOME || process.env.USERPROFILE;
        if (!home) {
            throw new Error('Cannot expand ~ in path: HOME or USERPROFILE environment variable is not set');
        }
        const rest = worktreePath.replace(/^~[\/\\]?/, '');
        resolvedPath = path.join(home, rest);
    } else {
        resolvedPath = path.resolve(worktreePath);
    }
    config.set('defaultWorktreePath', resolvedPath);
}

// Function to clear the default worktree path
export function clearDefaultWorktreePath(): void {
    config.delete('defaultWorktreePath');
}

// Function to get the trust setting (bypass setup command confirmation)
export function getTrust(): boolean {
    return config.get('trust') ?? false;
}

// Function to set the trust setting
export function setTrust(trust: boolean): void {
    config.set('trust', trust);
}

// Function to get the worktree subfolder setting
// When true: creates worktrees in my-app-worktrees/feature pattern
// When false: creates worktrees as my-app-feature siblings
export function getWorktreeSubfolder(): boolean {
    return config.get('worktreeSubfolder') ?? false;
}

// Function to set the worktree subfolder setting
export function setWorktreeSubfolder(subfolder: boolean): void {
    config.set('worktreeSubfolder', subfolder);
} 