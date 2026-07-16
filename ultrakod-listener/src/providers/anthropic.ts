import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ModelInfo } from '../registry.js';
import type { ProviderAdapter, ProviderResponse } from '../types.js';

const execFileAsync = promisify(execFile);

// Quota/rate-limit messages from the claude CLI aren't a stable, documented
// machine-readable format across versions, so detection is a best-effort
// substring heuristic — the same approach already used in
// .github/workflows/claude-queue.yml's retry logic. This can miss a genuine
// quota error (misread as a plain failure) or, less likely, misfire on an
// ordinary error that happens to mention "limit". Either way the cooldown/
// backoff design in cooldowns.ts tolerates it without getting stuck: a
// misclassified plain failure still gets retried with backoff, just under
// the "not a quota error" label instead of "quota error".
const QUOTA_HINT_RE = /usage limit|rate limit|quota|try again later/i;

interface ExecError {
  message?: string;
  stdout?: string;
  stderr?: string;
}

export const anthropicAdapter: ProviderAdapter = {
  provider: 'anthropic',
  // Requires `claude setup-token` to have been run and its output stored as
  // this env var — see the README for the one-time setup steps. Ties to the
  // subscription's usage window rather than metered API billing.
  isConfigured: () => Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
  async ask(prompt: string, model: ModelInfo): Promise<ProviderResponse> {
    try {
      // `@anthropic-ai/claude-code` is a local (non-global) dependency here —
      // its `claude` binary lands in node_modules/.bin, not on PATH, so it's
      // invoked through npx (which resolves local project binaries) rather
      // than assuming a bare `claude` is runnable directly.
      const { stdout } = await execFileAsync(
        'npx',
        ['claude', '-p', prompt, '--output-format', 'text', '--model', model.id],
        {
          env: process.env,
          timeout: 5 * 60 * 1000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      return { ok: true, text: stdout.trim() };
    } catch (err) {
      const e = err as ExecError;
      const message = e.message ?? String(err);
      const combined = `${message} ${e.stdout ?? ''} ${e.stderr ?? ''}`;
      return { ok: false, quotaExceeded: QUOTA_HINT_RE.test(combined), error: message };
    }
  },
};
