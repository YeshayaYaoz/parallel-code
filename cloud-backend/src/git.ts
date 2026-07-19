// Worktree lifecycle logic, extracted from electron/ipc/git.ts. That file
// has no real Electron dependency (its one `BrowserWindow` import there is
// type-only, erased at compile time) — this is the subset createWorktree()/
// removeWorktree() actually need, copied verbatim rather than rewritten so
// behavior (bwrap sandbox seeding, symlink excludes, stale-worktree cleanup)
// matches the desktop app exactly. Branch-detection/diff-stats machinery
// from the original file isn't needed by this subset and was left out.
import { execFile, execFileSync as _execFileSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { debug as logDebug } from './log.js';
import { appendGitInfoExcludeBlockAtPath, resolveGitInfoExcludePath } from './git-exclude.js';

const _exec = promisify(execFile);

const exec: typeof _exec = ((cmd: string, args: string[], options?: unknown) => {
  if (cmd === 'git') logDebug('git', args.join(' '));
  return (_exec as unknown as (...a: unknown[]) => unknown)(cmd, args, options);
}) as typeof _exec;

const execFileSync: typeof _execFileSync = ((cmd: string, args: string[], options?: unknown) => {
  if (cmd === 'git') logDebug('git', args.join(' '));
  return (_execFileSync as unknown as (...a: unknown[]) => unknown)(cmd, args, options);
}) as typeof _execFileSync;

/**
 * Entries inside `.claude/` that must NOT be seeded from the main repo's
 * `.claude/` into new worktrees (per-worktree-local state).
 */
const CLAUDE_DIR_EXCLUDE = new Set(['plans', 'steps.json']);

/**
 * Files Claude Code's sandbox (bwrap) read-only-binds on startup. They must
 * exist at the worktree path or the sandbox fails before Claude launches.
 */
const CLAUDE_REQUIRED_FILES = ['settings.json', 'settings.local.json'];

/**
 * Worktree-root filenames bwrap leaves behind as character-device placeholders
 * when it bind-mounts user-home dotfiles into the Claude Code sandbox. They
 * aren't project files and must not surface in `git status` / changed-files.
 */
const SANDBOX_EXCLUDE_PATTERNS = [
  '/.bash_profile',
  '/.bashrc',
  '/.gitconfig',
  '/.gitmodules',
  '/.mcp.json',
  '/.profile',
  '/.ripgreprc',
  '/.zprofile',
  '/.zshrc',
];
const SANDBOX_EXCLUDE_HEADER = '# parallel-code: sandbox bind-mount artifacts';
const seededSandboxExcludes = new Set<string>();

/**
 * Header written once per repo when symlink excludes are first added. Each
 * symlinked name is appended individually on subsequent calls so new names
 * added in later worktrees are also covered.
 */
const SYMLINK_EXCLUDE_HEADER = '# parallel-code: worktree symlinks';

async function localBranchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await exec('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
      cwd: repoRoot,
    });
    return true;
  } catch {
    return false;
  }
}

async function findLocalBranchPrefixConflict(
  repoRoot: string,
  branchName: string,
): Promise<string | null> {
  const parts = branchName.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    if (await localBranchExists(repoRoot, prefix)) return prefix;
  }
  return null;
}

/**
 * Find the main repository root for a worktree via `git rev-parse
 * --git-common-dir`. Returns null when the cwd isn't inside a git repo.
 */
function detectRepoRoot(worktreePath: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    const abs = path.isAbsolute(out) ? out : path.join(worktreePath, out);
    return path.dirname(abs);
  } catch {
    return null;
  }
}

