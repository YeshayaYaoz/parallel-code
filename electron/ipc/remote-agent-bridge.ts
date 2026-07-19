// Bridges local PTY-shaped IPC (SpawnAgent/WriteToAgent/ResizeAgent/KillAgent)
// to a remote cloud-backend instance (see cloud-backend/src/server-remote.ts)
// over the exact same WebSocket+REST protocol that instance already speaks —
// the same one this app's own "Connect Phone" feature speaks to, from the
// other side (electron/remote/server.ts, protocol.ts). This module is the
// only place that talks HTTP/WS to a remote backend; register.ts just
// branches into it when a task's project has a remoteBackend configured, so
// TerminalView.tsx and the rest of the renderer are unaware of the
// transport — they still call the same SpawnAgent/WriteToAgent/etc. channels.
import { WebSocket } from 'ws';
import type { BrowserWindow } from 'electron';
import { warn as logWarn } from '../log.js';

export interface RemoteBackendConfig {
  url: string;
  token: string;
  /** The remote instance's own project ID (from GET /api/mobile/projects) —
   *  cloud-backend manages exactly one project per process, so this is
   *  fetched/confirmed once when the user configures the connection, not
   *  derived from anything local. */
  projectId: string;
}

export async function listRemoteProjects(
  cfg: Pick<RemoteBackendConfig, 'url' | 'token'>,
): Promise<Array<{ id: string; name: string }>> {
  return (await remoteFetch(cfg, 'GET', '/api/mobile/projects')) as Array<{
    id: string;
    name: string;
  }>;
}

interface RemoteConnection {
  ws: WebSocket;
  ready: Promise<void>;
  /** agentId -> where to relay this connection's messages for that agent. */
  sinks: Map<string, { win: BrowserWindow; channelId: string }>;
}

const connections = new Map<string, RemoteConnection>();
/** agentId -> connection key, so write/resize/kill/pause/resume don't need
 *  the caller to pass remoteBackend again — only Spawn does. */
const agentConnectionKey = new Map<string, string>();

function connectionKey(cfg: RemoteBackendConfig): string {
  return `${cfg.url}|${cfg.token}`;
}

function toWebSocketUrl(httpUrl: string): string {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.search = '';
  return u.toString();
}

function sendToChannel(win: BrowserWindow, channelId: string, msg: unknown): void {
  if (!win.isDestroyed()) {
    win.webContents.send(`channel:${channelId}`, msg);
  }
}

function getOrCreateConnection(cfg: RemoteBackendConfig): RemoteConnection {
  const key = connectionKey(cfg);
  const existing = connections.get(key);
  if (existing) return existing;

  const ws = new WebSocket(toWebSocketUrl(cfg.url));
  const sinks = new Map<string, { win: BrowserWindow; channelId: string }>();

  const ready = new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: cfg.token }));
    });
    // The server's first message after a successful auth is an `agents` list
    // (see server-remote.ts's wss.on('connection', ...) handler) — treat
    // that as the auth ack, same as src/remote/ws.ts already does.
    ws.once('message', () => resolve());
    ws.once('error', reject);
    ws.once('close', (code) => reject(new Error(`Remote backend closed connection (${code})`)));
  });

  ws.on('message', (raw) => {
    type IncomingMessage = { type: string; agentId?: string; data?: string; status?: string };
    let msg: IncomingMessage | null;
    try {
      msg = JSON.parse(String(raw)) as IncomingMessage;
    } catch {
      return;
    }
    if (!msg || !msg.agentId) return;
    const sink = sinks.get(msg.agentId);
    if (!sink) return;

    if (msg.type === 'output' || msg.type === 'scrollback') {
      sendToChannel(sink.win, sink.channelId, { type: 'Data', data: msg.data });
    } else if (msg.type === 'status' && msg.status === 'exited') {
      sendToChannel(sink.win, sink.channelId, {
        type: 'Exit',
        data: { exit_code: null, signal: null, last_output: [] },
      });
    }
  });

  ws.on('close', () => {
    for (const [agentId, sink] of sinks) {
      sendToChannel(sink.win, sink.channelId, {
        type: 'Exit',
        data: { exit_code: null, signal: null, last_output: [] },
      });
      agentConnectionKey.delete(agentId);
    }
    sinks.clear();
    connections.delete(key);
  });

  ws.on('error', (err) => {
    logWarn('remote-agent-bridge', `WebSocket error for ${cfg.url}: ${String(err)}`);
  });

  const connection: RemoteConnection = { ws, ready, sinks };
  connections.set(key, connection);
  return connection;
}

/** True if this agentId is backed by a remote connection, not the local PTY map. */
export function isRemoteAgent(agentId: string): boolean {
  return agentConnectionKey.has(agentId);
}

/** Subscribe to a remote agent's output, relaying it to the same `channel:<id>`
 *  the renderer already listens on for local agents. Idempotent per agentId. */
export async function subscribeRemoteAgent(
  win: BrowserWindow,
  cfg: RemoteBackendConfig,
  agentId: string,
  channelId: string,
): Promise<void> {
  const connection = getOrCreateConnection(cfg);
  agentConnectionKey.set(agentId, connectionKey(cfg));
  connection.sinks.set(agentId, { win, channelId });
  await connection.ready;
  connection.ws.send(JSON.stringify({ type: 'subscribe', agentId }));
}

function sendForAgent(agentId: string, msg: unknown): void {
  for (const conn of connections.values()) {
    if (conn.sinks.has(agentId)) {
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
      return;
    }
  }
  throw new Error(`No open remote connection for agent: ${agentId}`);
}

export function writeToRemoteAgent(agentId: string, data: string): void {
  sendForAgent(agentId, { type: 'input', agentId, data });
}

export function resizeRemoteAgent(agentId: string, cols: number, rows: number): void {
  sendForAgent(agentId, { type: 'resize', agentId, cols, rows });
}

export function killRemoteAgent(agentId: string): void {
  sendForAgent(agentId, { type: 'kill', agentId });
  for (const conn of connections.values()) {
    conn.sinks.delete(agentId);
  }
  agentConnectionKey.delete(agentId);
}

async function remoteFetch(
  cfg: Pick<RemoteBackendConfig, 'url' | 'token'>,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(new URL(path, cfg.url), {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new Error(
      typeof json.error === 'string' ? json.error : `Remote backend returned ${res.status}`,
    );
  }
  return json;
}

export async function createRemoteTask(
  cfg: RemoteBackendConfig,
  req: {
    projectId: string;
    name: string;
    prompt: string;
    agentCommand?: string;
    agentArgs?: string[];
  },
): Promise<{ taskId: string; agentId: string }> {
  return (await remoteFetch(cfg, 'POST', '/api/mobile/tasks', req)) as {
    taskId: string;
    agentId: string;
  };
}

export async function deleteRemoteTask(cfg: RemoteBackendConfig, taskId: string): Promise<void> {
  await remoteFetch(cfg, 'DELETE', `/api/mobile/tasks/${encodeURIComponent(taskId)}`);
}
