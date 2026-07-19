// Real (unmocked) tests for the remote-backend bridge: a fake WebSocket
// server plays the role of a cloud-backend instance's server-remote.ts, and
// a fake HTTP server plays its REST API, so these exercise the actual wire
// protocol rather than a mocked transport. Doesn't need Electron's real
// runtime — BrowserWindow is only ever used as a type here (a plain object
// satisfying its narrow used surface, `isDestroyed`/`webContents.send`,
// stands in for it, same pattern electron/ipc/pty.test.ts already uses).
import { createServer, type Server as HttpServer } from 'http';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isRemoteAgent,
  subscribeRemoteAgent,
  writeToRemoteAgent,
  resizeRemoteAgent,
  killRemoteAgent,
  createRemoteTask,
  deleteRemoteTask,
  listRemoteProjects,
  type RemoteBackendConfig,
} from './remote-agent-bridge.js';

function makeMockWin(): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow;
}

async function startFakeWsServer(): Promise<{
  port: number;
  wss: WebSocketServer;
  sockets: WsSocket[];
  close: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ port: 0 });
  const sockets: WsSocket[] = [];
  wss.on('connection', (ws) => {
    sockets.push(ws);
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { type: string };
      if (msg.type === 'auth') {
        ws.send(JSON.stringify({ type: 'agents', list: [] }));
      }
    });
  });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const address = wss.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    wss,
    sockets,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.close();
        wss.close(() => resolve());
      }),
  };
}

let httpServers: HttpServer[] = [];
let wsServers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  for (const s of httpServers) await new Promise((r) => s.close(r));
  for (const s of wsServers) await s.close();
  httpServers = [];
  wsServers = [];
});

describe('subscribeRemoteAgent / isRemoteAgent / write/resize/kill', () => {
  it('authenticates, subscribes, and relays output as a local-shaped Data message', async () => {
    const fake = await startFakeWsServer();
    wsServers.push(fake);
    const cfg: RemoteBackendConfig = {
      url: `http://127.0.0.1:${fake.port}`,
      token: 'tok',
      projectId: 'default',
    };
    const win = makeMockWin();
    const agentId = 'agent-1';

    fake.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string; agentId?: string };
        if (msg.type === 'subscribe' && msg.agentId === agentId) {
          ws.send(JSON.stringify({ type: 'output', agentId, data: 'aGVsbG8=' }));
        }
      });
    });

    expect(isRemoteAgent(agentId)).toBe(false);
    await subscribeRemoteAgent(win, cfg, agentId, 'chan-1');
    expect(isRemoteAgent(agentId)).toBe(true);

    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalledWith('channel:chan-1', {
        type: 'Data',
        data: 'aGVsbG8=',
      });
    });
  });

  it('relays a status:exited message as a local-shaped Exit message', async () => {
    const fake = await startFakeWsServer();
    wsServers.push(fake);
    const cfg: RemoteBackendConfig = {
      url: `http://127.0.0.1:${fake.port}`,
      token: 'tok',
      projectId: 'default',
    };
    const win = makeMockWin();
    const agentId = 'agent-exit';

    fake.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string; agentId?: string };
        if (msg.type === 'subscribe' && msg.agentId === agentId) {
          ws.send(JSON.stringify({ type: 'status', agentId, status: 'exited', exitCode: 0 }));
        }
      });
    });

    await subscribeRemoteAgent(win, cfg, agentId, 'chan-exit');

    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalledWith('channel:chan-exit', {
        type: 'Exit',
        data: { exit_code: null, signal: null, last_output: [] },
      });
    });
  });

  it('writeToRemoteAgent/resizeRemoteAgent/killRemoteAgent send the expected wire messages', async () => {
    const fake = await startFakeWsServer();
    wsServers.push(fake);
    const cfg: RemoteBackendConfig = {
      url: `http://127.0.0.1:${fake.port}`,
      token: 'tok',
      projectId: 'default',
    };
    const win = makeMockWin();
    const agentId = 'agent-io';
    const received: unknown[] = [];

    fake.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string };
        if (msg.type !== 'auth' && msg.type !== 'subscribe') received.push(msg);
      });
    });

    await subscribeRemoteAgent(win, cfg, agentId, 'chan-io');
    writeToRemoteAgent(agentId, 'echo hi\n');
    resizeRemoteAgent(agentId, 80, 24);
    killRemoteAgent(agentId);

    await vi.waitFor(() => {
      expect(received).toContainEqual({ type: 'input', agentId, data: 'echo hi\n' });
      expect(received).toContainEqual({ type: 'resize', agentId, cols: 80, rows: 24 });
      expect(received).toContainEqual({ type: 'kill', agentId });
    });
    expect(isRemoteAgent(agentId)).toBe(false);
  });

  it('throws when writing to an agentId that was never subscribed', () => {
    expect(() => writeToRemoteAgent('never-subscribed', 'x')).toThrow(/No open remote connection/);
  });
});

describe('createRemoteTask / deleteRemoteTask / listRemoteProjects', () => {
  function startFakeHttpServer(
    handler: (
      req: { method?: string; url?: string },
      body: string,
    ) => { status: number; body: unknown },
  ): Promise<{ port: number; cfg: Pick<RemoteBackendConfig, 'url' | 'token'> }> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const { status, body } = handler(req, Buffer.concat(chunks).toString('utf8'));
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        });
      });
      httpServers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        resolve({ port, cfg: { url: `http://127.0.0.1:${port}`, token: 'tok' } });
      });
    });
  }

  it('createRemoteTask posts to /api/mobile/tasks and returns taskId + agentId', async () => {
    const { cfg } = await startFakeHttpServer((req, body) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/mobile/tasks');
      expect(JSON.parse(body)).toEqual({ projectId: 'default', name: 'fix-bug', prompt: '' });
      return { status: 201, body: { taskId: 'task-1', agentId: 'agent-1' } };
    });

    const result = await createRemoteTask(
      { ...cfg, projectId: 'default' },
      { projectId: 'default', name: 'fix-bug', prompt: '' },
    );
    expect(result).toEqual({ taskId: 'task-1', agentId: 'agent-1' });
  });

  it('deleteRemoteTask issues a DELETE to the right path', async () => {
    const { cfg } = await startFakeHttpServer((req) => {
      expect(req.method).toBe('DELETE');
      expect(req.url).toBe('/api/mobile/tasks/task-1');
      return { status: 200, body: { ok: true } };
    });

    await expect(
      deleteRemoteTask({ ...cfg, projectId: 'default' }, 'task-1'),
    ).resolves.toBeUndefined();
  });

  it('listRemoteProjects GETs /api/mobile/projects', async () => {
    const { cfg } = await startFakeHttpServer((req) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe('/api/mobile/projects');
      return { status: 200, body: [{ id: 'default', name: 'my-repo' }] };
    });

    const projects = await listRemoteProjects(cfg);
    expect(projects).toEqual([{ id: 'default', name: 'my-repo' }]);
  });

  it('rejects with the server-provided error message on a non-2xx response', async () => {
    const { cfg } = await startFakeHttpServer(() => ({
      status: 403,
      body: { error: 'forbidden' },
    }));

    await expect(listRemoteProjects(cfg)).rejects.toThrow('forbidden');
  });
});
