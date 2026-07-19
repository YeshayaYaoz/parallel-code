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

interface OpenaiAskCodeRequest {
  requestId: string;
  channelId: string;
  prompt: string;
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_MODEL = 'gpt-4o';

const activeRequests = new RequestRegistry<AbortController>({
  maxConcurrent: ASK_CODE_MAX_CONCURRENT,
  timeoutMs: ASK_CODE_TIMEOUT_MS,
});

/** Main-process storage for the OpenAI API key. Never sent back to the renderer. */
let storedApiKey = '';

export function setOpenaiApiKey(key: string): void {
  storedApiKey = key.trim();
}

export function askAboutCodeOpenai(win: BrowserWindow, args: OpenaiAskCodeRequest): void {
  const { requestId, channelId, prompt } = args;
  const apiKey = storedApiKey;

  if (!apiKey) {
    throw new Error('OpenAI API key is not set. Please configure it in Settings.');
  }

  assertPromptWithinLimit(prompt);
  assertCanStart(activeRequests, requestId);

  cancelAskAboutCodeOpenai(requestId);

  const controller = new AbortController();

  const send = (msg: unknown) => {
    if (!win.isDestroyed()) {
      win.webContents.send(`channel:${channelId}`, msg);
    }
  };

  const session = AskCodeSession.start(activeRequests, requestId, controller, send, (request) =>
    request.abort(),
  );

  fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'Answer concisely about the selected code. Use markdown.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
      stream: true,
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(`OpenAI API error (${res.status}): ${text}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      let aborted = false;
      const onAbort = () => {
        aborted = true;
        reader.cancel().catch((err) => {
          logDebug('askCode.openai', 'reader.cancel rejected', { err: String(err) });
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
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data:')) continue;
            try {
              const json = JSON.parse(trimmed.slice(5).trim()) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) send({ type: 'chunk', text: delta });
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

export function cancelAskAboutCodeOpenai(requestId: string): void {
  activeRequests.cancel(requestId);
}

export function isOpenaiRequestActive(requestId: string): boolean {
  return activeRequests.has(requestId);
}
