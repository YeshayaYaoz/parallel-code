// App state persistence, adapted from electron/ipc/persistence.ts's
// saveAppState/loadAppState. The Electron original resolves its directory via
// app.getPath('userData'); this service has no Electron app object, so it
// uses DATA_DIR (the same env var the Fly volume is mounted at — see
// cloud-backend/fly.toml) instead. Custom theme file storage is a
// renderer-UI-styling concern with no equivalent in this headless service,
// so it's deliberately not ported.
import fs from 'fs';
import path from 'path';
import os from 'os';

function getStateDir(): string {
  return process.env.DATA_DIR ?? path.join(os.homedir(), '.parallel-code-cloud');
}

function saveJsonFile(fileName: string, json: string): void {
  const filePath = path.join(getStateDir(), fileName);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Validate JSON before writing
  JSON.parse(json);

  // Atomic write: write to temp, then rename
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, json, 'utf8');

    // Keep one backup (copy so filePath is never missing during the operation)
    if (fs.existsSync(filePath)) {
      const bakPath = filePath + '.bak';
      try {
        fs.copyFileSync(filePath, bakPath);
      } catch {
        /* ignore */
      }
    }

    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up orphaned temp file on failure
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* temp file may not exist */
    }
    throw err;
  }
}

function loadJsonFile(fileName: string): string | null {
  const filePath = path.join(getStateDir(), fileName);
  const bakPath = filePath + '.bak';

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.trim()) {
        JSON.parse(content); // validate JSON; falls through to backup on invalid
        return content;
      }
    }
  } catch {
    // Primary file unreadable or invalid JSON — try backup
  }

  try {
    if (fs.existsSync(bakPath)) {
      const content = fs.readFileSync(bakPath, 'utf8');
      if (content.trim()) {
        JSON.parse(content); // validate JSON
        return content;
      }
    }
  } catch {
    // Backup also unreadable or invalid JSON
  }

  return null;
}

export function saveAppState(json: string): void {
  saveJsonFile('state.json', json);
}

export function loadAppState(): string | null {
  return loadJsonFile('state.json');
}

/**
 * Coordinator resumption snapshot (Phase 4: unattended coordinator) — kept in
 * its own file rather than folded into state.json, since it's this service's
 * own internal bookkeeping (see coordinator-persistence.ts), not the desktop
 * app's opaque UI state that state.json holds.
 */
export function saveCoordinatorSnapshot(json: string): void {
  saveJsonFile('coordinator-snapshot.json', json);
}

export function loadCoordinatorSnapshot(): string | null {
  return loadJsonFile('coordinator-snapshot.json');
}
