import type { ProviderResponse } from '../types.js';

/** Shared helper for OpenAI-compatible /chat/completions endpoints — OpenAI
 *  itself, DeepSeek, and Mistral all document this same request/response
 *  shape, so one implementation covers all three. Google's Gemini uses a
 *  different native shape (see providers/gemini.ts) and Anthropic goes
 *  through the claude CLI for subscription auth (see providers/anthropic.ts),
 *  not a raw API call, so neither uses this helper. */
export async function openaiCompatibleAsk(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<ProviderResponse> {
  try {
    const res = await fetch(`${args.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: 'user', content: args.prompt }],
      }),
    });

    if (res.status === 429) {
      return {
        ok: false,
        quotaExceeded: true,
        resetAt: retryAfterToIso(res.headers.get('retry-after')),
        error: 'Rate limited (HTTP 429).',
      };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`);
      return { ok: false, quotaExceeded: false, error: `HTTP ${res.status}: ${text}` };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      return { ok: false, quotaExceeded: false, error: 'Empty response from provider.' };
    }
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      quotaExceeded: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Retry-After is seconds-from-now per HTTP spec; convert to an absolute ISO
 *  timestamp so cooldowns.ts can compare it uniformly regardless of source. */
function retryAfterToIso(header: string | null): string | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds)) return undefined;
  return new Date(Date.now() + seconds * 1000).toISOString();
}
