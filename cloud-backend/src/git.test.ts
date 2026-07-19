import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createWorktree, removeWorktree } from './git.js';

let repoRoot: string;

function git(args: string[], cwd = repoRoot): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'cloud-backend-git-test-'));
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  execFileSync('sh', ['-c', 'echo hello > README.md'], { cwd: repoRoot });
  git(['add', 'README.md']);
  git(['commit', '-m', 'initial commit']);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('createWorktree / removeWorktree', () => {
  it('creates a real worktree with a new branch off the base branch', async () => {
    const result = await createWorktree(repoRoot, 'task/test-branch', [], 'main');

    expect(result.branch).toBe('task/test-branch');
    expect(existsSync(result.path)).toBe(true);
    expect(existsSync(path.join(result.path, 'README.md'))).toBe(true);

    const branches = execFileSync('git', ['branch', '--list', 'task/test-branch'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(branches).toContain('task/test-branch');
  });

  it('seeds .claude/ sandbox placeholder files bwrap requires', async () => {
    const result = await createWorktree(repoRoot, 'task/claude-test', [], 'main');

    expect(existsSync(path.join(result.path, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(path.join(result.path, '.claude', 'settings.local.json'))).toBe(true);
  });

  it('rejects a branch name conflicting with an existing local branch prefix', async () => {
    git(['branch', 'task']);

    await expect(createWorktree(repoRoot, 'task/sub-branch', [], 'main')).rejects.toThrow(
      /already exists/,
    );
  });

  it('removeWorktree cleans up the worktree directory and deletes the branch', async () => {
    const result = await createWorktree(repoRoot, 'task/to-remove', [], 'main');
    expect(existsSync(result.path)).toBe(true);

    await removeWorktree(repoRoot, 'task/to-remove', true);

    expect(existsSync(result.path)).toBe(false);
    const branches = execFileSync('git', ['branch', '--list', 'task/to-remove'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(branches.trim()).toBe('');
  });

  it('forceClean removes a stale worktree/branch from a previous run first', async () => {
    const first = await createWorktree(repoRoot, 'task/stale', [], 'main');
    // Simulate a previous session leaving the worktree behind without going
    // through removeWorktree (e.g. the process crashed).
    const marker = path.join(first.path, 'marker.txt');
    execFileSync('sh', ['-c', `echo old > ${marker}`]);

    const second = await createWorktree(repoRoot, 'task/stale', [], 'main', true);

    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(path.join(second.path, 'README.md'), 'utf8')).toContain('hello');
  });
});
