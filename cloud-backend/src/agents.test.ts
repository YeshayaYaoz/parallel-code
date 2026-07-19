import { describe, expect, it, vi, beforeEach } from 'vitest';
import { promisify } from 'util';
import { getSkipPermissionsArgs } from './agents.js';

describe('getSkipPermissionsArgs', () => {
  it('returns a copy of default skip-permission args', () => {
    const first = getSkipPermissionsArgs('claude');
    first.push('--mutated');

    expect(getSkipPermissionsArgs('claude')).toEqual(['--dangerously-skip-permissions']);
  });
});

const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => {
  const execFile = (...callArgs: unknown[]) =>
    (mockExecFile as (...a: unknown[]) => unknown)(...callArgs);
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = (
    file: unknown,
    fileArgs: unknown,
    opts: unknown,
  ): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      mockExecFile(file, fileArgs, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  return { execFile };
});

describe('listAgents', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecFile.mockReset();
  });

  it('marks ultrakod available when at least one of its CLI candidates is installed', async () => {
    mockExecFile.mockImplementation(
      (_file: unknown, args: unknown, _opts: unknown, cb: (...a: unknown[]) => void) => {
        const command = (args as string[])[0];
        if (command === 'claude') cb(null, '/usr/bin/claude', '');
        else cb(new Error('not found'), '', '');
      },
    );

    const { listAgents } = await import('./agents.js');
    const agents = await listAgents();
    expect(agents.find((a) => a.id === 'ultrakod')?.available).toBe(true);
  });

  it('marks ultrakod unavailable when none of its CLI candidates are installed', async () => {
    mockExecFile.mockImplementation(
      (_file: unknown, _args: unknown, _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(new Error('not found'), '', '');
      },
    );

    const { listAgents } = await import('./agents.js');
    const agents = await listAgents();
    expect(agents.find((a) => a.id === 'ultrakod')?.available).toBe(false);
  });

  it('never checks PATH for a literal `ultrakod` binary', async () => {
    mockExecFile.mockImplementation(
      (_file: unknown, _args: unknown, _opts: unknown, cb: (...a: unknown[]) => void) => {
        cb(new Error('not found'), '', '');
      },
    );

    const { listAgents } = await import('./agents.js');
    await listAgents();

    const checkedCommands = mockExecFile.mock.calls.map((call) => (call[1] as string[])[0]);
    expect(checkedCommands).not.toContain('ultrakod');
  });
});
