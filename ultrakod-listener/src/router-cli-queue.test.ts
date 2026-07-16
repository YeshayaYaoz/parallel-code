import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CliTaskRecord } from './cli-tasks.js';

const cliMocks = vi.hoisted(() => ({
  listPendingCliTasks: vi.fn<() => CliTaskRecord[]>(),
  markCliTaskAnswered: vi.fn(),
  markCliTaskFailedAttempt: vi.fn(),
}));
vi.mock('./cli-tasks.js', () => cliMocks);

const ghMocks = vi.hoisted(() => ({
  listQueuedTasks: vi.fn().mockResolvedValue([]),
  addLabel: vi.fn().mockResolvedValue(undefined),
  removeLabel: vi.fn().mockResolvedValue(undefined),
  commentOnIssue: vi.fn().mockResolvedValue(undefined),
  listCommentBodies: vi.fn().mockResolvedValue([]),
  runClaudeWorkflow: vi.fn(),
}));
vi.mock('./github.js', () => ghMocks);

const geminiAsk = vi.hoisted(() => vi.fn());
vi.mock('./providers/openai.js', () => ({
  openaiAdapter: { provider: 'openai', isConfigured: () => true, ask: vi.fn() },
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

const { processCliQueueOnce } = await import('./router.js');
const { clearCooldown, isAvailable } = await import('./cooldowns.js');

function cliTask(overrides: Partial<CliTaskRecord> = {}): CliTaskRecord {
  return {
    id: 'task-1',
    mode: 'balanced',
    prompt: 'what next?',
    context: { transcriptExcerpt: 'recent output' },
    status: 'pending',
    failedAttempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('processCliQueueOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cliMocks.listPendingCliTasks.mockReturnValue([]);
    for (const p of ['anthropic', 'openai', 'google', 'deepseek', 'mistral'] as const) {
      clearCooldown(p);
    }
  });

  it('does nothing when the queue is empty', async () => {
    await processCliQueueOnce();
    expect(cliMocks.markCliTaskAnswered).not.toHaveBeenCalled();
    expect(cliMocks.markCliTaskFailedAttempt).not.toHaveBeenCalled();
  });

  it('answers a pending task and records the result', async () => {
    cliMocks.listPendingCliTasks.mockReturnValue([cliTask()]);
    geminiAsk.mockResolvedValue({ ok: true, text: 'the answer' });

    await processCliQueueOnce();

    expect(cliMocks.markCliTaskAnswered).toHaveBeenCalledWith(
      'task-1',
      'the answer',
      expect.any(String),
    );
  });

  it('marks the provider cooling down on quota exhaustion and leaves the task pending', async () => {
    cliMocks.listPendingCliTasks.mockReturnValue([cliTask()]);
    geminiAsk.mockResolvedValue({ ok: false, quotaExceeded: true, error: 'rate limited' });

    await processCliQueueOnce();

    expect(isAvailable('google')).toBe(false);
    expect(cliMocks.markCliTaskFailedAttempt).not.toHaveBeenCalled();
  });

  it('records a failed attempt on a non-quota error', async () => {
    cliMocks.listPendingCliTasks.mockReturnValue([cliTask()]);
    geminiAsk.mockResolvedValue({ ok: false, quotaExceeded: false, error: 'boom' });

    await processCliQueueOnce();

    expect(cliMocks.markCliTaskFailedAttempt).toHaveBeenCalledWith('task-1', 'boom', 20);
  });

  it('builds the provider prompt from the transcript excerpt, git context, and the queued prompt', async () => {
    cliMocks.listPendingCliTasks.mockReturnValue([
      cliTask({
        context: { transcriptExcerpt: 'excerpt', gitDiff: 'diff-x', gitStatus: 'status-y' },
      }),
    ]);
    geminiAsk.mockResolvedValue({ ok: true, text: 'ok' });

    await processCliQueueOnce();

    const sentPrompt = geminiAsk.mock.calls[0][0] as string;
    expect(sentPrompt).toContain('excerpt');
    expect(sentPrompt).toContain('diff-x');
    expect(sentPrompt).toContain('status-y');
    expect(sentPrompt).toContain('what next?');
  });
});
