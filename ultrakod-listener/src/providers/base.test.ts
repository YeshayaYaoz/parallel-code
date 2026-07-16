import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openaiCompatibleAsk } from './base.js';

describe('openaiCompatibleAsk', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the message content on success', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), {
        status: 200,
      }),
    );

    const result = await openaiCompatibleAsk({
      baseUrl: 'https://api.example.com',
      apiKey: 'key',
      model: 'test-model',
      prompt: 'hi',
    });

    expect(result).toEqual({ ok: true, text: 'hello' });
  });

  it('sends the model, prompt, and bearer auth header', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }),
    );

    await openaiCompatibleAsk({
      baseUrl: 'https://api.example.com',
      apiKey: 'secret-key',
      model: 'test-model',
      prompt: 'the prompt',
    });

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe('https://api.example.com/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('test-model');
    expect(body.messages).toEqual([{ role: 'user', content: 'the prompt' }]);
  });

  it('marks 429 responses as quota exceeded and parses Retry-After', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response('', { status: 429, headers: { 'retry-after': '30' } }),
    );

    const result = await openaiCompatibleAsk({
      baseUrl: 'https://api.example.com',
      apiKey: 'key',
      model: 'test-model',
      prompt: 'hi',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.quotaExceeded).toBe(true);
      expect(result.resetAt).toBeDefined();
      expect(new Date(result.resetAt ?? '').getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('treats a 429 with no Retry-After header as quota exceeded with no resetAt', async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response('', { status: 429 }));

    const result = await openaiCompatibleAsk({
      baseUrl: 'https://api.example.com',
      apiKey: 'key',
      model: 'test-model',
      prompt: 'hi',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.quotaExceeded).toBe(true);
      expect(result.resetAt).toBeUndefined();
    }
  });

  it('treats other non-ok statuses as a plain (non-quota) failure', async () => {
    vi.mocked(global.fetch).mockResolvedValue(new Response('server exploded', { status: 500 }));

    const result = await openaiCompatibleAsk({
      baseUrl: 'https://api.example.com',
      apiKey: 'key',
      model: 'test-model',
      prompt: 'hi',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.quotaExceeded).toBe(false);
      expect(result.error).toContain('500');
    }
  });

  it('treats an empty choices array as a failure rather than throwing', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    );

    const result = await openaiCompatibleAsk({
      baseUrl: 'https://api.example.com',
      apiKey: 'key',
      model: 'test-model',
      prompt: 'hi',
    });

    expect(result).toEqual({
      ok: false,
      quotaExceeded: false,
      error: 'Empty response from provider.',
    });
  });

  it('catches network errors instead of throwing', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('network down'));

    const result = await openaiCompatibleAsk({
      baseUrl: 'https://api.example.com',
      apiKey: 'key',
      model: 'test-model',
      prompt: 'hi',
    });

    expect(result).toEqual({ ok: false, quotaExceeded: false, error: 'network down' });
  });
});
