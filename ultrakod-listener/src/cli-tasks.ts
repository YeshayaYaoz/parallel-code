// Storage + HTTP handling for the "live CLI queue" — the second entry point
// into ultrakod, alongside the GitHub-issue queue in github.ts/router.ts.
// The Parallel Code desktop app submits a task here the moment its own
// terminal session detects a rate limit, instead of requiring the user to
// manually open a GitHub issue.
//
// Persisted as one JSON file per task (atomic write: .tmp + rename, same
// convention as electron/ipc/persistence.ts) rather than kept in memory like
// cooldowns.ts — a queued task holds a real pending user request, so losing
// it on a Railway restart is not an acceptable "cheap self-correcting cost"
// the way re-probing a cooldown is. Requires a Railway volume mounted at
// (or containing) this directory to actually survive redeploys — see
// README.md.

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { timingSafeEqual } from 'crypto';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { RoutingMode } from './registry.js';

export interface CliTaskContext {
  transcriptExcerpt: string;
  gitDiff?: string;
  gitStatus?: string;
}

export type CliTaskStatus = 'pending' | 'answered' | 'failed';

export interface CliTaskRecord {
  id: string;
  mode: RoutingMode;
  prompt: string;
  context: CliTaskContext;
  status: CliTaskStatus;
  answer?: string;
  model?: string;
  error?: string;
  failedAttempts: number;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = process.env.CLI_TASKS_DIR ?? path.join(process.cwd(), 'data', 'cli-tasks');

// Task ids are client-generated (crypto.randomUUID() on the app side) but
// still untrusted input over HTTP — constrain to a safe filename charset
// before ever joining into a path.
const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function isValidTaskId(id: string): boolean {
  return VALID_ID_RE.test(id);
}

function taskPath(id: string): string {
  return path.join(DATA_DIR, `${id}.json`);
}

function writeTask(record: CliTaskRecord): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = taskPath(record.id);
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2));
  renameSync(tmp, file);
}

export interface CliTaskSubmission {
  taskId: string;
  mode: RoutingMode;
  prompt: string;
  context: CliTaskContext;
}

export function submitCliTask(submission: CliTaskSubmission): CliTaskRecord {
  if (!isValidTaskId(submission.taskId)) {
    throw new Error('Invalid taskId');
  }
  const now = new Date().toISOString();
  const record: CliTaskRecord = {
    id: submission.taskId,
    mode: submission.mode,
    prompt: submission.prompt,
    context: submission.context,
    status: 'pending',
    failedAttempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  writeTask(record);
  return record;
}

export function getCliTask(id: string): CliTaskRecord | null {
  if (!isValidTaskId(id)) return null;
  const file = taskPath(id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as CliTaskRecord;
  } catch {
    return null;
  }
}

/** Every task currently awaiting a model, oldest first — the CLI-queue
 *  analogue of github.ts's listQueuedTasks(). */
export function listPendingCliTasks(): CliTaskRecord[] {
  mkdirSync(DATA_DIR, { recursive: true });
  const records = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(path.join(DATA_DIR, f), 'utf8')) as CliTaskRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is CliTaskRecord => r !== null && r.status === 'pending');
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function markCliTaskAnswered(id: string, answer: string, model: string): void {
  const record = getCliTask(id);
  if (!record) return;
  record.status = 'answered';
  record.answer = answer;
  record.model = model;
  record.updatedAt = new Date().toISOString();
  writeTask(record);
}

/** Records a failed attempt; flips to 'failed' once maxAttempts is reached,
 *  mirroring router.ts's MAX_QA_RETRIES cap for the GitHub-issue queue. */
export function markCliTaskFailedAttempt(id: string, error: string, maxAttempts: number): void {
  const record = getCliTask(id);
  if (!record) return;
  record.failedAttempts += 1;
  record.error = error;
  record.updatedAt = new Date().toISOString();
  if (record.failedAttempts >= maxAttempts) {
    record.status = 'failed';
  }
  writeTask(record);
}

// --- HTTP layer -------------------------------------------------------

function isAuthorized(req: IncomingMessage): boolean {
  const token = process.env.ULTRAKOD_CLI_KEY;
  if (!token) return false; // feature is disabled until a token is configured
  const header = req.headers.authorization;
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const ROUTING_MODES: RoutingMode[] = ['cheap', 'balanced', 'extra'];

function isRoutingMode(x: unknown): x is RoutingMode {
  return typeof x === 'string' && (ROUTING_MODES as string[]).includes(x);
}

function isValidSubmission(body: unknown): body is CliTaskSubmission {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.taskId !== 'string' || !isRoutingMode(b.mode) || typeof b.prompt !== 'string') {
    return false;
  }
  const context = b.context;
  return (
    typeof context === 'object' &&
    context !== null &&
    typeof (context as Record<string, unknown>).transcriptExcerpt === 'string'
  );
}

/**
 * Handles any request under /cli-tasks; returns false for anything else so
 * the caller (index.ts) can fall through to its default health-check
 * response. All /cli-tasks requests require a valid ULTRAKOD_CLI_KEY bearer
 * token — this is the only entry point that can spend real provider quota
 * on the user's behalf without going through GitHub at all.
 */
export async function handleCliTasksRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith('/cli-tasks')) return false;

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  if (req.method === 'POST' && url === '/cli-tasks') {
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return true;
    }
    if (!isValidSubmission(body)) {
      sendJson(res, 400, {
        error:
          'taskId (string), mode (cheap|balanced|extra), prompt (string), and context.transcriptExcerpt (string) are required',
      });
      return true;
    }
    try {
      const record = submitCliTask(body);
      sendJson(res, 202, { id: record.id, status: record.status });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const getMatch = /^\/cli-tasks\/([^/]+)$/.exec(url);
  if (req.method === 'GET' && getMatch) {
    const record = getCliTask(getMatch[1]);
    if (!record) {
      sendJson(res, 404, { error: 'not found' });
      return true;
    }
    sendJson(res, 200, {
      status: record.status,
      answer: record.answer,
      model: record.model,
      error: record.status === 'failed' ? record.error : undefined,
    });
    return true;
  }

  sendJson(res, 404, { error: 'not found' });
  return true;
}
