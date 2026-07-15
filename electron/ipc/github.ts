/**
 * GitHub connection: OAuth device-flow auth, repo listing, and cloning.
 *
 * Auth uses GitHub's device flow (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) —
 * the standard mechanism desktop apps (gh CLI, GitHub Desktop, etc.) use
 * when there's no server to receive an OAuth redirect: the user is shown a
 * short code, approves it at github.com/login/device in their browser, and
 * this process polls until GitHub reports the token. No client secret is
 * needed (or safe to embed in a desktop app), so this only ever uses the
 * public client ID.
 */
import { app, safeStorage, type BrowserWindow } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { debug as logDebug } from '../log.js';

const execFileAsync = promisify(execFile);

const GITHUB_CLIENT_ID = 'Ov23liHdrvKf8kLgAJBK';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_BASE = 'https://api.github.com';
const USER_AGENT = 'parallel-code-app';

function getAuthDir(): string {
  let dir = app.getPath('userData');
  if (!app.isPackaged) {
    const base = path.basename(dir);
    dir = path.join(path.dirname(dir), `${base}-dev`);
  }
  return dir;
}

function getAuthFilePath(): string {
  return path.join(getAuthDir(), 'github-auth.json');
}

interface StoredGitHubAuth {
  /** Base64. Encrypted with safeStorage when available, else raw utf8 bytes. */
  token: string;
  encrypted: boolean;
  login: string;
}

function loadStoredAuth(): StoredGitHubAuth | null {
  try {
    const raw = fs.readFileSync(getAuthFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredGitHubAuth>;
    if (!parsed.token || !parsed.login) return null;
    return parsed as StoredGitHubAuth;
  } catch {
    return null;
  }
}

function saveStoredAuth(token: string, login: string): void {
  const dir = getAuthDir();
  fs.mkdirSync(dir, { recursive: true });
  const encrypted = safeStorage.isEncryptionAvailable();
  const tokenField = encrypted
    ? safeStorage.encryptString(token).toString('base64')
    : Buffer.from(token, 'utf8').toString('base64');
  const payload: StoredGitHubAuth = { token: tokenField, encrypted, login };
  const filePath = getAuthFilePath();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

function decryptStoredToken(stored: StoredGitHubAuth): string | null {
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

function getStoredGitHubToken(): string | null {
  const stored = loadStoredAuth();
  return stored ? decryptStoredToken(stored) : null;
}

export function getGitHubAuthStatus(): { connected: boolean; login?: string } {
  const stored = loadStoredAuth();
  if (!stored) return { connected: false };
  const token = decryptStoredToken(stored);
  return token ? { connected: true, login: stored.login } : { connected: false };
}

export function logoutGitHub(): void {
  cancelGitHubAuthWait();
  try {
    fs.unlinkSync(getAuthFilePath());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function startGitHubDeviceFlow(): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: 'repo' }).toString(),
  });
  if (!res.ok) {
    throw new Error(`GitHub device code request failed (${res.status})`);
  }
  const data = (await res.json()) as DeviceCodeResponse;
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function fetchGitHubLogin(token: string): Promise<string> {
  const res = await fetch(`${API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`GitHub user lookup failed (${res.status})`);
  const data = (await res.json()) as { login: string };
  return data.login;
}

/** Single-flight: only one device-flow wait is ever in progress at a time. */
let activeAuthController: AbortController | null = null;

export function cancelGitHubAuthWait(): void {
  activeAuthController?.abort();
  activeAuthController = null;
}

type GitHubAuthWaitMessage =
  | { type: 'connected'; login: string }
  | { type: 'error'; message: string };

/**
 * Polls GitHub's device-flow token endpoint on a channel (rather than a
 * single resolved promise) because the wait can span minutes — the caller
 * needs the UI to stay responsive and cancellable throughout, the same
 * pattern used for long-running agent/askCode output.
 */
export function waitForGitHubDeviceToken(
  win: BrowserWindow,
  args: { channelId: string; deviceCode: string; interval: number; expiresIn: number },
): void {
  cancelGitHubAuthWait();
  const controller = new AbortController();
  activeAuthController = controller;

  const send = (msg: GitHubAuthWaitMessage) => {
    if (!win.isDestroyed()) {
      win.webContents.send(`channel:${args.channelId}`, msg);
    }
  };

  const deadline = Date.now() + args.expiresIn * 1000;
  let intervalMs = Math.max(args.interval, 5) * 1000;

  const poll = async (): Promise<void> => {
    if (controller.signal.aborted) return;
    if (Date.now() >= deadline) {
      send({ type: 'error', message: 'Code expired. Please try again.' });
      return;
    }

    try {
      const res = await fetch(ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({
          client_id: GITHUB_CLIENT_ID,
          device_code: args.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }).toString(),
        signal: controller.signal,
      });
      const data = (await res.json()) as AccessTokenResponse;

      if (data.access_token) {
        const login = await fetchGitHubLogin(data.access_token);
        saveStoredAuth(data.access_token, login);
        if (!controller.signal.aborted) send({ type: 'connected', login });
        return;
      }

      if (data.error === 'slow_down') {
        intervalMs += 5000;
      } else if (data.error === 'expired_token') {
        send({ type: 'error', message: 'Code expired. Please try again.' });
        return;
      } else if (data.error === 'access_denied') {
        send({ type: 'error', message: 'Authorization was denied.' });
        return;
      } else if (data.error && data.error !== 'authorization_pending') {
        send({ type: 'error', message: data.error_description || data.error });
        return;
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logDebug('github', 'device token poll failed', { err: String(err) });
      // Transient network hiccup — keep polling rather than failing hard.
    }

    if (!controller.signal.aborted) {
      setTimeout(() => void poll(), intervalMs);
    }
  };

  void poll();
}

export interface GitHubRepoSummary {
  fullName: string;
  private: boolean;
  cloneUrl: string;
  updatedAt: string;
}

/** Fetches the user's repos (owned, collaborator, and org member), newest first. */
export async function listGitHubRepos(): Promise<GitHubRepoSummary[]> {
  const token = getStoredGitHubToken();
  if (!token) throw new Error('Not connected to GitHub.');

  const repos: GitHubRepoSummary[] = [];
  const MAX_PAGES = 10; // caps at 1000 repos, plenty for a picker list
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `${API_BASE}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': USER_AGENT,
        },
      },
    );
    if (!res.ok) throw new Error(`Failed to list repositories (${res.status})`);
    const batch = (await res.json()) as Array<{
      full_name: string;
      private: boolean;
      clone_url: string;
      updated_at: string;
    }>;
    for (const repo of batch) {
      repos.push({
        fullName: repo.full_name,
        private: repo.private,
        cloneUrl: repo.clone_url,
        updatedAt: repo.updated_at,
      });
    }
    if (batch.length < 100) break;
  }
  return repos;
}

/** Redacts a token embedded in a `https://<token>@host/...` URL for safe logging. */
function redactTokenFromUrl(text: string): string {
  return text.replace(/:\/\/[^\s@/]+@/g, '://<redacted>@');
}

/** Clones `cloneUrl` into `destDir`, authenticating with the stored token if connected. */
export async function cloneGitHubRepo(cloneUrl: string, destDir: string): Promise<void> {
  const token = getStoredGitHubToken();
  const authedUrl = token
    ? cloneUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`)
    : cloneUrl;

  try {
    await execFileAsync('git', ['clone', '--', authedUrl, destDir], { timeout: 5 * 60 * 1000 });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(redactTokenFromUrl(raw));
  }
}
