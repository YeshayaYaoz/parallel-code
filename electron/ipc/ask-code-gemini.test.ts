import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  askAboutCodeGemini,
  cancelAskAboutCodeGemini,
  GEMINI_MODEL,
  setGeminiApiKey,
} from './ask-code-gemini.js';

function makeMockWin() {
  const messages: unknown[] = [];
  const win = {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: {
      send: vi.fn().mockImplementation((_ch: string, msg: unknown) => {
        messages.push(msg);
      }),
    },
  } as unknown as import('electron').BrowserWindow;
  return { win, messages };
}

function waitForDone(messages: unknown[], timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function check() {
      if (messages.some((m) => (m as Record<string, unknown>).type === 'done')) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for done message'));
        return;
      }
      setTimeout(check, 10);
    }
    check();
  });
}

function makeStreamResponse(sseText: string): Response {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(sseText);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function sseCandidateChunk(text: string): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;
}

describe('askAboutCodeGemini', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setGeminiApiKey('test-key');
  });

  it('throws if prompt exceeds max length', () => {
    const { win } = makeMockWin();
    const longPrompt = 'x'.repeat(50_001);
    expect(() =>
      askAboutCodeGemini(win, { requestId: 'r1', channelId: 'ch1', prompt: longPrompt }),
    ).toThrow(/Prompt too long/);
  });

  it('throws if no API key is set', () => {
    setGeminiApiKey('');
    const { win } = makeMockWin();
    expect(() =>
      askAboutCodeGemini(win, { requestId: 'r1b', channelId: 'ch1b', prompt: 'hi' }),
    ).toThrow(/API key is not set/);
  });

  it('sends chunk messages for each candidate text part', async () => {
    const { win, messages } = makeMockWin();
    const sseText = sseCandidateChunk('Hello') + sseCandidateChunk(', world');
    mockFetch.mockResolvedValueOnce(makeStreamResponse(sseText));

    askAboutCodeGemini(win, { requestId: 'r2', channelId: 'ch2', prompt: 'Explain this code' });
    await waitForDone(messages);

    const chunkMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'chunk');
    expect(chunkMsgs).toHaveLength(2);
    expect((chunkMsgs[0] as Record<string, unknown>).text).toBe('Hello');

    const doneMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'done');
    expect((doneMsgs[0] as Record<string, unknown>).exitCode).toBe(0);
  });

  it('sends error message on non-ok HTTP response', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockResolvedValueOnce(new Response('Bad request', { status: 400 }));

    askAboutCodeGemini(win, { requestId: 'r3', channelId: 'ch3', prompt: 'What is this?' });
    await waitForDone(messages);

    const errMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'error');
    expect((errMsgs[0] as Record<string, unknown>).text).toMatch(/400/);
  });

  it('sends error message when fetch rejects', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    askAboutCodeGemini(win, { requestId: 'r4', channelId: 'ch4', prompt: 'Explain' });
    await waitForDone(messages);

    const errMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'error');
    expect((errMsgs[0] as Record<string, unknown>).text).toMatch(/Network failure/);
  });

  it('includes the API key as a query parameter and the configured model in the URL', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockResolvedValueOnce(makeStreamResponse(''));

    setGeminiApiKey('my-secret-key');
    askAboutCodeGemini(win, { requestId: 'r5', channelId: 'ch5', prompt: 'Explain' });
    await waitForDone(messages);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(`models/${GEMINI_MODEL}:streamGenerateContent`);
    expect(url).toContain('key=my-secret-key');
    expect(url).toContain('alt=sse');
  });

  it('sends the prompt as user content and a systemInstruction', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockResolvedValueOnce(makeStreamResponse(''));

    askAboutCodeGemini(win, { requestId: 'r6', channelId: 'ch6', prompt: 'Explain this snippet' });
    await waitForDone(messages);

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string) as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      systemInstruction: { parts: Array<{ text: string }> };
    };
    expect(body.contents[0].parts[0].text).toBe('Explain this snippet');
    expect(body.systemInstruction.parts[0].text).toMatch(/markdown/i);
  });

  it('does not send to destroyed window', async () => {
    const { win, messages } = makeMockWin();
    (win.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(makeStreamResponse(sseCandidateChunk('Hello')));

    askAboutCodeGemini(win, { requestId: 'r9', channelId: 'ch9', prompt: 'Test' });
    await new Promise((r) => setTimeout(r, 100));
    expect(messages).toHaveLength(0);
  });
});

describe('cancelAskAboutCodeGemini', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setGeminiApiKey('test-key');
  });

  it('cancels a pending request without sending an error message', async () => {
    const { win, messages } = makeMockWin();
    const neverEnding = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(0));
      },
    });
    mockFetch.mockResolvedValueOnce(new Response(neverEnding, { status: 200 }));

    askAboutCodeGemini(win, { requestId: 'cancel-1', channelId: 'ch-cancel', prompt: 'Test' });
    await new Promise((r) => setTimeout(r, 20));

    cancelAskAboutCodeGemini('cancel-1');
    await waitForDone(messages);

    const errMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'error');
    expect(errMsgs).toHaveLength(0);
  });

  it('is a no-op for unknown requestId', () => {
    expect(() => cancelAskAboutCodeGemini('unknown-id')).not.toThrow();
  });
});
