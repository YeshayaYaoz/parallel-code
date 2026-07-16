// Per-provider cooldown tracking.
//
// State is in-memory only — it resets on redeploy/restart. That's an accepted
// v1 limitation (see README "Known limitations"): Railway's filesystem isn't
// guaranteed to persist across deploys without an attached volume, and for a
// personal-scale router, "occasionally re-probes a provider it already knew
// was cooling down, right after a restart" is a cheap, self-correcting cost —
// much cheaper than the complexity of wiring up persistent storage for this.

import type { Provider } from './registry.js';

const ALL_PROVIDERS: Provider[] = ['anthropic', 'openai', 'google', 'deepseek', 'mistral'];

interface CooldownState {
  resetAtMs: number;
}

const cooldowns = new Map<Provider, CooldownState>();

/** Backoff used when a provider signals quota exhaustion without telling us
 *  exactly when it resets (this is the common case — see each adapter's notes
 *  on how reliably it can detect an explicit reset time). */
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

/** Providers that just became available since their last known cooldown —
 *  used to detect "the preferred provider just came back" for switchback. */
export function justRecovered(previouslyUnavailable: ReadonlySet<Provider>): Provider[] {
  return ALL_PROVIDERS.filter((p) => previouslyUnavailable.has(p) && isAvailable(p));
}
