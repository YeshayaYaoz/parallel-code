import type { ModelInfo } from '../registry.js';
import type { ProviderAdapter, ProviderResponse } from '../types.js';

// Registry id -> Gemini's actual API model slug. Google's official model-list
// and pricing pages both blocked automated fetch during research, so — unlike
// the OpenAI/Anthropic mappings — these are a best-effort guess following
// Google's naming convention, not independently confirmed. Verify against
// https://ai.google.dev/gemini-api/docs/models before relying on this; a
// wrong slug here surfaces as a 404, not silent misbehavior.
const API_MODEL_ID: Record<string, string> = {
  'gemini-3-flash': 'gemini-3-flash',
  'gemini-3.5-flash': 'gemini-3.5-flash',
  'gemini-3.1-pro': 'gemini-3.1-pro',
};

export const geminiAdapter: ProviderAdapter = {
  provider: 'google',
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
  async ask(prompt: string, model: ModelInfo): Promise<ProviderResponse> {
    const apiKey = process.env.GEMINI_API_KEY ?? '';
    const apiModel = API_MODEL_ID[model.id] ?? model.id;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
      );

      if (res.status === 429) {
        return { ok: false, quotaExceeded: true, error: 'Rate limited (HTTP 429).' };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        return { ok: false, quotaExceeded: false, error: `HTTP ${res.status}: ${text}` };
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return { ok: false, quotaExceeded: false, error: 'Empty response from Gemini.' };
      }
      return { ok: true, text };
    } catch (err) {
      return {
        ok: false,
        quotaExceeded: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
