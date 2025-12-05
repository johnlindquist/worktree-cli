import Conf from 'conf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Read package.json dynamically instead of using named imports
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const packageName = packageJson.name;
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
};
const config = new Conf({
    projectName: packageName, // Use the actual package name
    schema,
});
// Function to get the default editor
export function getDefaultEditor() {
    return config.get('defaultEditor');
}
// Function to set the default editor
export function setDefaultEditor(editor) {
    config.set('defaultEditor', editor);
}
// Function to get the git provider
export function getGitProvider() {
    return config.get('gitProvider');
}
// Function to set the git provider
export function setGitProvider(provider) {
    config.set('gitProvider', provider);
}
// Function to get the path to the config file (for debugging/info)
export function getConfigPath() {
    return config.path;
}
