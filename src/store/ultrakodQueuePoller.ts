// Delivery side of the live CLI queue: polls the ultrakod Railway service
// for tasks queued via RateLimitQueueBanner.tsx and, once a model has
// answered, resends the answer into that task's terminal the moment it's
// idle at its main prompt again. Runs whenever the app is running
// (foreground or backgrounded) — see App.tsx's onMount/onCleanup wiring.
import { store, setStore } from './core';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { pollCliQueueTask, cancelCliQueueTask } from '../lib/ultrakod-queue';
import { getAgentOutputTail, isAgentAskingQuestion, stripAnsi } from './taskStatus';
import { chunkContainsAgentPrompt } from '../../electron/mcp/prompt-detect';

const POLL_INTERVAL_MS = 45_000;
let timer: ReturnType<typeof setInterval> | null = null;

// Answers already fetched from Railway but not yet delivered (agent wasn't
// at its prompt yet) — avoids re-fetching the same answer every tick.
const pendingDelivery = new Map<string, string>();

function isAgentReadyForDelivery(agentId: string): boolean {
  if (isAgentAskingQuestion(agentId)) return false;
  const tailStripped = stripAnsi(getAgentOutputTail(agentId))
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return chunkContainsAgentPrompt(tailStripped);
}

function targetAgentId(taskId: string): string | undefined {
  const task = store.tasks[taskId];
  if (!task) return undefined;
  return task.selectedAgentId ?? task.agentIds[0];
}

function clearQueueState(taskId: string): void {
  pendingDelivery.delete(taskId);
  setStore('tasks', taskId, 'queuedRailwayTaskId', undefined);
}

/** Lets the user pull a request back before it's been answered — e.g. they
 *  switched to a live CLI instead via RateLimitQueueBanner.tsx. Clears local
 *  state immediately (optimistic) and best-effort tells Railway to drop the
 *  record too; a failure to reach Railway doesn't block the local cancel,
 *  since the poller would just find it gone or answered on its next tick
 *  either way. */
export async function cancelQueuedTask(taskId: string): Promise<void> {
  const queuedId = store.tasks[taskId]?.queuedRailwayTaskId;
  clearQueueState(taskId);
  if (queuedId) {
    await cancelCliQueueTask(queuedId).catch(() => {});
  }
}

async function deliver(taskId: string, agentId: string, answer: string): Promise<void> {
  await invoke(IPC.WriteToAgent, { agentId, data: answer });
  await invoke(IPC.WriteToAgent, { agentId, data: '\r' });
  clearQueueState(taskId);
}

async function pollOnce(): Promise<void> {
  for (const taskId of Object.keys(store.tasks)) {
    const queuedId = store.tasks[taskId]?.queuedRailwayTaskId;
    if (!queuedId) continue;

    const agentId = targetAgentId(taskId);
    if (!agentId || store.agents[agentId]?.status !== 'running') {
      // Can't deliver into a session that no longer exists.
      clearQueueState(taskId);
      continue;
    }

    const alreadyFetched = pendingDelivery.get(taskId);
    if (alreadyFetched !== undefined) {
      if (isAgentReadyForDelivery(agentId)) {
        await deliver(taskId, agentId, alreadyFetched).catch(() => {});
      }
      continue;
    }

    try {
      const result = await pollCliQueueTask(queuedId);
      if (result.status === 'pending') continue;
      if (result.status === 'failed') {
        clearQueueState(taskId);
        continue;
      }
      if (result.status === 'answered' && result.answer) {
        if (isAgentReadyForDelivery(agentId)) {
          await deliver(taskId, agentId, result.answer).catch(() => {});
        } else {
          pendingDelivery.set(taskId, result.answer);
        }
      }
    } catch {
      // Transient network hiccup — retry on the next tick.
    }
  }
}

export function startUltrakodQueuePolling(): void {
  if (timer) return;
  timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  void pollOnce();
}

export function stopUltrakodQueuePolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  pendingDelivery.clear();
}
