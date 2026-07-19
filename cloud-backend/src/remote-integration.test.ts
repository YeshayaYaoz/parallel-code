// Real (unmocked) end-to-end smoke test for the standalone service: boots a
// real startRemoteServer instance, spawns a real PTY-backed shell agent via
// pty.ts, connects a real `ws` WebSocket client using the same wire protocol
// the existing remote client (src/remote/ws.ts, bundled into the Electron
// app's mobile SPA) already speaks — and confirms bytes round-trip. This is
// the "single non-coordinator task" verification from the cloud-migration
// plan: no Coordinator/MCP subtask involved, just a bare agent + the remote
// protocol server, run as a plain Node process.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { startRemoteServer } from './server-remote.js';
import { spawnAgent, killAgent, getAgentMeta } from './pty.js';
import { resolveUserShell } from './user-shell.js';

type AnyServer = Awaited<ReturnType<typeof startRemoteServer>>;

let server: AnyServer | undefined;
let ws: WebSocket | undefined;
let agentId: string | undefined;

afterEach(async () => {
  ws?.close();
  ws = undefined;
  if (agentId) {
    try {
      killAgent(agentId);
    } catch {
      /* already dead */
    }
    agentId = undefined;
  }
  await server?.stop();
  server = undefined;
});

function waitForOpen(sock: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    sock.once('open', () => resolve());
    sock.once('error', reject);
  });
}

function waitForMessage(
  sock: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (predicate(msg)) {
        clearTimeout(timer);
        sock.off('message', onMessage);
        resolve(msg);
      }
    };
    sock.on('message', onMessage);
  });
}

describe('standalone service — real remote-protocol round trip', () => {
  it('spawns a real PTY agent and streams its output to a WebSocket client', async () => {
    agentId = randomUUID();
    const taskId = randomUUID();

    spawnAgent({
      taskId,
      agentId,
      command: resolveUserShell(),
      args: [],
      cwd: process.env.HOME ?? '/tmp',
      env: {},
      cols: 80,
      rows: 24,
      isShell: true,
    });

    server = await startRemoteServer({
      port: 0,
      host: '127.0.0.1',
      staticDir: '/nonexistent-static-dir',
      getTaskName: () => 'smoke-test-task',
      getAgentStatus: (id) => ({
        status: getAgentMeta(id) ? 'running' : 'exited',
        exitCode: null,
        lastLine: '',
      }),
      getCoordinator: () => null,
    });

    ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ type: 'subscribe', agentId }));
    ws.send(JSON.stringify({ type: 'input', agentId, data: 'echo hello-cloud-backend\n' }));

    const output = await waitForMessage(
      ws,
      (msg) =>
        msg.type === 'output' &&
        msg.agentId === agentId &&
        Buffer.from(msg.data as string, 'base64')
          .toString('utf8')
          .includes('hello-cloud-backend'),
    );

    expect(output.type).toBe('output');
  }, 15000);
});
