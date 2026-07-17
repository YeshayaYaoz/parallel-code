// Live ultrakod orchestrator: for tasks with ultrakodMode enabled, watches
// the active agent for a usage-limit hit and automatically swaps to the
// next-best available CLI (with a compacted context handoff), switching
// back to the preferred model once it recovers and the agent reaches a
// natural break (idle at its prompt) rather than interrupting a live turn.
//
// Reuses existing primitives rather than inventing new ones: switchAgent()
// already kills whatever CLI is running in a tab and spawns a different one
// in its place (src/store/agents.ts); setInitialPrompt() already auto-sends
// text into a freshly spawned agent once it's ready (src/store/tasks.ts);
// isAgentRateLimited()/getAgentOutputTail() already track live PTY output
// (src/store/taskStatus.ts, built for the separate RateLimitQueueBanner
// feature). Only claude-code, codex, and gemini have real interactive CLIs
// registered in this app — DeepSeek/Mistral are API-only and excluded from
// this live-switching pool entirely.
import { createSignal } from 'solid-js';
import { store } from './core';
import { switchAgent } from './agents';
import { setInitialPrompt } from './tasks';
import {
  getAgentOutputTail,
  isAgentRateLimited,
  isAgentAskingQuestion,
  stripAnsi,
} from './taskStatus';
import { chunkContainsAgentPrompt } from '../../electron/mcp/prompt-detect';
import {
  pickInstalledModelForMode,
  PROVIDER_TO_AGENT_ID,
  type ModelInfo,
  type Provider,
  type RoutingMode,
} from '../../electron/ultrakod/registry';
import * as cooldowns from './ultrakodCooldowns';
import type { AgentDef } from '../ipc/types';

const TICK_INTERVAL_MS = 3_000;
let timer: ReturnType<typeof setInterval> | null = null;

const ALL_CLI_AGENT_IDS = new Set(Object.values(PROVIDER_TO_AGENT_ID) as string[]);

function resolveInstalledAgentDef(model: ModelInfo): AgentDef | null {
  const agentId = PROVIDER_TO_AGENT_ID[model.provider];
  if (!agentId) return null;
  const def = store.availableAgents.find((a) => a.id === agentId);
  return def && def.available !== false ? def : null;
}

/** The model that would be picked with no cooldowns in effect — i.e. the
 *  task's "preferred" model for its mode, used to detect when we're
 *  currently running on a fallback. Not restricted to *installed* CLIs
 *  (only to CLI-mappable providers) — installation is checked separately
 *  before actually switching to it. */
function pickPreferredModel(mode: RoutingMode): ModelInfo | null {
  return pickInstalledModelForMode(mode, ALL_CLI_AGENT_IDS);
}

/** Every CLI-mappable provider whose CLI is both installed and not
 *  currently cooling down, minus `extraExcludedProviders` (e.g. the
 *  provider that was *just* detected as rate-limited this tick). */
function usableAgentIds(extraExcludedProviders: Iterable<Provider> = []): Set<string> {
  const excludedProviders = new Set<Provider>([
    ...cooldowns.unavailableProviderIds(),
    ...extraExcludedProviders,
  ]);
  const usable = new Set<string>();
  for (const [provider, agentId] of Object.entries(PROVIDER_TO_AGENT_ID) as Array<
    [Provider, string]
  >) {
    if (excludedProviders.has(provider)) continue;
    const def = store.availableAgents.find((a) => a.id === agentId);
    if (def && def.available !== false) usable.add(agentId);
  }
  return usable;
}

/** The best model/CLI pair currently actually usable: not cooling down, and
 *  its CLI is installed. */
function pickAvailableAgent(
  mode: RoutingMode,
  extraExcludedProviders: Iterable<Provider> = [],
): { model: ModelInfo; agentDef: AgentDef } | null {
  const model = pickInstalledModelForMode(mode, usableAgentIds(extraExcludedProviders));
  if (!model) return null;
  const agentDef = resolveInstalledAgentDef(model);
  return agentDef ? { model, agentDef } : null;
}

