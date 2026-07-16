import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueuedTask } from './types.js';

const ghMocks = vi.hoisted(() => ({
  listQueuedTasks: vi.fn<() => Promise<QueuedTask[]>>(),
  addLabel: vi.fn().mockResolvedValue(undefined),
  removeLabel: vi.fn().mockResolvedValue(undefined),
  commentOnIssue: vi.fn().mockResolvedValue(undefined),
  listCommentBodies: vi.fn<(issueNumber: number) => Promise<string[]>>().mockResolvedValue([]),
  runClaudeWorkflow: vi.fn(),
}));
vi.mock('./github.js', () => ghMocks);

const openaiAsk = vi.hoisted(() => vi.fn());
const geminiAsk = vi.hoisted(() => vi.fn());
vi.mock('./providers/openai.js', () => ({
  openaiAdapter: { provider: 'openai', isConfigured: () => true, ask: openaiAsk },
}));
vi.mock('./providers/gemini.js', () => ({
  geminiAdapter: { provider: 'google', isConfigured: () => true, ask: geminiAsk },
}));
vi.mock('./providers/deepseek.js', () => ({
  deepseekAdapter: { provider: 'deepseek', isConfigured: () => true, ask: vi.fn() },
}));
vi.mock('./providers/mistral.js', () => ({
  mistralAdapter: { provider: 'mistral', isConfigured: () => true, ask: vi.fn() },
}));
vi.mock('./providers/anthropic.js', () => ({
  anthropicAdapter: { provider: 'anthropic', isConfigured: () => true, ask: vi.fn() },
}));

const { processQueueOnce } = await import('./router.js');
const { clearCooldown, isAvailable } = await import('./cooldowns.js');

function task(overrides: Partial<QueuedTask> = {}): QueuedTask {
  return {
    number: 1,
    title: 'Test task',
    body: 'Do the thing',
    mode: 'balanced',
    needsRepoAccess: false,
    ...overrides,
  };
}

describe('processQueueOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const p of ['anthropic', 'openai', 'google', 'deepseek', 'mistral'] as const) {
      clearCooldown(p);
    }
  });

  it('does nothing when the queue is empty', async () => {
    ghMocks.listQueuedTasks.mockResolvedValue([]);
    await processQueueOnce();
    expect(ghMocks.commentOnIssue).not.toHaveBeenCalled();
    expect(ghMocks.addLabel).not.toHaveBeenCalled();
  });

  it('posts the answer and labels the issue on a successful Q&A task', async () => {
    ghMocks.listQueuedTasks.mockResolvedValue([task({ mode: 'balanced' })]);
    geminiAsk.mockResolvedValue({ ok: true, text: 'the answer' });

    await processQueueOnce();

    expect(ghMocks.addLabel).toHaveBeenCalledWith(1, 'ultrakod-in-progress');
    expect(ghMocks.commentOnIssue).toHaveBeenCalledWith(1, expect.stringContaining('the answer'));
    expect(ghMocks.addLabel).toHaveBeenCalledWith(1, 'ultrakod-answered');
    expect(ghMocks.removeLabel).toHaveBeenCalledWith(1, 'ultrakod-in-progress');
  });

  it('marks the provider cooling down on a quota-exceeded response', async () => {
    ghMocks.listQueuedTasks.mockResolvedValue([task({ mode: 'balanced' })]);
    geminiAsk.mockResolvedValue({ ok: false, quotaExceeded: true, error: 'rate limited' });

    await processQueueOnce();

    expect(isAvailable('google')).toBe(false);
    expect(ghMocks.commentOnIssue).toHaveBeenCalledWith(1, expect.stringContaining('rate-limited'));
  });

  it('does not mark a cooldown on a non-quota failure', async () => {
    ghMocks.listQueuedTasks.mockResolvedValue([task({ mode: 'balanced' })]);
    geminiAsk.mockResolvedValue({ ok: false, quotaExceeded: false, error: 'boom' });

    await processQueueOnce();

    expect(isAvailable('google')).toBe(true);
    expect(ghMocks.commentOnIssue).toHaveBeenCalledWith(1, expect.stringContaining('boom'));
  });

  it('stops retrying and labels the issue stuck after enough failed attempts', async () => {
    ghMocks.listQueuedTasks.mockResolvedValue([task({ mode: 'balanced' })]);
    geminiAsk.mockResolvedValue({ ok: false, quotaExceeded: false, error: 'still broken' });
    // 19 prior failure comments already on the issue -> this attempt is #20, the cap.
    ghMocks.listCommentBodies.mockResolvedValue(Array(19).fill('⚠️ prior failure'));

    await processQueueOnce();

    expect(ghMocks.addLabel).toHaveBeenCalledWith(1, 'ultrakod-stuck');
    expect(ghMocks.commentOnIssue).toHaveBeenCalledWith(
      1,
      expect.stringContaining('stopping automatic retries'),
    );
  });

  it('does not stop retrying while under the cap', async () => {
    ghMocks.listQueuedTasks.mockResolvedValue([task({ mode: 'balanced' })]);
    geminiAsk.mockResolvedValue({ ok: false, quotaExceeded: false, error: 'still broken' });
    ghMocks.listCommentBodies.mockResolvedValue(Array(5).fill('⚠️ prior failure'));

    await processQueueOnce();

    expect(ghMocks.addLabel).not.toHaveBeenCalledWith(1, 'ultrakod-stuck');
    expect(ghMocks.commentOnIssue).toHaveBeenCalledWith(1, expect.stringContaining('attempt 6/20'));
  });

  it('routes a coding task to Claude even when a cheaper provider would otherwise win the mode', async () => {
    // 'cheap' mode would normally pick mistral-small-3 (see registry.test.ts) —
    // a coding task must still go to Claude regardless.
    ghMocks.listQueuedTasks.mockResolvedValue([task({ mode: 'cheap', needsRepoAccess: true })]);
    ghMocks.runClaudeWorkflow.mockResolvedValue({ conclusion: 'success' });

    await processQueueOnce();

    expect(ghMocks.runClaudeWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 1, model: 'claude-haiku-4-5' }),
    );
  });

  it('skips a coding task without commenting failure when Claude is cooling down', async () => {
    ghMocks.listQueuedTasks.mockResolvedValue([task({ mode: 'balanced', needsRepoAccess: true })]);
    const { markCoolingDown } = await import('./cooldowns.js');
    markCoolingDown('anthropic', new Date(Date.now() + 60_000).toISOString());

    await processQueueOnce();

    expect(ghMocks.runClaudeWorkflow).not.toHaveBeenCalled();
    expect(ghMocks.commentOnIssue).toHaveBeenCalledWith(1, expect.stringContaining('cooling down'));
  });

  it('marks Claude cooling down when the workflow run fails', async () => {
    ghMocks.listQueuedTasks.mockResolvedValue([task({ mode: 'balanced', needsRepoAccess: true })]);
    ghMocks.runClaudeWorkflow.mockResolvedValue({ conclusion: 'failure' });

    await processQueueOnce();
    // Fire-and-forget coding task — let its promise settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(isAvailable('anthropic')).toBe(false);
  });
});
