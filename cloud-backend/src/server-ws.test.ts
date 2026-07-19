// WebSocket-level access control for the remote server.
// Mobile clients may type into agent terminals (input) but must not be able
// to resize the PTY or kill agents.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';

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
  onPtyEvent: vi.fn(() => vi.fn()), // returns an unsubscribe fn
}));

const pty = await import('./pty.js');
const { startRemoteServer } = await import('./server-remote.js');

let port = 0;
let coordinatorToken = '';
let mobileToken = '';
let stop: () => Promise<void>;

beforeEach(async () => {
  const srv = await startRemoteServer({
    port: 0,
    host: '0.0.0.0',
    staticDir: '/nonexistent',
    getTaskName: (id) => id,
    getAgentStatus: () => ({ status: 'exited', exitCode: null, lastLine: '' }),
    getCoordinator: () => null,
  });
  port = srv.port;
  coordinatorToken = srv.token;
  mobileToken = srv.mobileToken;
  stop = srv.stop;
  vi.clearAllMocks();
});

afterEach(async () => {
  await stop();
});

/** Connect and authenticate; resolves once the server replies (agents list). */
function connectAndAuth(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.once('message', () => resolve(ws));
    ws.on('close', (code) => reject(new Error(`closed before auth ack: ${code}`)));
    ws.on('error', reject);
  });
}

function waitForClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    // Drop connectAndAuth's rejecting close/error listeners — from here on
    // a close is the expected outcome, not a failure. Keep a no-op error
    // listener: an 'error' with no listener throws on EventEmitters.
    ws.removeAllListeners('close');
    ws.removeAllListeners('error');
    ws.on('error', () => {});
    ws.on('close', (code) => resolve(code));
  });
}

describe('mobile token over WebSocket', () => {
  it('forwards input to the agent PTY', async () => {
    const ws = await connectAndAuth(mobileToken);
    ws.send(JSON.stringify({ type: 'input', agentId: 'agent-1', data: 'hi' }));
    await vi.waitFor(() => {
      expect(pty.writeToAgent).toHaveBeenCalledWith('agent-1', 'hi');
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('silently drops oversized input (>4096 chars) without closing', async () => {
    const ws = await connectAndAuth(mobileToken);
    ws.send(JSON.stringify({ type: 'input', agentId: 'agent-1', data: 'x'.repeat(4097) }));
    // Probe with a valid message to ensure the oversized one was processed first
    ws.send(JSON.stringify({ type: 'input', agentId: 'agent-1', data: 'ok' }));
    await vi.waitFor(() => {
      expect(pty.writeToAgent).toHaveBeenCalledWith('agent-1', 'ok');
    });
    expect(pty.writeToAgent).not.toHaveBeenCalledWith('agent-1', 'x'.repeat(4097));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('rejects resize with 4003 and does not resize the PTY', async () => {
    const ws = await connectAndAuth(mobileToken);
    const closed = waitForClose(ws);
    ws.send(JSON.stringify({ type: 'resize', agentId: 'agent-1', cols: 80, rows: 24 }));
    expect(await closed).toBe(4003);
    expect(pty.resizeAgent).not.toHaveBeenCalled();
  });

  it('rejects kill with 4003 and does not kill the agent', async () => {
    const ws = await connectAndAuth(mobileToken);
    const closed = waitForClose(ws);
    ws.send(JSON.stringify({ type: 'kill', agentId: 'agent-1' }));
    expect(await closed).toBe(4003);
    expect(pty.killAgent).not.toHaveBeenCalled();
  });
});

describe('unauthenticated WebSocket clients', () => {
  function connectRaw(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  it('closes 4001 when input is sent before auth, without reaching the PTY', async () => {
    const ws = await connectRaw();
    const closed = waitForClose(ws);
    ws.send(JSON.stringify({ type: 'input', agentId: 'agent-1', data: 'hi' }));
    expect(await closed).toBe(4001);
    expect(pty.writeToAgent).not.toHaveBeenCalled();
  });

  it('closes 4001 on auth with an unknown token', async () => {
    const ws = await connectRaw();
    const closed = waitForClose(ws);
    ws.send(JSON.stringify({ type: 'auth', token: 'not-a-real-token' }));
    expect(await closed).toBe(4001);
  });
});

describe('coordinator token over WebSocket', () => {
  it('forwards input to the agent PTY', async () => {
    const ws = await connectAndAuth(coordinatorToken);
    ws.send(JSON.stringify({ type: 'input', agentId: 'agent-1', data: 'hello' }));
    await vi.waitFor(() => {
      expect(pty.writeToAgent).toHaveBeenCalledWith('agent-1', 'hello');
    });
    ws.close();
  });
});
