import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Tests for git utility functions
 */

interface TestContext {
    testDir: string;
    repoDir: string;
    cleanup: () => Promise<void>;
}

async function createTestRepo(): Promise<TestContext> {
    const testDir = join(tmpdir(), `wt-git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const repoDir = join(testDir, 'repo');

    await mkdir(repoDir, { recursive: true });
    await execa('git', ['init'], { cwd: repoDir });
    await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: repoDir });
    await writeFile(join(repoDir, 'README.md'), '# Test\n');
    await execa('git', ['add', '.'], { cwd: repoDir });
    await execa('git', ['commit', '-m', 'Initial'], { cwd: repoDir });

    return {
        testDir,
        repoDir,
        cleanup: async () => {
            try {
                await rm(testDir, { recursive: true, force: true });
            } catch {}
        },
    };
}

describe('getWorktrees', () => {
    let ctx: TestContext;

    beforeAll(async () => {
        ctx = await createTestRepo();
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    it('should return main worktree as first entry', async () => {
        const { getWorktrees } = await import('../src/utils/git.js');
        const worktrees = await getWorktrees(ctx.repoDir);

        expect(worktrees.length).toBeGreaterThan(0);
        expect(worktrees[0].isMain).toBe(true);
        expect(worktrees[0].branch).toBe('main');
    });

    it('should correctly identify branch names', async () => {
        const { getWorktrees } = await import('../src/utils/git.js');

        // Create a feature branch worktree
        const wtPath = join(ctx.testDir, 'feature-wt');
        await execa('git', ['worktree', 'add', '-b', 'feature/test', wtPath], { cwd: ctx.repoDir });

        const worktrees = await getWorktrees(ctx.repoDir);
        const featureWt = worktrees.find(wt => wt.branch === 'feature/test');

        expect(featureWt).toBeDefined();
        expect(featureWt?.path).toContain('feature-wt');

        // Cleanup
        await execa('git', ['worktree', 'remove', '--force', wtPath], { cwd: ctx.repoDir }).catch(() => {});
    });

    it('should handle detached HEAD state', async () => {
        const { getWorktrees } = await import('../src/utils/git.js');

        // Create a detached worktree
        const { stdout: headCommit } = await execa('git', ['rev-parse', 'HEAD'], { cwd: ctx.repoDir });
        const wtPath = join(ctx.testDir, 'detached-wt');
        await execa('git', ['worktree', 'add', '--detach', wtPath, headCommit.trim()], { cwd: ctx.repoDir });

        const worktrees = await getWorktrees(ctx.repoDir);
        const detachedWt = worktrees.find(wt => wt.path.includes('detached-wt'));

        expect(detachedWt).toBeDefined();
        expect(detachedWt?.detached).toBe(true);
        expect(detachedWt?.branch).toBeNull();

        // Cleanup
        await execa('git', ['worktree', 'remove', '--force', wtPath], { cwd: ctx.repoDir }).catch(() => {});
    });
});

describe('findWorktreeByBranch', () => {
    let ctx: TestContext;

    beforeAll(async () => {
        ctx = await createTestRepo();
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    it('should find worktree by branch name', async () => {
        const { findWorktreeByBranch } = await import('../src/utils/git.js');

        const wt = await findWorktreeByBranch('main', ctx.repoDir);
        expect(wt).not.toBeNull();
        expect(wt?.branch).toBe('main');
    });

    it('should return null for non-existent branch', async () => {
        const { findWorktreeByBranch } = await import('../src/utils/git.js');

        const wt = await findWorktreeByBranch('non-existent-branch', ctx.repoDir);
        expect(wt).toBeNull();
    });
});

describe('findWorktreeByPath', () => {
    let ctx: TestContext;

    beforeAll(async () => {
        ctx = await createTestRepo();
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    it('should find worktree by path', async () => {
        const { findWorktreeByPath } = await import('../src/utils/git.js');

        const wt = await findWorktreeByPath(ctx.repoDir, ctx.repoDir);
        expect(wt).not.toBeNull();
        expect(wt?.isMain).toBe(true);
    });

    it('should return null for non-existent path', async () => {
        const { findWorktreeByPath } = await import('../src/utils/git.js');

        const wt = await findWorktreeByPath('/non/existent/path', ctx.repoDir);
        expect(wt).toBeNull();
    });
});

describe('isWorktreeClean', () => {
    let ctx: TestContext;

    beforeAll(async () => {
        ctx = await createTestRepo();
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    it('should return true for clean worktree', async () => {
        const { isWorktreeClean } = await import('../src/utils/git.js');

        const isClean = await isWorktreeClean(ctx.repoDir);
        expect(isClean).toBe(true);
    });

    it('should return false for dirty worktree', async () => {
        const { isWorktreeClean } = await import('../src/utils/git.js');

        // Make the worktree dirty
        await writeFile(join(ctx.repoDir, 'dirty.txt'), 'dirty content');

        const isClean = await isWorktreeClean(ctx.repoDir);
        expect(isClean).toBe(false);

        // Cleanup
        await execa('git', ['checkout', '--', '.'], { cwd: ctx.repoDir }).catch(() => {});
        await rm(join(ctx.repoDir, 'dirty.txt')).catch(() => {});
    });
});

describe('getCurrentBranch', () => {
    let ctx: TestContext;

    beforeAll(async () => {
        ctx = await createTestRepo();
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    it('should return current branch name', async () => {
        const { getCurrentBranch } = await import('../src/utils/git.js');

        const branch = await getCurrentBranch(ctx.repoDir);
        expect(branch).toBe('main');
    });
});

describe('getRepoRoot', () => {
    let ctx: TestContext;

    beforeAll(async () => {
        ctx = await createTestRepo();
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    it('should return repo root path', async () => {
        const { getRepoRoot } = await import('../src/utils/git.js');

        const root = await getRepoRoot(ctx.repoDir);
        expect(root).not.toBeNull();
        expect(root).toContain('repo');
    });
});

describe('getRepoName', () => {
    let ctx: TestContext;

    beforeAll(async () => {
        ctx = await createTestRepo();
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    it('should return repo directory name when no remote', async () => {
        const { getRepoName } = await import('../src/utils/git.js');

        const name = await getRepoName(ctx.repoDir);
        expect(name).toBe('repo');
    });
});

describe('stashChanges and popStash', () => {
    let ctx: TestContext;

    beforeAll(async () => {
        ctx = await createTestRepo();
    });

    afterAll(async () => {
        await ctx.cleanup();
    });

    it('should stash and pop changes', async () => {
        const { stashChanges, applyAndDropStash, isWorktreeClean } = await import('../src/utils/git.js');

        // Make changes
        await writeFile(join(ctx.repoDir, 'stash-test.txt'), 'stash content');
        await execa('git', ['add', '.'], { cwd: ctx.repoDir });

        // Verify dirty
        let isClean = await isWorktreeClean(ctx.repoDir);
        expect(isClean).toBe(false);

        // Stash
        const stashHash = await stashChanges(ctx.repoDir, 'test stash');
        expect(stashHash).not.toBeNull();
        expect(typeof stashHash).toBe('string');

        // Verify clean after stash
        isClean = await isWorktreeClean(ctx.repoDir);
        expect(isClean).toBe(true);

        // Apply the stash by hash
        const applied = await applyAndDropStash(stashHash!, ctx.repoDir);
        expect(applied).toBe(true);

        // Verify dirty again
        isClean = await isWorktreeClean(ctx.repoDir);
        expect(isClean).toBe(false);

        // Cleanup
        await execa('git', ['checkout', '--', '.'], { cwd: ctx.repoDir }).catch(() => {});
        await rm(join(ctx.repoDir, 'stash-test.txt')).catch(() => {});
    });

    it('should return null when nothing to stash', async () => {
        const { stashChanges, isWorktreeClean } = await import('../src/utils/git.js');

        // Ensure clean state first
        await execa('git', ['reset', '--hard', 'HEAD'], { cwd: ctx.repoDir }).catch(() => {});
        await execa('git', ['clean', '-fd'], { cwd: ctx.repoDir }).catch(() => {});

        const isClean = await isWorktreeClean(ctx.repoDir);
        expect(isClean).toBe(true);

        const stashHash = await stashChanges(ctx.repoDir);
        expect(stashHash).toBeNull();
    });
});
