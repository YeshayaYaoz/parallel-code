// PTY spawning, extracted from electron/ipc/pty.ts. Deliberately narrower
// than the original: this service always runs on Linux inside its own
// container (the container IS the isolation boundary), so Docker-in-Docker
// spawning and Windows command-path resolution — both dead weight here —
// are dropped entirely. The subscriber/scrollback mechanism kept below is
// not new: it's the exact same pattern electron/remote/server.ts already
// uses to relay PTY output to phone/remote clients instead of a
// BrowserWindow, which is why it ports over unchanged as this service's
// only output path.
import * as pty from 'node-pty';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { RingBuffer } from './ring-buffer.js';
import { resolveUserShell } from './user-shell.js';
import { ensureClaudeSandboxFiles, ensureSandboxExcludes } from './git.js';
import { debug as logDebug } from './log.js';

interface PtySession {
  proc: pty.IPty;
  taskId: string;
  agentId: string;
  isShell: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  subscribers: Set<(encoded: string) => void>;
  scrollback: RingBuffer;
}

const sessions = new Map<string, PtySession>();

type PtyEventType = 'spawn' | 'exit' | 'list-changed';
type PtyEventListener = (agentId: string, data?: unknown) => void;
const eventListeners = new Map<PtyEventType, Set<PtyEventListener>>();

/** Register a listener for PTY lifecycle events. Returns an unsubscribe function. */
export function onPtyEvent(event: PtyEventType, listener: PtyEventListener): () => void {
  let listeners = eventListeners.get(event);
  if (!listeners) {
    listeners = new Set();
    eventListeners.set(event, listeners);
  }
  listeners.add(listener);
  return () => {
    eventListeners.get(event)?.delete(listener);
  };
}

function emitPtyEvent(event: PtyEventType, agentId: string, data?: unknown): void {
  if (event === 'spawn' || event === 'exit') {
    logDebug('pty', `${event} ${agentId}`, data ? { data } : undefined);
  }
  eventListeners.get(event)?.forEach((fn) => fn(agentId, data));
}

const BATCH_MAX = 64 * 1024;
const BATCH_INTERVAL = 8; // ms
const TAIL_CAP = 8 * 1024;
const MAX_LINES = 50;
const ENV_BLOCK_LIST = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'NODE_OPTIONS',
]);

export interface SpawnAgentArgs {
  taskId: string;
  agentId: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  isShell?: boolean;
}

/** Verify that a command exists in PATH. Throws a descriptive error if not found. */
export function validateCommand(command: string): void {
  if (!command || !command.trim()) {
    throw new Error('Command must not be empty.');
  }
  if (path.isAbsolute(command)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return;
    } catch {
      throw new Error(
        `Command '${command}' not found or not executable. Check that it is installed.`,
      );
    }
  }
  try {
    execFileSync('which', [command], { encoding: 'utf8', timeout: 3000 });
  } catch {
    throw new Error(
      `Command '${command}' not found in PATH. Make sure it is installed and available in your terminal.`,
    );
  }
}

function copyProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export function buildPtySpawnEnv(rendererEnv: Record<string, string> = {}): Record<string, string> {
  const spawnEnv: Record<string, string> = {
    ...copyProcessEnv(),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };

  for (const [key, value] of Object.entries(rendererEnv)) {
    if (!ENV_BLOCK_LIST.has(key)) spawnEnv[key] = value;
  }

  return spawnEnv;
}

function cleanupExistingSession(agentId: string, existing: PtySession | undefined): void {
  if (!existing) return;
  if (existing.flushTimer) clearTimeout(existing.flushTimer);
  existing.subscribers.clear();
  existing.proc.kill();
  sessions.delete(agentId);
}

function attachPtyOutputHandlers(session: PtySession, agentId: string): void {
  let batchChunks: Buffer[] = [];
  let batchSize = 0;
  let tailChunks: Buffer[] = [];
  let tailSize = 0;

  const flush = () => {
    if (batchSize === 0) return;
    const batch = Buffer.concat(batchChunks);
    const encoded = batch.toString('base64');
    session.scrollback.write(batch);
    for (const sub of session.subscribers) {
      sub(encoded);
    }
    batchChunks = [];
    batchSize = 0;
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
  };

  session.proc.onData((data: string) => {
    const chunk = Buffer.from(data, 'utf8');

    tailChunks.push(chunk);
    tailSize += chunk.length;
    if (tailSize > TAIL_CAP) {
      const combined = Buffer.concat(tailChunks);
      const trimmed = combined.subarray(combined.length - TAIL_CAP);
      tailChunks = [trimmed];
      tailSize = trimmed.length;
    }

    batchChunks.push(chunk);
    batchSize += chunk.length;

    if (batchSize >= BATCH_MAX || chunk.length < 1024) {
      flush();
      return;
    }

    if (!session.flushTimer) {
      session.flushTimer = setTimeout(flush, BATCH_INTERVAL);
    }
  });

  session.proc.onExit(({ exitCode, signal }) => {
    if (sessions.get(agentId) !== session) return;

    flush();

    const tailBuf = Buffer.concat(tailChunks);
    const tailStr = tailBuf.toString('utf8');
    const lines = tailStr
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.length > 0)
      .slice(-MAX_LINES);

    emitPtyEvent('exit', agentId, {
      exitCode,
      signal: signal !== undefined ? String(signal) : null,
      lastOutput: lines,
    });
    sessions.delete(agentId);
  });
}

