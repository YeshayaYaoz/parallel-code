import * as childProcess from 'child_process';
import fs from 'fs';
import path from 'path';

export type AppendGitInfoExcludeResult = 'appended' | 'present' | 'missing' | 'failed';
type ExecFileSync = typeof childProcess.execFileSync;

/**
 * Joins a filename onto a base path using the base's own separator style
 * rather than the host OS's native one. `path.join` always normalizes its
 * *entire* result to the native separator -- on Windows that silently
 * rewrites an already-forward-slash base (as `git rev-parse
 * --git-common-dir` can return, and as this function's callers pass in
 * tests) into backslashes, corrupting it.
 */
function joinPreservingSeparatorStyle(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return [base.replace(/[/\\]+$/, ''), ...parts].join(sep);
}

export function resolveGitInfoExcludePath(
  worktreePath: string,
  execFileSyncImpl: ExecFileSync = childProcess.execFileSync,
): string | null {
  try {
    const out = execFileSyncImpl('git', ['rev-parse', '--git-common-dir'], {
      cwd: worktreePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    const commonDir = path.isAbsolute(out) ? out : joinPreservingSeparatorStyle(worktreePath, out);
    return joinPreservingSeparatorStyle(commonDir, 'info', 'exclude');
  } catch {
    return null;
  }
}

export function appendGitInfoExcludeBlockAtPath(
  excludePath: string,
  marker: string,
  block: string,
  onError?: (err: unknown) => void,
  knownExisting?: string,
): AppendGitInfoExcludeResult {
  try {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    let existing = knownExisting;
    if (existing === undefined) {
      existing = '';
      try {
        existing = fs.readFileSync(excludePath, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    if (existing.split('\n').some((line) => line.trim() === marker)) return 'present';
    const normalizedBlock = block.replace(/^\n+/, '').endsWith('\n')
      ? block.replace(/^\n+/, '')
      : `${block.replace(/^\n+/, '')}\n`;
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(excludePath, `${prefix}${normalizedBlock}`, 'utf8');
    return 'appended';
  } catch (err) {
    onError?.(err);
    return 'failed';
  }
}

export function appendGitInfoExcludeBlock(
  worktreePath: string,
  marker: string,
  block: string,
  onError?: (err: unknown) => void,
): AppendGitInfoExcludeResult {
  const excludePath = resolveGitInfoExcludePath(worktreePath);
  if (!excludePath) return 'missing';
  return appendGitInfoExcludeBlockAtPath(excludePath, marker, block, onError);
}
