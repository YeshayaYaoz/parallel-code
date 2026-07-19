import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  spawnAgent,
  writeToAgent,
  killAgent,
  getActiveAgentIds,
  getAgentScrollback,
  subscribeToAgent,
  onPtyEvent,
  countRunningAgents,
} from './pty.js';

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(check, 20);
    };
    check();
  });
}

afterEach(() => {
  for (const id of getActiveAgentIds()) killAgent(id);
});

describe('spawnAgent / writeToAgent / killAgent', () => {
  it('spawns a real shell process and streams its output to subscribers', async () => {
    const agentId = 'test-agent-1';
    const chunks: string[] = [];

    spawnAgent({
      taskId: 'task-1',
      agentId,
      command: '/bin/sh',
      args: ['-c', 'echo hello-from-pty'],
      cwd: process.cwd(),
      env: {},
      cols: 80,
      rows: 24,
    });

    subscribeToAgent(agentId, (encoded) => {
      chunks.push(Buffer.from(encoded, 'base64').toString('utf8'));
    });

    await waitFor(() => chunks.join('').includes('hello-from-pty'));
    expect(chunks.join('')).toContain('hello-from-pty');
  });

  it('writes input into an interactive shell and gets the echoed output back', async () => {
    const agentId = 'test-agent-2';
    let output = '';

    spawnAgent({
      taskId: 'task-1',
      agentId,
      command: '/bin/sh',
      args: [],
      cwd: process.cwd(),
      env: {},
      cols: 80,
      rows: 24,
    });
    subscribeToAgent(agentId, (encoded) => {
      output += Buffer.from(encoded, 'base64').toString('utf8');
    });

    writeToAgent(agentId, 'echo written-input-marker\n');
    await waitFor(() => output.includes('written-input-marker'));
    expect(output).toContain('written-input-marker');
  });

  it('emits a spawn event and tracks the agent as running', () => {
    const agentId = 'test-agent-3';
    const spawnListener = vi.fn();
    const unsubscribe = onPtyEvent('spawn', spawnListener);

    spawnAgent({
      taskId: 'task-1',
      agentId,
      command: '/bin/sh',
      args: ['-c', 'sleep 5'],
      cwd: process.cwd(),
      env: {},
      cols: 80,
      rows: 24,
    });

    expect(spawnListener).toHaveBeenCalledWith(agentId, undefined);
    expect(getActiveAgentIds()).toContain(agentId);
    expect(countRunningAgents()).toBeGreaterThan(0);
    unsubscribe();
  });

  it('emits an exit event with the process tail when the command finishes', async () => {
    const agentId = 'test-agent-4';
    let exitData: unknown;
    const unsubscribe = onPtyEvent('exit', (id, data) => {
      if (id === agentId) exitData = data;
    });

    spawnAgent({
      taskId: 'task-1',
      agentId,
      command: '/bin/sh',
      args: ['-c', 'echo done-marker; exit 0'],
      cwd: process.cwd(),
      env: {},
      cols: 80,
      rows: 24,
    });

    await waitFor(() => exitData !== undefined);
    expect(exitData).toMatchObject({ exitCode: 0 });
    expect((exitData as { lastOutput: string[] }).lastOutput.join('\n')).toContain('done-marker');
    unsubscribe();
  });

  it('preserves scrollback for a subscriber that joins after output was already flushed', async () => {
    const agentId = 'test-agent-5';

    spawnAgent({
      taskId: 'task-1',
      agentId,
      command: '/bin/sh',
      args: ['-c', 'echo scrollback-marker; sleep 5'],
      cwd: process.cwd(),
      env: {},
      cols: 80,
      rows: 24,
    });

    await waitFor(() => (getAgentScrollback(agentId) ?? '').length > 0);
    const scrollback = Buffer.from(getAgentScrollback(agentId) ?? '', 'base64').toString('utf8');
    expect(scrollback).toContain('scrollback-marker');
  });

  it('rejects a command with shell metacharacters before spawning anything', () => {
    expect(() =>
      spawnAgent({
        taskId: 'task-1',
        agentId: 'test-agent-6',
        command: 'echo hi; rm -rf /',
        args: [],
        cwd: process.cwd(),
        env: {},
        cols: 80,
        rows: 24,
      }),
    ).toThrow(/disallowed characters/);
  });
});
