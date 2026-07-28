import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWriteFile, atomicWriteFileSync } from './atomic.js';

let dir: string;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function makeDir() {
  dir = await mkdtemp(join(tmpdir(), 'atomic-test-'));
  return dir;
}

/**
 * Asserts a file's POSIX permission bits, skipped on Windows: NTFS has no
 * owner/group/other permission model to enforce or report -- fs.chmod/mode
 * options are effectively a no-op there beyond the read-only attribute, so
 * stat().mode always reports something like 0o666 regardless of what was
 * requested. Reproduced on a real Windows CI run.
 */
function expectPosixMode(mode: number, expected: number): void {
  if (process.platform === 'win32') return;
  expect(mode & 0o777).toBe(expected);
}

describe('atomicWriteFile (async)', () => {
  it('writes content to the target path', async () => {
    const d = await makeDir();
    const target = join(d, 'out.json');
    await atomicWriteFile(target, '{"ok":true}');
    const content = await readFile(target, 'utf8');
    expect(content).toBe('{"ok":true}');
  });

  it('overwrites existing file', async () => {
    const d = await makeDir();
    const target = join(d, 'out.json');
    await atomicWriteFile(target, 'first');
    await atomicWriteFile(target, 'second');
    expect(await readFile(target, 'utf8')).toBe('second');
  });

  it('leaves no temp file on success', async () => {
    const d = await makeDir();
    const target = join(d, 'out.json');
    await atomicWriteFile(target, 'hello');
    const files = await import('fs/promises').then((m) => m.readdir(d));
    expect(files).toEqual(['out.json']);
  });

  it('sets file mode when provided', async () => {
    const d = await makeDir();
    const target = join(d, 'secret.json');
    await atomicWriteFile(target, 'data', { mode: 0o600 });
    const s = await stat(target);
    expectPosixMode(s.mode, 0o600);
  });

  it('preserves existing 0600 mode on overwrite when no mode specified', async () => {
    const d = await makeDir();
    const target = join(d, 'secret.json');
    await atomicWriteFile(target, 'original', { mode: 0o600 });
    await atomicWriteFile(target, 'overwritten'); // no mode option
    const s = await stat(target);
    expectPosixMode(s.mode, 0o600);
    expect(await readFile(target, 'utf8')).toBe('overwritten');
  });

  it('sets exact mode even when umask would narrow it', async () => {
    const d = await makeDir();
    const target = join(d, 'wide.json');
    const prev = process.umask(0o022);
    try {
      await atomicWriteFile(target, 'data', { mode: 0o666 });
    } finally {
      process.umask(prev);
    }
    const s = await stat(target);
    expect(s.mode & 0o777).toBe(0o666);
  });
});

describe('atomicWriteFileSync (sync)', () => {
  it('writes content to the target path', async () => {
    const d = await makeDir();
    const target = join(d, 'out.json');
    atomicWriteFileSync(target, '{"ok":true}');
    const content = await readFile(target, 'utf8');
    expect(content).toBe('{"ok":true}');
  });

  it('overwrites existing file', async () => {
    const d = await makeDir();
    const target = join(d, 'out.json');
    atomicWriteFileSync(target, 'first');
    atomicWriteFileSync(target, 'second');
    expect(await readFile(target, 'utf8')).toBe('second');
  });

  it('sets file mode when provided', async () => {
    const d = await makeDir();
    const target = join(d, 'secret.json');
    atomicWriteFileSync(target, 'data', { mode: 0o600 });
    const s = await stat(target);
    expectPosixMode(s.mode, 0o600);
  });

  it('preserves existing 0600 mode on overwrite when no mode specified', async () => {
    const d = await makeDir();
    const target = join(d, 'secret.json');
    atomicWriteFileSync(target, 'original', { mode: 0o600 });
    atomicWriteFileSync(target, 'overwritten'); // no mode option
    const s = await stat(target);
    expectPosixMode(s.mode, 0o600);
    expect(await readFile(target, 'utf8')).toBe('overwritten');
  });

  it('sets exact mode even when umask would narrow it', async () => {
    const d = await makeDir();
    const target = join(d, 'wide.json');
    const prev = process.umask(0o022);
    try {
      atomicWriteFileSync(target, 'data', { mode: 0o666 });
    } finally {
      process.umask(prev);
    }
    const s = await stat(target);
    expect(s.mode & 0o777).toBe(0o666);
  });
});