function providerForAgentDefId(agentDefId: string): Provider | undefined {
  return (Object.entries(PROVIDER_TO_AGENT_ID) as Array<[Provider, string]>).find(
    ([, id]) => id === agentDefId,
  )?.[0];
}

function isAgentIdleAtPrompt(agentId: string): boolean {
  if (isAgentAskingQuestion(agentId)) return false;
  const tailStripped = stripAnsi(getAgentOutputTail(agentId))
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return chunkContainsAgentPrompt(tailStripped);
}

function buildHandoffText(taskId: string, agentId: string, reason: string): string {
  const task = store.tasks[taskId];
  const tail = getAgentOutputTail(agentId).slice(-4000).trim();
  const lastPrompt = task?.lastPrompt?.trim();
  const parts = [
    `[ultrakod switched models: ${reason}]`,
    tail ? `Recent terminal output before the switch:\n${tail}` : '',
    lastPrompt ? `Continue with: ${lastPrompt}` : 'Continue where the previous model left off.',
  ];
  return parts.filter(Boolean).join('\n\n');
}

interface UltrakodSwitchRecord {
  message: string;
  at: number;
}

const [switchLog, setSwitchLog] = createSignal<Record<string, UltrakodSwitchRecord>>({});

/** The most recent model switch recorded for a task, if any — read reactively
 *  by UltrakodSwitchToast.tsx to show a transient "switched to X" banner. */
export function getLastUltrakodSwitch(taskId: string): UltrakodSwitchRecord | undefined {
  return switchLog()[taskId];
}

function performSwitch(taskId: string, agentId: string, agentDef: AgentDef, reason: string): void {
  const handoff = buildHandoffText(taskId, agentId, reason);
  switchAgent(agentId, agentDef);
  setInitialPrompt(taskId, handoff);
  setSwitchLog((prev) => ({
    ...prev,
    [taskId]: { message: `Switched to ${agentDef.name} — ${reason}`, at: Date.now() },
  }));
}

function tick(): void {
  for (const taskId of store.taskOrder) {
    const task = store.tasks[taskId];
    if (!task?.ultrakodMode) continue;

    const agentId = task.selectedAgentId ?? task.agentIds[0];
    if (!agentId) continue;
    const agent = store.agents[agentId];
    if (!agent || agent.status !== 'running') continue;

    const mode: RoutingMode = task.ultrakodRoutingMode ?? 'balanced';
    const currentProvider = providerForAgentDefId(agent.def.id);

    if (currentProvider && isAgentRateLimited(agentId) && cooldowns.isAvailable(currentProvider)) {
      cooldowns.markCoolingDown(currentProvider);
      const pick = pickAvailableAgent(mode, [currentProvider]);
      if (pick && pick.agentDef.id !== agent.def.id) {
        performSwitch(taskId, agentId, pick.agentDef, `${agent.def.name} hit its usage limit`);
      }
      continue;
    }

    // Switch back to the preferred model once it recovers, but only at a
    // natural break — never interrupt a live turn.
    const preferred = pickPreferredModel(mode);
    if (
      preferred &&
      PROVIDER_TO_AGENT_ID[preferred.provider] !== agent.def.id &&
      cooldowns.isAvailable(preferred.provider) &&
      isAgentIdleAtPrompt(agentId)
    ) {
      const preferredDef = resolveInstalledAgentDef(preferred);
      if (preferredDef) {
        performSwitch(taskId, agentId, preferredDef, `${preferredDef.name} is available again`);
      }
    }
  }
}

/** Picks the actual starting AgentDef to spawn for a brand-new ultrakod-mode
 *  task — used by NewTaskDialog.tsx when the user selects "Ultrakod" instead
 *  of a specific CLI. Returns null if no CLI-mappable provider is currently
 *  both installed and not cooling down. */
export function resolveUltrakodStartingAgent(mode: RoutingMode): AgentDef | null {
  return pickAvailableAgent(mode)?.agentDef ?? null;
}

export function startUltrakodOrchestrator(): void {
  if (timer) return;
  timer = setInterval(tick, TICK_INTERVAL_MS);
}

export function stopUltrakodOrchestrator(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
