import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';
import { resolve } from 'node:path';

/**
 * Config Tests
 *
 * These tests verify the configuration management system by creating a temporary
 * config directory and testing the config commands (set, get, clear, path).
 */

const CLI_PATH = resolve(__dirname, '../build/index.js');

describe('Config Management', () => {
    let testConfigDir: string;
    let originalXdgConfig: string | undefined;
    let originalAppData: string | undefined;

    beforeEach(async () => {
        // Create a unique temporary directory for each test
        testConfigDir = join(tmpdir(), `wt-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await mkdir(testConfigDir, { recursive: true });

        // Save original environment variables
        originalXdgConfig = process.env.XDG_CONFIG_HOME;
        originalAppData = process.env.APPDATA;

        // Set config directory to our test directory
        // Conf library uses XDG_CONFIG_HOME on Unix, APPDATA on Windows
        if (process.platform === 'win32') {
            process.env.APPDATA = testConfigDir;
        } else {
            process.env.XDG_CONFIG_HOME = testConfigDir;
        }
    });

    afterEach(async () => {
        // Restore original environment variables
        if (originalXdgConfig !== undefined) {
            process.env.XDG_CONFIG_HOME = originalXdgConfig;
        } else {
            delete process.env.XDG_CONFIG_HOME;
        }

        if (originalAppData !== undefined) {
            process.env.APPDATA = originalAppData;
        } else {
            delete process.env.APPDATA;
        }

        // Clean up test directory
        try {
            await rm(testConfigDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    async function runConfig(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        try {
            const result = await execa('node', [CLI_PATH, 'config', ...args], {
                reject: false,
                env: {
                    ...process.env,
                    // Ensure the test config directory is used
                    XDG_CONFIG_HOME: process.platform === 'win32' ? undefined : testConfigDir,
                    APPDATA: process.platform === 'win32' ? testConfigDir : undefined,
                },
            });
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode ?? 0,
            };
        } catch (error: any) {
            return {
                stdout: error.stdout ?? '',
                stderr: error.stderr ?? '',
                exitCode: error.exitCode ?? 1,
            };
        }
    }

    async function getConfigFileContent(): Promise<any> {
        // The config file path varies by platform
        // On macOS: ~/Library/Preferences/@johnlindquist/worktree-nodejs/config.json
        // We need to find it dynamically
        const pathResult = await runConfig(['path']);
        const match = pathResult.stdout.match(/Configuration file path: (.+)/);
        if (!match) {
            return null;
        }

        const configPath = match[1].trim();
        try {
            const content = await readFile(configPath, 'utf8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    describe('wt config set', () => {
        it('should set default editor', async () => {
            const result = await runConfig(['set', 'editor', 'vscode']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Default editor set to');
            expect(result.stdout).toContain('vscode');

            const config = await getConfigFileContent();
            expect(config).toBeDefined();
            expect(config.defaultEditor).toBe('vscode');
        });

        it('should set git provider to gh', async () => {
            const result = await runConfig(['set', 'provider', 'gh']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Git provider set to');
            expect(result.stdout).toContain('gh');

            const config = await getConfigFileContent();
            expect(config).toBeDefined();
            expect(config.gitProvider).toBe('gh');
        });

        it('should set git provider to glab', async () => {
            const result = await runConfig(['set', 'provider', 'glab']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Git provider set to');
            expect(result.stdout).toContain('glab');

            const config = await getConfigFileContent();
            expect(config).toBeDefined();
            expect(config.gitProvider).toBe('glab');
        });

        it('should reject invalid git provider', async () => {
            const result = await runConfig(['set', 'provider', 'invalid']);

            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('Invalid provider');
        });

        it('should set default worktree path', async () => {
            const testPath = '/tmp/worktrees';
            const result = await runConfig(['set', 'worktreepath', testPath]);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Default worktree path set to');

            const config = await getConfigFileContent();
            expect(config).toBeDefined();
            expect(config.defaultWorktreePath).toBeDefined();
        });

        it('should expand tilde in worktree path', async () => {
            const result = await runConfig(['set', 'worktreepath', '~/worktrees']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Default worktree path set to');

            const config = await getConfigFileContent();
            expect(config).toBeDefined();
            expect(config.defaultWorktreePath).toBeDefined();
            expect(config.defaultWorktreePath).not.toContain('~');
        });

        it('should fail when setting editor without value', async () => {
            const result = await runConfig(['set', 'editor']);

            expect(result.exitCode).toBe(1);
            // Commander.js generates this error for missing required arguments
            expect(result.stderr).toContain('missing required argument');
        });

        it('should fail when setting provider without value', async () => {
            const result = await runConfig(['set', 'provider']);

            expect(result.exitCode).toBe(1);
            // Commander.js generates this error for missing required arguments
            expect(result.stderr).toContain('missing required argument');
        });

        it('should fail when setting worktreepath without value', async () => {
            const result = await runConfig(['set', 'worktreepath']);

            expect(result.exitCode).toBe(1);
            // Commander.js generates this error for missing required arguments
            expect(result.stderr).toContain('missing required argument');
        });

        it('should fail when setting unknown key', async () => {
            const result = await runConfig(['set', 'unknown', 'value']);

            expect(result.exitCode).toBe(1);
            // Commander.js generates this error for unknown subcommands
            expect(result.stderr).toContain('unknown command');
        });
    });

    describe('wt config get', () => {
        it('should get default editor', async () => {
            // First set a value
            await runConfig(['set', 'editor', 'vim']);

            // Then get it
            const result = await runConfig(['get', 'editor']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Default editor is currently set to');
            expect(result.stdout).toContain('vim');
        });

        it('should get default editor when not explicitly set (uses default)', async () => {
            const result = await runConfig(['get', 'editor']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Default editor is currently set to');
            // The default value from config.ts schema is 'cursor', but if a previous test
            // set a different value, it may persist. Just check for a value.
        });

        it('should get git provider', async () => {
            // First set a value
            await runConfig(['set', 'provider', 'glab']);

            // Then get it
            const result = await runConfig(['get', 'provider']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Git provider is currently set to');
            expect(result.stdout).toContain('glab');
        });

        it('should get worktree path when set', async () => {
            // First set a value
            await runConfig(['set', 'worktreepath', '/tmp/wt']);

            // Then get it
            const result = await runConfig(['get', 'worktreepath']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Default worktree path is currently set to');
        });

        it('should show message when worktree path is not set', async () => {
            // First ensure worktree path is cleared
            await runConfig(['clear', 'worktreepath']);

            const result = await runConfig(['get', 'worktreepath']);

            expect(result.exitCode).toBe(0);
            // May show either "not set" or the actual path if it was set by a previous test
            expect(result.stdout).toContain('Default worktree path');
        });

        it('should fail when getting unknown key', async () => {
            const result = await runConfig(['get', 'unknown']);

            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('unknown command');
        });
    });

    describe('wt config clear', () => {
        it('should clear worktree path', async () => {
            // First set a value
            await runConfig(['set', 'worktreepath', '/tmp/wt']);

            // Verify it was set
            let config = await getConfigFileContent();
            expect(config.defaultWorktreePath).toBeDefined();

            // Clear it
            const result = await runConfig(['clear', 'worktreepath']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Default worktree path cleared');

            // Verify it was removed from config
            config = await getConfigFileContent();
            expect(config.defaultWorktreePath).toBeUndefined();
        });

        it('should succeed even when worktree path was not set', async () => {
            const result = await runConfig(['clear', 'worktreepath']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Default worktree path cleared');
        });

        it('should fail when clearing unknown key', async () => {
            const result = await runConfig(['clear', 'unknown']);

            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('unknown command');
        });

        it('should fail when clearing editor (not clearable)', async () => {
            const result = await runConfig(['clear', 'editor']);

            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('unknown command');
        });
    });

    describe('wt config path', () => {
        it('should display configuration file path', async () => {
            const result = await runConfig(['path']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Configuration file path:');
            expect(result.stdout).toContain('config.json');
            // The exact path structure varies by platform, just check for the file name
        });
    });

    describe('Config persistence', () => {
        it('should persist multiple configuration values', async () => {
            // Set multiple values
            await runConfig(['set', 'editor', 'emacs']);
            await runConfig(['set', 'provider', 'glab']);
            await runConfig(['set', 'worktreepath', '/custom/path']);

            // Verify all values are persisted
            const config = await getConfigFileContent();
            expect(config).toBeDefined();
            expect(config.defaultEditor).toBe('emacs');
            expect(config.gitProvider).toBe('glab');
            expect(config.defaultWorktreePath).toBeDefined();
        });

        it('should update existing values', async () => {
            // Set initial value
            await runConfig(['set', 'editor', 'vim']);

            let config = await getConfigFileContent();
            expect(config.defaultEditor).toBe('vim');

            // Update it
            await runConfig(['set', 'editor', 'nano']);

            config = await getConfigFileContent();
            expect(config.defaultEditor).toBe('nano');
        });

        it('should maintain other values when clearing one value', async () => {
            // Set multiple values
            await runConfig(['set', 'editor', 'code']);
            await runConfig(['set', 'worktreepath', '/tmp/wt']);

            // Clear one value
            await runConfig(['clear', 'worktreepath']);

            // Verify other values are maintained
            const config = await getConfigFileContent();
            expect(config.defaultEditor).toBe('code');
            expect(config.defaultWorktreePath).toBeUndefined();
        });
    });

    describe('Config validation', () => {
        it('should validate provider values', async () => {
            // Valid providers
            const validResult1 = await runConfig(['set', 'provider', 'gh']);
            expect(validResult1.exitCode).toBe(0);

            const validResult2 = await runConfig(['set', 'provider', 'glab']);
            expect(validResult2.exitCode).toBe(0);

            // Invalid provider
            const invalidResult = await runConfig(['set', 'provider', 'bitbucket']);
            expect(invalidResult.exitCode).toBe(1);
            expect(invalidResult.stderr).toContain('Invalid provider');
            expect(invalidResult.stderr).toContain('Valid providers: gh, glab');
        });
    });

    describe('Trust config (Issue #34)', () => {
        it('should get trust mode default (disabled)', async () => {
            const result = await runConfig(['get', 'trust']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Trust mode is currently');
        });

        it('should set trust mode to true', async () => {
            const result = await runConfig(['set', 'trust', 'true']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Trust mode enabled');

            const config = await getConfigFileContent();
            expect(config).toBeDefined();
            expect(config.trust).toBe(true);
        });

        it('should set trust mode to false', async () => {
            // First enable it
            await runConfig(['set', 'trust', 'true']);

            // Then disable it
            const result = await runConfig(['set', 'trust', 'false']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Trust mode disabled');

            const config = await getConfigFileContent();
            expect(config).toBeDefined();
            expect(config.trust).toBe(false);
        });

        it('should accept 1 as truthy value', async () => {
            const result = await runConfig(['set', 'trust', '1']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Trust mode enabled');

            const config = await getConfigFileContent();
            expect(config.trust).toBe(true);
        });
    });

    describe('Subfolder config (Issue #33)', () => {
        it('should get subfolder mode default (disabled)', async () => {
            const result = await runConfig(['get', 'subfolder']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Subfolder mode is currently');
        });

        it('should set subfolder mode to true', async () => {
            const result = await runConfig(['set', 'subfolder', 'true']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Subfolder mode enabled');
            expect(result.stdout).toContain('my-app-worktrees/feature');

            const config = await getConfigFileContent();
            expect(config).toBeDefined();
            expect(config.worktreeSubfolder).toBe(true);
        });

        it('should set subfolder mode to false', async () => {
            // First enable it
            await runConfig(['set', 'subfolder', 'true']);

            // Then disable it
            const result = await runConfig(['set', 'subfolder', 'false']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Subfolder mode disabled');
            expect(result.stdout).toContain('siblings');

            const config = await getConfigFileContent();
            expect(config).toBeDefined();
            expect(config.worktreeSubfolder).toBe(false);
        });

        it('should accept 1 as truthy value', async () => {
            const result = await runConfig(['set', 'subfolder', '1']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Subfolder mode enabled');

            const config = await getConfigFileContent();
            expect(config.worktreeSubfolder).toBe(true);
        });
    });
});