export function ensureClaudeSandboxFiles(worktreePath: string, repoRoot?: string): void {
  const claudeDir = path.join(worktreePath, '.claude');
  try {
    fs.mkdirSync(claudeDir, { recursive: true });
  } catch (err) {
    console.warn(`Failed to create ${claudeDir}:`, err);
    return;
  }

  // Remove any symlinks under .claude/ — they're leftover from the old
  // shallow-symlink behavior and bwrap cannot bind to them. Real files/dirs
  // are preserved (may contain worktree-local edits).
  let existing: fs.Dirent[] = [];
  try {
    existing = fs.readdirSync(claudeDir, { withFileTypes: true });
  } catch (err) {
    console.warn(`Failed to readdir ${claudeDir}:`, err);
  }
  for (const entry of existing) {
    if (!entry.isSymbolicLink()) continue;
    try {
      fs.unlinkSync(path.join(claudeDir, entry.name));
    } catch (err) {
      console.warn(`Failed to unlink ${path.join(claudeDir, entry.name)}:`, err);
    }
  }

  // Seed missing entries from the main repo's .claude/. Dereferences any
  // symlinks in the source so the copy is pure real files (bwrap-safe).
  const root = repoRoot ?? detectRepoRoot(worktreePath);
  if (root && root !== worktreePath) {
    const source = path.join(root, '.claude');
    if (fs.existsSync(source)) {
      let srcEntries: fs.Dirent[] = [];
      try {
        srcEntries = fs.readdirSync(source, { withFileTypes: true });
      } catch (err) {
        console.warn(`Failed to readdir ${source}:`, err);
      }
      for (const entry of srcEntries) {
        if (CLAUDE_DIR_EXCLUDE.has(entry.name)) continue;
        const dst = path.join(claudeDir, entry.name);
        if (fs.existsSync(dst)) continue;
        try {
          fs.cpSync(path.join(source, entry.name), dst, {
            recursive: true,
            dereference: true,
          });
        } catch (err) {
          console.warn(`Failed to seed ${dst} from source:`, err);
        }
      }
    }
  }

  // Ensure required settings placeholders exist — bwrap binds them even when
  // absent from both worktree and source.
  for (const file of CLAUDE_REQUIRED_FILES) {
    const p = path.join(claudeDir, file);
    if (fs.existsSync(p)) continue;
    try {
      fs.writeFileSync(p, '{}\n');
    } catch (err) {
      console.warn(`Failed to create placeholder ${p}:`, err);
    }
  }
}

/**
 * Append `SANDBOX_EXCLUDE_PATTERNS` to the shared `.git/info/exclude` so the
 * bwrap-left char-device placeholders at the worktree root are filtered out
 * of `git status` / `git ls-files` regardless of what the branch's committed
 * `.gitignore` looks like. Uses the header line as an idempotency marker;
 * safe to call on every agent spawn. Memoized per common git dir for the
 * process lifetime.
 */
export function ensureSandboxExcludes(worktreePath: string): void {
  const excludePath = resolveGitInfoExcludePath(worktreePath, execFileSync);
  if (!excludePath || seededSandboxExcludes.has(excludePath)) return;
  const result = appendGitInfoExcludeBlockAtPath(
    excludePath,
    SANDBOX_EXCLUDE_HEADER,
    `${SANDBOX_EXCLUDE_HEADER}\n${SANDBOX_EXCLUDE_PATTERNS.join('\n')}\n`,
    (err) => console.warn(`Failed to append to ${excludePath}:`, err),
  );
  if (result === 'appended' || result === 'present') seededSandboxExcludes.add(excludePath);
}

/**
 * Add root-anchored exclude entries for symlinked directory names to
 * `.git/info/exclude`. This ensures the symlink is invisible to git even when
 * the project's `.gitignore` uses a trailing-slash form (e.g. `node_modules/`)
 * which only matches real directories, not symlinks. Entries are added
 * incrementally — new names from later worktrees are appended without
 * duplicating already-present entries.
 */
export function ensureSymlinkExcludes(worktreePath: string, symlinkNames: string[]): void {
  if (symlinkNames.length === 0) return;

  const excludePath = resolveGitInfoExcludePath(worktreePath);
  if (!excludePath) return;
  let existing = '';
  try {
    existing = fs.readFileSync(excludePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.warn(`Failed to read ${excludePath}:`, err);
      return;
    }
  }

  // Root-anchored, no trailing slash — matches the symlink file itself, not
  // just directories, so `node_modules/` gitignore entries can't sneak through.
  const toAdd = symlinkNames
    .map((name) => `/${name}`)
    .filter((pattern) => !existing.includes(pattern));

  if (toAdd.length === 0) return;

  const needsHeader = !existing.includes(SYMLINK_EXCLUDE_HEADER);
  const header = needsHeader ? SYMLINK_EXCLUDE_HEADER + '\n' : '';
  appendGitInfoExcludeBlockAtPath(
    excludePath,
    toAdd[0],
    `${header}${toAdd.join('\n')}\n`,
    (err) => console.warn(`Failed to append to ${excludePath}:`, err),
    existing,
  );
}

