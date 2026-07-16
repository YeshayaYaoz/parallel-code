import type { ModelInfo, Provider, RoutingMode } from './registry.js';

export interface ProviderSuccess {
  ok: true;
  text: string;
}

export interface ProviderFailure {
  ok: false;
  /** True when this looks like quota/rate-limit exhaustion rather than a real error. */
  quotaExceeded: boolean;
  /** ISO timestamp, when the provider told us exactly when it resets (e.g. Retry-After). */
  resetAt?: string;
  error: string;
}

export type ProviderResponse = ProviderSuccess | ProviderFailure;

export interface ProviderAdapter {
  provider: Provider;
  /** True when the env var(s) this provider needs are present. Unconfigured
   *  providers are skipped by the router rather than attempted and failed. */
  isConfigured(): boolean;
  /** Plain text Q&A — safe and uniform across every provider, no repo access.
   *  Repo-editing coding tasks are handled separately (Claude-only for now —
   *  see router.ts) since only Claude has a verified-safe unattended,
   *  auto-approving execution path (claude-code-action). */
  ask(prompt: string, model: ModelInfo): Promise<ProviderResponse>;
}

export interface QueuedTask {
  number: number;
  title: string;
  body: string;
  mode: RoutingMode;
  /** True when the issue is labeled for repo edits, not just a question. */
  needsRepoAccess: boolean;
}
