import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createTask, deleteTask } from './tasks.js';

let repoRoot: string;

function git(args: string[], cwd = repoRoot): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), 'cloud-backend-tasks-test-'));
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

describe('createTask', () => {
  it('creates a real worktree with a slugified branch name under the given prefix', async () => {
    const result = await createTask('My Cool Task', repoRoot, [], 'task', 'main');

    expect(result.branch_name).toMatch(/^task\/my-cool-task-[0-9a-f]{6}$/);
    expect(existsSync(result.worktree_path)).toBe(true);
  });

  it('sanitizes a messy branch prefix into safe path segments', async () => {
    const result = await createTask('Test', repoRoot, [], 'Weird Prefix!!/sub', 'main');

    expect(result.branch_name).toMatch(/^weird-prefix\/sub\/test-[0-9a-f]{6}$/);
  });

  it('falls back to "task" when the prefix sanitizes to nothing', async () => {
    const result = await createTask('Test', repoRoot, [], '!!!', 'main');

    expect(result.branch_name).toMatch(/^task\/test-[0-9a-f]{6}$/);
  });
});

describe('deleteTask', () => {
  it('removes the worktree and deletes the branch', async () => {
    const created = await createTask('Removable', repoRoot, [], 'task', 'main');
    expect(existsSync(created.worktree_path)).toBe(true);

    await deleteTask({
      agentIds: [],
      branchName: created.branch_name,
      deleteBranch: true,
      projectRoot: repoRoot,
    });

    expect(existsSync(created.worktree_path)).toBe(false);
    const branches = execFileSync('git', ['branch', '--list', created.branch_name], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(branches.trim()).toBe('');
  });

  it('tolerates an agentId that is not actually running', async () => {
    const created = await createTask('Fine', repoRoot, [], 'task', 'main');

    await expect(
      deleteTask({
        agentIds: ['no-such-agent'],
        branchName: created.branch_name,
        deleteBranch: false,
        projectRoot: repoRoot,
      }),
    ).resolves.not.toThrow();
  });
});