export async function createWorktree(
  repoRoot: string,
  branchName: string,
  symlinkDirs: string[],
  baseBranch?: string,
  forceClean = false,
): Promise<{ path: string; branch: string }> {
  const worktreePath = path.join(repoRoot, '.worktrees', branchName);

  if (forceClean) {
    // Clean up stale worktree/branch from a previous session that wasn't properly removed
    if (fs.existsSync(worktreePath)) {
      try {
        await exec('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
      } catch {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      await exec('git', ['worktree', 'prune'], { cwd: repoRoot }).catch((e) =>
        console.warn('git worktree prune failed:', e),
      );
    }

    // Delete stale branch ref if it still exists
    try {
      await exec('git', ['branch', '-D', branchName], { cwd: repoRoot });
    } catch {
      // Branch doesn't exist — fine
    }
  }

  // Validate the start-point ref exists before attempting worktree creation
  const startRef = baseBranch || 'HEAD';
  try {
    await exec('git', ['rev-parse', '--verify', startRef], { cwd: repoRoot });
  } catch {
    const isEmptyRepo = await exec('git', ['rev-list', '-n1', '--all'], { cwd: repoRoot })
      .then(({ stdout }) => !stdout.trim())
      .catch(() => true);
    if (isEmptyRepo) {
      throw new Error(
        'Cannot create a worktree in a repository with no commits. ' +
          'Please make an initial commit first.',
      );
    }
    throw new Error(
      `Branch "${startRef}" does not exist. ` +
        'Please select a valid base branch or create the branch first.',
    );
  }

  // Create fresh worktree with new branch
  const conflictingBranch = await findLocalBranchPrefixConflict(repoRoot, branchName);
  if (conflictingBranch) {
    throw new Error(
      `Cannot create branch "${branchName}" because local branch "${conflictingBranch}" already exists. ` +
        `Choose a branch prefix other than "${conflictingBranch}" or "${conflictingBranch}/...".`,
    );
  }

  const worktreeArgs = ['worktree', 'add', '-b', branchName, worktreePath];
  if (baseBranch) worktreeArgs.push(baseBranch);
  await exec('git', worktreeArgs, { cwd: repoRoot });

  // Symlink selected directories. `.claude` is handled separately below — it
  // can't be a symlink because Claude Code's bwrap sandbox binds specific
  // entries inside it, and bwrap refuses to bind-mount at symlink paths.
  const createdSymlinks: string[] = [];
  for (const name of symlinkDirs) {
    if (name === '.claude') continue;
    // Reject names that could escape the worktree directory
    if (name.includes('/') || name.includes('\\') || name.includes('..') || name === '.') continue;
    const source = path.join(repoRoot, name);
    const target = path.join(worktreePath, name);
    try {
      if (!fs.existsSync(source)) continue;
      if (fs.existsSync(target)) continue;
      if (process.platform === 'win32' && fs.statSync(source).isDirectory()) {
        fs.symlinkSync(source, target, 'junction');
      } else {
        fs.symlinkSync(source, target);
      }
      createdSymlinks.push(name);
    } catch (err) {
      console.warn(`Failed to symlink directory '${name}' into worktree:`, err);
    }
  }

  ensureClaudeSandboxFiles(worktreePath, repoRoot);
  ensureSandboxExcludes(worktreePath);
  ensureSymlinkExcludes(worktreePath, createdSymlinks);

  return { path: worktreePath, branch: branchName };
}

export async function removeWorktree(
  repoRoot: string,
  branchName: string,
  deleteBranch: boolean,
): Promise<void> {
  const worktreePath = path.join(repoRoot, '.worktrees', branchName);

  if (!fs.existsSync(repoRoot)) return;

  if (fs.existsSync(worktreePath)) {
    try {
      await exec('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    } catch {
      // Fallback: direct directory removal, with retry/backoff for a
      // filesystem that may still be releasing the directory.
      const delays = [0, 500, 1500, 3000];
      let lastErr: unknown;
      for (const delay of delays) {
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
          lastErr = undefined;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr) throw lastErr;
    }
  }

  // Prune stale worktree entries
  try {
    await exec('git', ['worktree', 'prune'], { cwd: repoRoot });
  } catch {
    /* ignore */
  }

  if (deleteBranch) {
    try {
      await exec('git', ['branch', '-D', '--', branchName], { cwd: repoRoot });
    } catch (e: unknown) {
      const msg = String(e);
      if (!msg.toLowerCase().includes('not found')) throw e;
    }
  }
}