export function spawnAgent(args: SpawnAgentArgs): void {
  const command = args.command || resolveUserShell();
  const cwd = args.cwd || process.env.HOME || '/';

  // Reject commands with shell metacharacters (node-pty uses execvp, but
  // guard against accidental misuse). Allow bare names (resolved via PATH)
  // and absolute paths.
  if (/[;&|`$(){}\n%^]/.test(command)) {
    throw new Error(`Command contains disallowed characters: ${command}`);
  }

  validateCommand(command);
  cleanupExistingSession(args.agentId, sessions.get(args.agentId));

  const spawnEnv = buildPtySpawnEnv(args.env);

  // Backfill sandbox placeholders for pre-existing worktrees.
  if (fs.existsSync(cwd)) {
    ensureClaudeSandboxFiles(cwd);
    ensureSandboxExcludes(cwd);
  }

  logDebug('pty', `spawn command ${args.agentId}`, { taskId: args.taskId, command, cwd });

  const proc = pty.spawn(command, args.args, {
    name: 'xterm-256color',
    cols: args.cols,
    rows: args.rows,
    cwd,
    env: spawnEnv,
  });

  const session: PtySession = {
    proc,
    taskId: args.taskId,
    agentId: args.agentId,
    isShell: args.isShell ?? false,
    flushTimer: null,
    subscribers: new Set(),
    scrollback: new RingBuffer(),
  };
  sessions.set(args.agentId, session);
  attachPtyOutputHandlers(session, args.agentId);

  emitPtyEvent('spawn', args.agentId);
}

export function writeToAgent(agentId: string, data: string): void {
  const session = sessions.get(agentId);
  if (!session) throw new Error(`Agent not found: ${agentId}`);
  session.proc.write(data);
}

export function resizeAgent(agentId: string, cols: number, rows: number): void {
  const session = sessions.get(agentId);
  if (!session) throw new Error(`Agent not found: ${agentId}`);
  session.proc.resize(cols, rows);
}

export function killAgent(agentId: string): void {
  const session = sessions.get(agentId);
  if (session) {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    // Clear subscribers before kill so the onExit flush doesn't notify stale
    // listeners. onExit itself handles sessions.delete + emitPtyEvent.
    session.subscribers.clear();
    session.proc.kill();
  }
}

export function countRunningAgents(): number {
  return sessions.size;
}

export function killAllAgents(): void {
  for (const [, session] of sessions) {
    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.subscribers.clear();
    session.proc.kill();
  }
  // onExit handlers clean up sessions individually.
}

/** Subscribe to live base64-encoded output from an agent. */
export function subscribeToAgent(agentId: string, cb: (encoded: string) => void): boolean {
  const session = sessions.get(agentId);
  if (!session) return false;
  session.subscribers.add(cb);
  return true;
}

/** Remove a previously registered output subscriber. */
export function unsubscribeFromAgent(agentId: string, cb: (encoded: string) => void): void {
  sessions.get(agentId)?.subscribers.delete(cb);
}

/** Get the scrollback buffer for an agent as a base64 string. */
export function getAgentScrollback(agentId: string): string | null {
  return sessions.get(agentId)?.scrollback.toBase64() ?? null;
}

/** Return all active agent IDs. */
export function getActiveAgentIds(): string[] {
  return Array.from(sessions.keys());
}

/** Return metadata for a specific agent, or null if not found. */
export function getAgentMeta(
  agentId: string,
): { taskId: string; agentId: string; isShell: boolean } | null {
  const s = sessions.get(agentId);
  return s ? { taskId: s.taskId, agentId: s.agentId, isShell: s.isShell } : null;
}

/** Return the current column width of an agent's PTY. */
export function getAgentCols(agentId: string): number {
  const s = sessions.get(agentId);
  return s ? s.proc.cols : 80;
}
