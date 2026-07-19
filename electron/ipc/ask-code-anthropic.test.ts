import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  askAboutCodeAnthropic,
  cancelAskAboutCodeAnthropic,
  ANTHROPIC_MODEL,
  setAnthropicApiKey,
} from './ask-code-anthropic.js';

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

function sseDeltaChunk(text: string): string {
  return `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`;
}

describe('askAboutCodeAnthropic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAnthropicApiKey('test-key');
  });

  it('throws if prompt exceeds max length', () => {
    const { win } = makeMockWin();
    const longPrompt = 'x'.repeat(50_001);
    expect(() =>
      askAboutCodeAnthropic(win, { requestId: 'r1', channelId: 'ch1', prompt: longPrompt }),
    ).toThrow(/Prompt too long/);
  });

  it('throws if no API key is set', () => {
    setAnthropicApiKey('');
    const { win } = makeMockWin();
    expect(() =>
      askAboutCodeAnthropic(win, { requestId: 'r1b', channelId: 'ch1b', prompt: 'hi' }),
    ).toThrow(/API key is not set/);
  });

  it('sends chunk messages for each content_block_delta event', async () => {
    const { win, messages } = makeMockWin();

    const sseText = sseDeltaChunk('Hello') + sseDeltaChunk(', world');
    mockFetch.mockResolvedValueOnce(makeStreamResponse(sseText));

    askAboutCodeAnthropic(win, { requestId: 'r2', channelId: 'ch2', prompt: 'Explain this code' });

    await waitForDone(messages);

    const chunkMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'chunk');
    expect(chunkMsgs).toHaveLength(2);
    expect((chunkMsgs[0] as Record<string, unknown>).text).toBe('Hello');
    expect((chunkMsgs[1] as Record<string, unknown>).text).toBe(', world');

    const doneMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'done');
    expect(doneMsgs).toHaveLength(1);
    expect((doneMsgs[0] as Record<string, unknown>).exitCode).toBe(0);
  });

  it('ignores non-text-delta event types', async () => {
    const { win, messages } = makeMockWin();
    const sseText =
      `data: ${JSON.stringify({ type: 'message_start' })}\n\n` +
      sseDeltaChunk('actual text') +
      `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
    mockFetch.mockResolvedValueOnce(makeStreamResponse(sseText));

    askAboutCodeAnthropic(win, { requestId: 'r2b', channelId: 'ch2b', prompt: 'Test' });
    await waitForDone(messages);

    const chunkMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'chunk');
    expect(chunkMsgs).toHaveLength(1);
    expect((chunkMsgs[0] as Record<string, unknown>).text).toBe('actual text');
  });

  it('sends error message on non-ok HTTP response', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    askAboutCodeAnthropic(win, { requestId: 'r3', channelId: 'ch3', prompt: 'What is this?' });
    await waitForDone(messages);

    const errMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'error');
    expect(errMsgs.length).toBeGreaterThan(0);
    expect((errMsgs[0] as Record<string, unknown>).text).toMatch(/401/);

    const doneMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'done');
    expect((doneMsgs[0] as Record<string, unknown>).exitCode).toBe(1);
  });

  it('sends error message when fetch rejects', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    askAboutCodeAnthropic(win, { requestId: 'r4', channelId: 'ch4', prompt: 'Explain' });
    await waitForDone(messages);

    const errMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'error');
    expect(errMsgs.length).toBeGreaterThan(0);
    expect((errMsgs[0] as Record<string, unknown>).text).toMatch(/Network failure/);
  });

  it('sends correct x-api-key and anthropic-version headers', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockResolvedValueOnce(makeStreamResponse(''));

    setAnthropicApiKey('my-secret-key');
    askAboutCodeAnthropic(win, { requestId: 'r5', channelId: 'ch5', prompt: 'Explain' });
    await waitForDone(messages);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'my-secret-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
  });

  it('uses the configured Anthropic model', async () => {
    const { win, messages } = makeMockWin();
    mockFetch.mockResolvedValueOnce(makeStreamResponse(''));

    askAboutCodeAnthropic(win, { requestId: 'r6', channelId: 'ch6', prompt: 'Test' });
    await waitForDone(messages);

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string) as {
      model: string;
    };
    expect(body.model).toBe(ANTHROPIC_MODEL);
  });

  it('does not send to destroyed window', async () => {
    const { win, messages } = makeMockWin();
    (win.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockFetch.mockResolvedValueOnce(makeStreamResponse(sseDeltaChunk('Hello')));

    askAboutCodeAnthropic(win, { requestId: 'r9', channelId: 'ch9', prompt: 'Test' });
    await new Promise((r) => setTimeout(r, 100));
    expect(messages).toHaveLength(0);
  });
});

describe('cancelAskAboutCodeAnthropic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAnthropicApiKey('test-key');
  });

  it('cancels a pending request without sending an error message', async () => {
    const { win, messages } = makeMockWin();
    const neverEnding = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(0));
      },
    });
    mockFetch.mockResolvedValueOnce(new Response(neverEnding, { status: 200 }));

    askAboutCodeAnthropic(win, { requestId: 'cancel-1', channelId: 'ch-cancel', prompt: 'Test' });
    await new Promise((r) => setTimeout(r, 20));

    cancelAskAboutCodeAnthropic('cancel-1');
    await waitForDone(messages);

    const errMsgs = messages.filter((m) => (m as Record<string, unknown>).type === 'error');
    expect(errMsgs).toHaveLength(0);
  });

  it('is a no-op for unknown requestId', () => {
    expect(() => cancelAskAboutCodeAnthropic('unknown-id')).not.toThrow();
  });
});
