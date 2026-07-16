import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { CliTaskSubmission } from './cli-tasks.js';

let dir: string;
let mod: typeof import('./cli-tasks.js');

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'cli-tasks-test-'));
  process.env.CLI_TASKS_DIR = dir;
  process.env.CLI_QUEUE_TOKEN = 'test-token';
  vi.resetModules();
  mod = await import('./cli-tasks.js');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.CLI_TASKS_DIR;
  delete process.env.CLI_QUEUE_TOKEN;
});

function submission(overrides: Partial<CliTaskSubmission> = {}): CliTaskSubmission {
  return {
    taskId: 'task-1',
    mode: 'balanced',
    prompt: 'what should I do next?',
    context: { transcriptExcerpt: 'recent terminal output' },
    ...overrides,
  };
}

describe('submitCliTask / getCliTask', () => {
  it('round-trips a submitted task as pending', () => {
    const record = mod.submitCliTask(submission());
    expect(record.status).toBe('pending');

    const fetched = mod.getCliTask('task-1');
    expect(fetched).toMatchObject({
      id: 'task-1',
      status: 'pending',
      prompt: 'what should I do next?',
    });
  });

  it('rejects a taskId with path-traversal characters', () => {
    expect(() => mod.submitCliTask(submission({ taskId: '../../etc/passwd' }))).toThrow();
  });

  it('returns null for an unknown id', () => {
    expect(mod.getCliTask('does-not-exist')).toBeNull();
  });
});

describe('listPendingCliTasks', () => {
  it('only returns pending tasks, oldest first', () => {
    mod.submitCliTask(submission({ taskId: 'task-a' }));
    mod.submitCliTask(submission({ taskId: 'task-b' }));
    mod.markCliTaskAnswered('task-a', 'the answer', 'gpt-5.5');

    const pending = mod.listPendingCliTasks();
    expect(pending.map((t) => t.id)).toEqual(['task-b']);
  });
});

describe('markCliTaskAnswered / markCliTaskFailedAttempt', () => {
  it('marks a task answered with its model and text', () => {
    mod.submitCliTask(submission());
    mod.markCliTaskAnswered('task-1', 'the answer', 'gpt-5.5');

    expect(mod.getCliTask('task-1')).toMatchObject({
      status: 'answered',
      answer: 'the answer',
      model: 'gpt-5.5',
    });
  });

  it('stays pending under the attempt cap', () => {
    mod.submitCliTask(submission());
    for (let i = 0; i < 5; i++) mod.markCliTaskFailedAttempt('task-1', 'boom', 20);

    expect(mod.getCliTask('task-1')?.status).toBe('pending');
  });

  it('flips to failed once the attempt cap is reached', () => {
    mod.submitCliTask(submission());
    for (let i = 0; i < 20; i++) mod.markCliTaskFailedAttempt('task-1', 'boom', 20);

    expect(mod.getCliTask('task-1')?.status).toBe('failed');
  });
});

function fakeRequest(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const chunks = opts.body ? [Buffer.from(opts.body)] : [];
  return {
    method: opts.method,
    url: opts.url,
    headers: opts.headers ?? {},
    [Symbol.asyncIterator]: () => {
      let i = 0;
      return {
        next: () =>
          Promise.resolve(
            i < chunks.length
              ? { value: chunks[i++], done: false }
              : { value: undefined, done: true },
          ),
      };
    },
  } as unknown as IncomingMessage;
}

function fakeResponse(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: '',
    writeHead(status: number) {
      res.statusCode = status;
    },
    end(body?: string) {
      res.body = body ?? '';
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}

describe('handleCliTasksRequest', () => {
  it('reports not-handled for unrelated paths', async () => {
    const handled = await mod.handleCliTasksRequest(
      fakeRequest({ method: 'GET', url: '/health' }),
      fakeResponse(),
    );
    expect(handled).toBe(false);
  });

  it('rejects a missing or wrong bearer token', async () => {
    const res = fakeResponse();
    await mod.handleCliTasksRequest(
      fakeRequest({
        method: 'POST',
        url: '/cli-tasks',
        headers: { authorization: 'Bearer wrong' },
      }),
      res,
    );
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid submission', async () => {
    const res = fakeResponse();
    await mod.handleCliTasksRequest(
      fakeRequest({
        method: 'POST',
        url: '/cli-tasks',
        headers: { authorization: 'Bearer test-token' },
        body: JSON.stringify(submission()),
      }),
      res,
    );
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toMatchObject({ id: 'task-1', status: 'pending' });
  });

  it('rejects a malformed submission', async () => {
    const res = fakeResponse();
    await mod.handleCliTasksRequest(
      fakeRequest({
        method: 'POST',
        url: '/cli-tasks',
        headers: { authorization: 'Bearer test-token' },
        body: JSON.stringify({ taskId: 'task-1' }),
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns task status on GET', async () => {
    mod.submitCliTask(submission());
    const res = fakeResponse();
    await mod.handleCliTasksRequest(
      fakeRequest({
        method: 'GET',
        url: '/cli-tasks/task-1',
        headers: { authorization: 'Bearer test-token' },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'pending' });
  });

  it('404s for an unknown task id', async () => {
    const res = fakeResponse();
    await mod.handleCliTasksRequest(
      fakeRequest({
        method: 'GET',
        url: '/cli-tasks/nope',
        headers: { authorization: 'Bearer test-token' },
      }),
      res,
    );
    expect(res.statusCode).toBe(404);
  });
});
