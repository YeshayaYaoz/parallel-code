import type { BrowserWindow } from 'electron';
import { debug as logDebug } from '../log.js';
import {
  AskCodeSession,
  ASK_CODE_MAX_CONCURRENT,
  ASK_CODE_TIMEOUT_MS,
  RequestRegistry,
  assertCanStart,
  assertPromptWithinLimit,
} from './request-registry.js';

interface AnthropicAskCodeRequest {
  requestId: string;
  channelId: string;
  prompt: string;
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
export const ANTHROPIC_MODEL = 'claude-sonnet-5';

const activeRequests = new RequestRegistry<AbortController>({
  maxConcurrent: ASK_CODE_MAX_CONCURRENT,
  timeoutMs: ASK_CODE_TIMEOUT_MS,
});

/** Main-process storage for the Anthropic API key. Never sent back to the renderer. */
let storedApiKey = '';

export function setAnthropicApiKey(key: string): void {
  storedApiKey = key.trim();
}

export function askAboutCodeAnthropic(win: BrowserWindow, args: AnthropicAskCodeRequest): void {
  const { requestId, channelId, prompt } = args;
  const apiKey = storedApiKey;

  if (!apiKey) {
    throw new Error('Anthropic API key is not set. Please configure it in Settings.');
  }

  assertPromptWithinLimit(prompt);
  assertCanStart(activeRequests, requestId);

  cancelAskAboutCodeAnthropic(requestId);

  const controller = new AbortController();

  const send = (msg: unknown) => {
    if (!win.isDestroyed()) {
      win.webContents.send(`channel:${channelId}`, msg);
    }
  };

  const session = AskCodeSession.start(activeRequests, requestId, controller, send, (request) =>
    request.abort(),
  );

  fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: 'Answer concisely about the selected code. Use markdown.',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(`Anthropic API error (${res.status}): ${text}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      // When the AbortController fires, cancel the reader so reader.read() resolves
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        reader.cancel().catch((err) => {
          logDebug('askCode.anthropic', 'reader.cancel rejected', { err: String(err) });
        });
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || aborted) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            try {
              const json = JSON.parse(trimmed.slice(5).trim()) as {
                type?: string;
                delta?: { type?: string; text?: string };
              };
              if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                const text = json.delta.text;
                if (text) send({ type: 'chunk', text });
              }
            } catch {
              // ignore parse errors in SSE stream
            }
          }
        }
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
      }

      session.cleanup();
      if (session.complete()) {
        send({ type: 'done', exitCode: 0, cancelled: aborted });
      }
    })
    .catch((err: unknown) => {
      session.cleanup();
      if (session.complete()) {
        if (err instanceof Error && err.name === 'AbortError') {
          send({ type: 'done', exitCode: 0, cancelled: true });
        } else {
          send({ type: 'error', text: err instanceof Error ? err.message : String(err) });
          send({ type: 'done', exitCode: 1 });
        }
      }
    });
}

export function cancelAskAboutCodeAnthropic(requestId: string): void {
  activeRequests.cancel(requestId);
}

export function isAnthropicRequestActive(requestId: string): boolean {
  return activeRequests.has(requestId);
}
