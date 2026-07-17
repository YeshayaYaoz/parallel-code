// Live CLI queue — submits rate-limited terminal input to the ultrakod
// Railway service (see electron/ipc/ultrakod-queue.ts) and polls for the
// answer, instead of requiring a manual GitHub issue.

import { invoke } from './ipc';
import { IPC } from '../../electron/ipc/channels';

export type RoutingMode = 'cheap' | 'balanced' | 'extra';

export interface UltrakodQueueStatus {
  connected: boolean;
  baseUrl?: string;
}

export async function getUltrakodQueueStatus(): Promise<UltrakodQueueStatus> {
  return invoke<UltrakodQueueStatus>(IPC.UltrakodQueueGetStatus);
}

export async function setUltrakodQueueConfig(baseUrl: string, token: string): Promise<void> {
  await invoke(IPC.UltrakodQueueSetConfig, { baseUrl, token });
}

export async function clearUltrakodQueueConfig(): Promise<void> {
  await invoke(IPC.UltrakodQueueClearConfig);
}

export interface CliQueueContext {
  transcriptExcerpt: string;
  gitDiff?: string;
  gitStatus?: string;
}

export interface SubmitCliQueueTaskArgs {
  taskId: string;
  mode: RoutingMode;
  prompt: string;
  context: CliQueueContext;
}

export async function submitCliQueueTask(
  args: SubmitCliQueueTaskArgs,
): Promise<{ id: string; status: string }> {
  return invoke<{ id: string; status: string }>(IPC.UltrakodQueueSubmitTask, { ...args });
}

export interface CliQueueTaskStatus {
  status: 'pending' | 'answered' | 'failed';
  answer?: string;
  model?: string;
  error?: string;
}

export async function pollCliQueueTask(taskId: string): Promise<CliQueueTaskStatus> {
  return invoke<CliQueueTaskStatus>(IPC.UltrakodQueuePollTask, { taskId });
}

export async function cancelCliQueueTask(taskId: string): Promise<void> {
  await invoke(IPC.UltrakodQueueCancelTask, { taskId });
}
