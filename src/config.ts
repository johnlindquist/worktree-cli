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
}

// Initialize conf with a schema and project name
// Using the package name ensures a unique storage namespace
const schema = {
    defaultEditor: {
        type: 'string',
        default: 'cursor', // Default editor is 'cursor'
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

// Function to get the path to the config file (for debugging/info)
export function getConfigPath(): string {
    return config.path;
} 