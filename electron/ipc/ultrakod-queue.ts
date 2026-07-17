/**
 * Live CLI queue: talks to the ultrakod-listener Railway service's
 * /cli-tasks endpoints (see ultrakod-listener/src/cli-tasks.ts). This is the
 * second, automatic entry point into that service — the terminal-side
 * counterpart to the manual GitHub-issue queue. When one of this app's own
 * terminal sessions detects a rate limit (src/store/taskStatus.ts's
 * looksLikeRateLimited), the pending input plus a compacted context bundle
 * is submitted here so Railway can answer it once a model is actually
 * available, even hours later with this computer off.
 *
 * Config (Railway base URL + shared bearer token) is stored the same way as
 * the GitHub PAT in github.ts: safeStorage-encrypted when available, atomic
 * write, never sent back to the renderer.
 */
import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

function getConfigDir(): string {
  let dir = app.getPath('userData');
  if (!app.isPackaged) {
    const base = path.basename(dir);
    dir = path.join(path.dirname(dir), `${base}-dev`);
  }
  return dir;
}

function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'ultrakod-queue-auth.json');
}

interface StoredUltrakodQueueConfig {
  baseUrl: string;
  /** Base64. Encrypted with safeStorage when available, else raw utf8 bytes. */
  token: string;
  encrypted: boolean;
}

function loadStoredConfig(): StoredUltrakodQueueConfig | null {
  try {
    const raw = fs.readFileSync(getConfigFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredUltrakodQueueConfig>;
    if (!parsed.baseUrl || !parsed.token) return null;
    return parsed as StoredUltrakodQueueConfig;
  } catch {
    return null;
  }
}

function decryptStoredToken(stored: StoredUltrakodQueueConfig): string | null {
  try {
    const buf = Buffer.from(stored.token, 'base64');
    if (stored.encrypted) {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(buf);
    }
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

export function setUltrakodQueueConfig(baseUrl: string, token: string): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const encrypted = safeStorage.isEncryptionAvailable();
  const tokenField = encrypted
    ? safeStorage.encryptString(token).toString('base64')
    : Buffer.from(token, 'utf8').toString('base64');
  const payload: StoredUltrakodQueueConfig = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token: tokenField,
    encrypted,
  };
  const filePath = getConfigFilePath();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

export function clearUltrakodQueueConfig(): void {
  try {
    fs.unlinkSync(getConfigFilePath());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

export function getUltrakodQueueStatus(): { connected: boolean; baseUrl?: string } {
  const stored = loadStoredConfig();
  if (!stored) return { connected: false };
  const token = decryptStoredToken(stored);
  return token ? { connected: true, baseUrl: stored.baseUrl } : { connected: false };
}

function requireConfig(): { baseUrl: string; token: string } {
  const stored = loadStoredConfig();
  if (!stored) throw new Error('Live CLI queue is not configured. Set it up in Settings first.');
  const token = decryptStoredToken(stored);
  if (!token) throw new Error('Live CLI queue token could not be read. Please reconfigure it.');
  return { baseUrl: stored.baseUrl, token };
}

export interface CliQueueContext {
  transcriptExcerpt: string;
  gitDiff?: string;
  gitStatus?: string;
}

export interface SubmitCliQueueTaskArgs {
  taskId: string;
  mode: 'cheap' | 'balanced' | 'extra';
  prompt: string;
  context: CliQueueContext;
}

export interface CliQueueTaskStatus {
  status: 'pending' | 'answered' | 'failed';
  answer?: string;
  model?: string;
  error?: string;
}

export async function submitCliQueueTask(
  args: SubmitCliQueueTaskArgs,
): Promise<{ id: string; status: string }> {
  const { baseUrl, token } = requireConfig();
  const res = await fetch(`${baseUrl}/cli-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to submit queued task (${res.status})${body ? `: ${body}` : ''}`);
  }
  return (await res.json()) as { id: string; status: string };
}

export async function pollCliQueueTask(taskId: string): Promise<CliQueueTaskStatus> {
  const { baseUrl, token } = requireConfig();
  const res = await fetch(`${baseUrl}/cli-tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to check queued task status (${res.status})`);
  }
  return (await res.json()) as CliQueueTaskStatus;
}

/** Cancels a queued task before a model has answered it — e.g. the user
 *  switched to a live CLI instead, or no longer needs the continuation.
 *  Best-effort: a 404 (already answered/expired) is not an error here, the
 *  caller only cares that the record is gone either way. */
export async function cancelCliQueueTask(taskId: string): Promise<void> {
  const { baseUrl, token } = requireConfig();
  const res = await fetch(`${baseUrl}/cli-tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to cancel queued task (${res.status})`);
  }
}
