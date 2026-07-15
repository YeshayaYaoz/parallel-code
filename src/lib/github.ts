// GitHub connection — device-flow auth, repo listing, and cloning.

import { Channel, invoke } from './ipc';
import { IPC } from '../../electron/ipc/channels';
import { errMessage } from './log';

export interface GitHubDeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export async function startGitHubAuth(): Promise<GitHubDeviceFlowStart> {
  return invoke<GitHubDeviceFlowStart>(IPC.GitHubAuthStart);
}

export type GitHubAuthWaitMessage =
  | { type: 'connected'; login: string }
  | { type: 'error'; message: string };

/** Polls for the device-flow token in the background. Call `.cancel()` to abort (e.g. dialog closed). */
export function waitForGitHubAuth(
  args: { deviceCode: string; interval: number; expiresIn: number },
  onMessage: (msg: GitHubAuthWaitMessage) => void,
): { cancel: () => void } {
  const channel = new Channel<GitHubAuthWaitMessage>();
  channel.onmessage = onMessage;

  invoke(IPC.GitHubAuthWait, { ...args, onOutput: channel }).catch((err: unknown) => {
    onMessage({ type: 'error', message: errMessage(err) });
  });

  return {
    cancel: () => {
      invoke(IPC.GitHubAuthCancelWait).catch(() => {
        /* best-effort */
      });
      channel.dispose();
    },
  };
}

export async function getGitHubAuthStatus(): Promise<{ connected: boolean; login?: string }> {
  return invoke<{ connected: boolean; login?: string }>(IPC.GitHubAuthStatus);
}

export async function logoutGitHub(): Promise<void> {
  await invoke(IPC.GitHubAuthLogout);
}

export interface GitHubRepoSummary {
  fullName: string;
  private: boolean;
  cloneUrl: string;
  updatedAt: string;
}

export async function listGitHubRepos(): Promise<GitHubRepoSummary[]> {
  return invoke<GitHubRepoSummary[]>(IPC.GitHubListRepos);
}

/** Clones `cloneUrl` into `<parentDir>/<repoName>`. Returns the final destination path. */
export async function cloneGitHubRepo(
  cloneUrl: string,
  parentDir: string,
  repoName: string,
): Promise<string> {
  const result = await invoke<{ destDir: string }>(IPC.GitHubCloneRepo, {
    cloneUrl,
    parentDir,
    repoName,
  });
  return result.destDir;
}
