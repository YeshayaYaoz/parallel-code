import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { changedFilesFromMaps, countReadableTextLines } from './git.js';
import { appendGitInfoExcludeBlock, resolveGitInfoExcludePath } from './git-exclude.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-code-git-helpers-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('changedFilesFromMaps', () => {
  it('builds sorted ChangedFile entries from numstat and status maps', () => {
    const files = changedFilesFromMaps({
      statusMap: new Map([
        ['b.bin', 'D'],
        ['a.ts', 'M'],
      ]),
      numstatMap: new Map([['a.ts', [4, 2]]]),
      committed: true,
    });

    expect(files).toEqual([
      { path: 'a.ts', lines_added: 4, lines_removed: 2, status: 'M', committed: true },
      { path: 'b.bin', lines_added: 0, lines_removed: 0, status: 'D', committed: true },
    ]);
  });

  it('can derive committed from each path', () => {
    const files = changedFilesFromMaps({
      statusMap: new Map([
        ['clean.ts', 'M'],
        ['dirty.ts', 'M'],
      ]),
      numstatMap: new Map([
        ['clean.ts', [1, 0]],
        ['dirty.ts', [2, 1]],
      ]),
      committed: (filePath) => filePath === 'clean.ts',
    });

    expect(files.map((file) => [file.path, file.committed])).toEqual([
      ['clean.ts', true],
      ['dirty.ts', false],
    ]);
  });
});

describe('countReadableTextLines', () => {
  it('does not count a phantom line after a trailing newline', async () => {
    const file = path.join(tempDir(), 'file.txt');
    fs.writeFileSync(file, 'one\ntwo\n', 'utf8');

    await expect(countReadableTextLines(file)).resolves.toBe(2);
  });

  it('returns zero for unreadable files', async () => {
    await expect(countReadableTextLines(path.join(tempDir(), 'missing.txt'))).resolves.toBe(0);
  });
});

describe('git exclude helpers', () => {
  it('resolves the exclude path for normal repositories', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });

    expect(resolveGitInfoExcludePath(root)).toBe(path.join(root, '.git', 'info', 'exclude'));
  });

  it('resolves the exclude path for linked worktrees', () => {
    const root = tempDir();
    const gitDir = path.join(tempDir(), '.git', 'worktrees', 'task');
    fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git'), `gitdir: ${gitDir}\n`, 'utf8');

    expect(resolveGitInfoExcludePath(root)).toBe(path.join(gitDir, 'info', 'exclude'));
  });

  it('appends an idempotent block with newline padding', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
    const excludePath = path.join(root, '.git', 'info', 'exclude');
    fs.writeFileSync(excludePath, 'existing', 'utf8');

    appendGitInfoExcludeBlock(root, '# marker', '# marker\nignored\n');
    appendGitInfoExcludeBlock(root, '# marker', '# marker\nignored\n');

    expect(fs.readFileSync(excludePath, 'utf8')).toBe('existing\n# marker\nignored\n');
  });
});
