import { describe, it, expect } from 'vitest';
import { resolveWorktreeName, getShortBranchName, validateBranchName } from '../src/utils/paths.js';
describe('Path Utilities', () => {
    describe('resolveWorktreeName', () => {
        it('should replace slashes with dashes', () => {
            expect(resolveWorktreeName('feature/auth')).toBe('feature-auth');
            expect(resolveWorktreeName('hotfix/urgent-fix')).toBe('hotfix-urgent-fix');
            expect(resolveWorktreeName('user/john/feature')).toBe('user-john-feature');
        });
        it('should handle branch names without slashes', () => {
            expect(resolveWorktreeName('main')).toBe('main');
            expect(resolveWorktreeName('develop')).toBe('develop');
        });
        it('should prevent collisions between similar branches', () => {
            // These should produce different names
            const featureAuth = resolveWorktreeName('feature/auth');
            const hotfixAuth = resolveWorktreeName('hotfix/auth');
            expect(featureAuth).not.toBe(hotfixAuth);
            expect(featureAuth).toBe('feature-auth');
            expect(hotfixAuth).toBe('hotfix-auth');
        });
    });
    describe('getShortBranchName', () => {
        it('should return the last segment of a branch name', () => {
            expect(getShortBranchName('feature/auth')).toBe('auth');
            expect(getShortBranchName('hotfix/urgent-fix')).toBe('urgent-fix');
            expect(getShortBranchName('user/john/feature')).toBe('feature');
        });
        it('should handle branch names without slashes', () => {
            expect(getShortBranchName('main')).toBe('main');
            expect(getShortBranchName('develop')).toBe('develop');
        });
        it('should handle empty segments', () => {
            expect(getShortBranchName('feature//auth')).toBe('auth');
            expect(getShortBranchName('/leading-slash')).toBe('leading-slash');
        });
    });
    describe('validateBranchName', () => {
        it('should accept valid branch names', () => {
            expect(validateBranchName('main').isValid).toBe(true);
            expect(validateBranchName('feature/auth').isValid).toBe(true);
            expect(validateBranchName('fix-123').isValid).toBe(true);
            expect(validateBranchName('release/v1.0.0').isValid).toBe(true);
        });
        it('should reject empty branch names', () => {
            expect(validateBranchName('').isValid).toBe(false);
            expect(validateBranchName('   ').isValid).toBe(false);
        });
        it('should reject branch names with spaces', () => {
            const result = validateBranchName('branch with spaces');
            expect(result.isValid).toBe(false);
            expect(result.error).toContain('invalid characters');
        });
        it('should reject branch names with double dots', () => {
            const result = validateBranchName('branch..name');
            expect(result.isValid).toBe(false);
            expect(result.error).toContain('..');
        });
        it('should reject branch names ending with .lock', () => {
            const result = validateBranchName('branch.lock');
            expect(result.isValid).toBe(false);
            expect(result.error).toContain('.lock');
        });
        it('should reject branch names with invalid git characters', () => {
            const invalidChars = ['~', '^', ':', '?', '*', '[', ']', '\\'];
            for (const char of invalidChars) {
                const result = validateBranchName(`branch${char}name`);
                expect(result.isValid).toBe(false);
            }
        });
    });
});
describe('Atomic Operations', () => {
    it('should track rollback actions in order', async () => {
        const { AtomicWorktreeOperation } = await import('../src/utils/atomic.js');
        const atomic = new AtomicWorktreeOperation();
        const rollbackOrder = [];
        await atomic.execute(async () => { }, async () => { rollbackOrder.push(1); });
        await atomic.execute(async () => { }, async () => { rollbackOrder.push(2); });
        await atomic.execute(async () => { }, async () => { rollbackOrder.push(3); });
        await atomic.rollback();
        // Rollback should happen in reverse order (LIFO)
        expect(rollbackOrder).toEqual([3, 2, 1]);
    });
    it('should not rollback after commit', async () => {
        const { AtomicWorktreeOperation } = await import('../src/utils/atomic.js');
        const atomic = new AtomicWorktreeOperation();
        let rolledBack = false;
        await atomic.execute(async () => { }, async () => { rolledBack = true; });
        atomic.commit();
        await atomic.rollback();
        expect(rolledBack).toBe(false);
    });
});
