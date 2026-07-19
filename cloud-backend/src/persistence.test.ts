import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let dataDir: string;
let originalDataDir: string | undefined;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'cloud-backend-persistence-test-'));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  // persistence.ts reads DATA_DIR at call time (not module load time), so no
  // module reset is needed between tests — just re-import for a fresh module
  // instance isn't required either, but vi.resetModules keeps this test file
  // independent of import order relative to other suites.
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('saveAppState / loadAppState', () => {
  it('round-trips a saved state', async () => {
    const { saveAppState, loadAppState } = await import('./persistence.js');
    saveAppState(JSON.stringify({ hello: 'world' }));
    expect(loadAppState()).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('returns null when nothing has been saved yet', async () => {
    const { loadAppState } = await import('./persistence.js');
    expect(loadAppState()).toBeNull();
  });

  it('rejects invalid JSON on save', async () => {
    const { saveAppState } = await import('./persistence.js');
    expect(() => saveAppState('not json')).toThrow();
  });

  it('creates a .bak backup of the previous state on the next save', async () => {
    const { saveAppState } = await import('./persistence.js');
    saveAppState(JSON.stringify({ v: 1 }));
    saveAppState(JSON.stringify({ v: 2 }));
    const bakPath = path.join(dataDir, 'state.json.bak');
    expect(existsSync(bakPath)).toBe(true);
    expect(JSON.parse(readFileSync(bakPath, 'utf8'))).toEqual({ v: 1 });
  });

  it('falls back to the backup when the primary file is corrupt', async () => {
    const { saveAppState, loadAppState } = await import('./persistence.js');
    saveAppState(JSON.stringify({ v: 1 }));
    saveAppState(JSON.stringify({ v: 2 }));
    writeFileSync(path.join(dataDir, 'state.json'), '{ not valid json', 'utf8');
    expect(loadAppState()).toBe(JSON.stringify({ v: 1 }));
  });

  it('falls back to DATA_DIR-less home dir default when DATA_DIR is unset', async () => {
    delete process.env.DATA_DIR;
    const { loadAppState } = await import('./persistence.js');
    // Just confirm it doesn't throw when no DATA_DIR is configured — the
    // exact home-dir path isn't asserted since it depends on the test host.
    expect(() => loadAppState()).not.toThrow();
  });
});

describe('saveCoordinatorSnapshot / loadCoordinatorSnapshot', () => {
  it('round-trips independently of state.json', async () => {
    const { saveAppState, saveCoordinatorSnapshot, loadCoordinatorSnapshot, loadAppState } =
      await import('./persistence.js');
    saveAppState(JSON.stringify({ ui: true }));
    saveCoordinatorSnapshot(JSON.stringify({ coordinators: [] }));
    expect(loadAppState()).toBe(JSON.stringify({ ui: true }));
    expect(loadCoordinatorSnapshot()).toBe(JSON.stringify({ coordinators: [] }));
  });

  it('returns null when no snapshot has been saved yet', async () => {
    const { loadCoordinatorSnapshot } = await import('./persistence.js');
    expect(loadCoordinatorSnapshot()).toBeNull();
  });
});
