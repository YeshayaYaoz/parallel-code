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

interface GeminiAskCodeRequest {
  requestId: string;
  channelId: string;
  prompt: string;
}

export const GEMINI_MODEL = 'gemini-3.5-flash';

function geminiStreamUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;
}

const activeRequests = new RequestRegistry<AbortController>({
  maxConcurrent: ASK_CODE_MAX_CONCURRENT,
  timeoutMs: ASK_CODE_TIMEOUT_MS,
});

/** Main-process storage for the Gemini API key. Never sent back to the renderer. */
let storedApiKey = '';

export function setGeminiApiKey(key: string): void {
  storedApiKey = key.trim();
}

export function askAboutCodeGemini(win: BrowserWindow, args: GeminiAskCodeRequest): void {
  const { requestId, channelId, prompt } = args;
  const apiKey = storedApiKey;

  if (!apiKey) {
    throw new Error('Gemini API key is not set. Please configure it in Settings.');
  }

  assertPromptWithinLimit(prompt);
  assertCanStart(activeRequests, requestId);

  cancelAskAboutCodeGemini(requestId);

  const controller = new AbortController();

  const send = (msg: unknown) => {
    if (!win.isDestroyed()) {
      win.webContents.send(`channel:${channelId}`, msg);
    }
  };

  const session = AskCodeSession.start(activeRequests, requestId, controller, send, (request) =>
    request.abort(),
  );

  fetch(geminiStreamUrl(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: 'Answer concisely about the selected code. Use markdown.' }],
      },
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(`Gemini API error (${res.status}): ${text}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      let aborted = false;
      const onAbort = () => {
        aborted = true;
        reader.cancel().catch((err) => {
          logDebug('askCode.gemini', 'reader.cancel rejected', { err: String(err) });
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
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
              };
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) send({ type: 'chunk', text });
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

export function cancelAskAboutCodeGemini(requestId: string): void {
  activeRequests.cancel(requestId);
}

export function isGeminiRequestActive(requestId: string): boolean {
  return activeRequests.has(requestId);
}
