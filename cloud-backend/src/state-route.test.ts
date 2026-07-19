// REST access control + round-trip for the /api/state route (Phase 3:
// multi-device state sync) — full project/task state, so it's gated to the
// coordinator token only; mobile/paired/subtask tokens must be rejected.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('./pty.js', () => ({
  writeToAgent: vi.fn(),
  resizeAgent: vi.fn(),
  killAgent: vi.fn(),
  subscribeToAgent: vi.fn(),
  unsubscribeFromAgent: vi.fn(),
  getAgentScrollback: vi.fn(() => null),
  getActiveAgentIds: vi.fn(() => []),
  getAgentMeta: vi.fn(() => null),
  getAgentCols: vi.fn(() => 80),
  onPtyEvent: vi.fn(() => vi.fn()),
}));

const { startRemoteServer } = await import('./server-remote.js');

let dataDir: string;
let originalDataDir: string | undefined;
let port = 0;
let coordinatorToken = '';
let mobileToken = '';
let stop: () => Promise<void>;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'cloud-backend-state-route-test-'));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;

  const srv = await startRemoteServer({
    port: 0,
    host: '127.0.0.1',
    staticDir: '/nonexistent',
    getTaskName: (id) => id,
    getAgentStatus: () => ({ status: 'exited', exitCode: null, lastLine: '' }),
    getCoordinator: () => null,
  });
  port = srv.port;
  coordinatorToken = srv.token;
  mobileToken = srv.mobileToken;
  stop = srv.stop;
});

afterEach(async () => {
  await stop();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

function request(
  method: string,
  token: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  return fetch(`http://127.0.0.1:${port}/api/state`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body,
  }).then(async (res) => ({ status: res.status, body: await res.text() }));
}

describe('/api/state', () => {
  it('GET returns 404 when nothing has been saved yet', async () => {
    const res = await request('GET', coordinatorToken);
    expect(res.status).toBe(404);
  });

  it('round-trips state via PUT then GET with a coordinator token', async () => {
    const state = JSON.stringify({ projects: [{ id: 'p1' }] });
    const putRes = await request('PUT', coordinatorToken, state);
    expect(putRes.status).toBe(200);

    const getRes = await request('GET', coordinatorToken);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toBe(state);
  });

  it('rejects PUT with invalid JSON', async () => {
    const res = await request('PUT', coordinatorToken, 'not json');
    expect(res.status).toBe(400);
  });

  it('rejects mobile tokens', async () => {
    const res = await request('GET', mobileToken);
    expect(res.status).toBe(403);
  });

  it('rejects requests with no token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(res.status).toBe(401);
  });

  it('rejects unsupported methods', async () => {
    const res = await request('DELETE', coordinatorToken);
    expect(res.status).toBe(405);
  });
});
