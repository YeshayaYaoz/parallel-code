// Per-provider cooldown tracking for the live ultrakod orchestrator
// (src/store/ultrakodOrchestrator.ts). Client-side port of
// ultrakod-listener/src/cooldowns.ts's API — same accepted "in-memory only,
// resets on app restart" tradeoff as the original: a personal-scale,
// self-correcting cost (worst case: briefly re-probing a provider that was
// already known to be cooling down). This is a copy, not a shared import —
// the original lives in a separately-deployed package with its own build.

import type { Provider } from '../../electron/ultrakod/registry';

const ALL_PROVIDERS: Provider[] = ['anthropic', 'openai', 'google', 'deepseek', 'mistral'];

interface CooldownState {
  resetAtMs: number;
}

const cooldowns = new Map<Provider, CooldownState>();

/** Backoff used when a provider is marked cooling down without an explicit
 *  reset time (the common case — a rate-limit message rarely tells us
 *  exactly when it resets). */
const DEFAULT_BACKOFF_MS = 15 * 60 * 1000;

export function markCoolingDown(provider: Provider, resetAtIso?: string): void {
  const parsed = resetAtIso ? new Date(resetAtIso).getTime() : NaN;
  const resetAtMs = Number.isFinite(parsed) ? parsed : Date.now() + DEFAULT_BACKOFF_MS;
  cooldowns.set(provider, { resetAtMs });
}

export function clearCooldown(provider: Provider): void {
  cooldowns.delete(provider);
}

export function isAvailable(provider: Provider): boolean {
  const state = cooldowns.get(provider);
  if (!state) return true;
  if (Date.now() >= state.resetAtMs) {
    cooldowns.delete(provider);
    return true;
  }
  return false;
}

export function cooldownEndsAt(provider: Provider): number | null {
  const state = cooldowns.get(provider);
  return state && Date.now() < state.resetAtMs ? state.resetAtMs : null;
}

export function unavailableProviderIds(): Provider[] {
  return ALL_PROVIDERS.filter((p) => !isAvailable(p));
}
