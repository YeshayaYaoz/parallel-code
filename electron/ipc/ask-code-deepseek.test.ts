import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  askAboutCodeDeepseek,
  cancelAskAboutCodeDeepseek,
  DEEPSEEK_MODEL,
  setDeepseekApiKey,
} from './ask-code-deepseek.js';

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

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

describe('askAboutCodeDeepseek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDeepseekApiKey('test-key');
  });

  it('throws if prompt exceeds max length', () => {
    const { win } = makeMockWin();
    const longPrompt = 'x'.repeat(50_001);
    expect(() =>
      askAboutCodeDeepseek(win, { requestId: 'r1', channelId: 'ch1', prompt: longPrompt }),
    ).toThrow(/Prompt too long/);
  });

  it('throws if no API key is set', () => {
    setDeepseekApiKey('');
    const { win } = makeMockWin();
    expect(() =>
      askAboutCodeDeepseek(win, { requestId: 'r1b', channelId: 'ch1b', prompt: 'hi' }),
    ).toThrow(/API key is not set/);
  });

  it('sends chunk messages for each SSE delta', async () => {
    const { win, messages } = makeMockWin();
    const sseText = sseChunk('Hello') + sseChunk(', world') + 'data: [DONE]\n\n';
    mockFetch.mockResolvedValueOnce(makeStreamResponse(sseText));

    askAboutCodeDeepseek(win, { requestId: 'r2', channelId: 'ch2', prompt: 'Explain this code' });
    await waitForDone(messages);

    const chunkMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'chunk');
    expect(chunkMsgs).toHaveLength(2);
    expect((chunkMsgs[0] as Record<string, unknown>).text).toBe('Hello');

    const doneMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'done');
    expect((doneMsgs[0] as Record<string, unknown>).exitCode).toBe(0);
  });

  it('sends error message on non-ok HTTP response', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    askAboutCodeDeepseek(win, { requestId: 'r3', channelId: 'ch3', prompt: 'What is this?' });
    await waitForDone(messages);

    const errMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'error');
    expect((errMsgs[0] as Record<string, unknown>).text).toMatch(/401/);
  });

  it('sends error message when fetch rejects', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    askAboutCodeDeepseek(win, { requestId: 'r4', channelId: 'ch4', prompt: 'Explain' });
    await waitForDone(messages);

    const errMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'error');
    expect((errMsgs[0] as Record<string, unknown>).text).toMatch(/Network failure/);
  });

  it('sends correct Authorization header with Bearer token', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockResolvedValueOnce(makeStreamResponse('data: [DONE]\n\n'));

    setDeepseekApiKey('my-secret-key');
    askAboutCodeDeepseek(win, { requestId: 'r5', channelId: 'ch5', prompt: 'Explain' });
    await waitForDone(messages);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer my-secret-key' }),
      }),
    );
  });

  it('uses the configured DeepSeek model', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockResolvedValueOnce(makeStreamResponse('data: [DONE]\n\n'));

    askAboutCodeDeepseek(win, { requestId: 'r6', channelId: 'ch6', prompt: 'Test' });
    await waitForDone(messages);

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string) as {
      model: string;
    };
    expect(body.model).toBe(DEEPSEEK_MODEL);
  });

  it('uses streaming mode', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockResolvedValueOnce(makeStreamResponse('data: [DONE]\n\n'));

    askAboutCodeDeepseek(win, { requestId: 'r8', channelId: 'ch8', prompt: 'Test' });
    await waitForDone(messages);

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string) as {
      stream: boolean;
    };
    expect(body.stream).toBe(true);
  });

  it('does not send to destroyed window', async () => {
    const { win, messages } = makeMockWin();
    (win.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(makeStreamResponse(sseChunk('Hello') + 'data: [DONE]\n\n'));

    askAboutCodeDeepseek(win, { requestId: 'r9', channelId: 'ch9', prompt: 'Test' });
    await new Promise((r) => setTimeout(r, 100));
    expect(messages).toHaveLength(0);
  });
});

describe('cancelAskAboutCodeDeepseek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDeepseekApiKey('test-key');
  });

  it('cancels a pending request without sending an error message', async () => {
    const { win, messages } = makeMockWin();
    const neverEnding = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(0));
      },
    });
    mockFetch.mockResolvedValueOnce(new Response(neverEnding, { status: 200 }));

    askAboutCodeDeepseek(win, { requestId: 'cancel-1', channelId: 'ch-cancel', prompt: 'Test' });
    await new Promise((r) => setTimeout(r, 20));

    cancelAskAboutCodeDeepseek('cancel-1');
    await waitForDone(messages);

    const errMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'error');
    expect(errMsgs).toHaveLength(0);
  });

  it('is a no-op for unknown requestId', () => {
    expect(() => cancelAskAboutCodeDeepseek('unknown-id')).not.toThrow();
  });
});
