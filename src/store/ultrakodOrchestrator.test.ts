import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { expectDefined, type MockStoreHarness } from './test-helpers';
import { getModelForMode, type Provider, type RoutingMode } from '../../electron/ultrakod/registry';
import { markCoolingDown, clearCooldown } from './ultrakodCooldowns';

interface AgentDefLike {
  id: string;
  name: string;
  command: string;
  args: string[];
  resume_args: string[];
  skip_permissions_args: string[];
  description: string;
  available?: boolean;
}

interface AgentLike {
  id: string;
  taskId: string;
  def: AgentDefLike;
  status: 'running' | 'exited';
}

interface TaskLike {
  id: string;
  agentIds: string[];
  selectedAgentId?: string;
  ultrakodMode?: boolean;
  ultrakodRoutingMode?: RoutingMode;
  lastPrompt: string;
}

interface MockStore {
  tasks: Record<string, TaskLike>;
  agents: Record<string, AgentLike>;
  availableAgents: AgentDefLike[];
  taskOrder: string[];
}

let mockTasks: Record<string, TaskLike> = {};
let mockAgents: Record<string, AgentLike> = {};
let mockAvailableAgents: AgentDefLike[] = [];
let mockTaskOrder: string[] = [];

const core = vi.hoisted(() => ({
  harness: undefined as MockStoreHarness<MockStore> | undefined,
}));

vi.mock('./core', async () => {
  const { createMockStoreHarness } = await import('./test-helpers');
  core.harness = createMockStoreHarness<MockStore>({
    get tasks() {
      return mockTasks;
    },
    set tasks(next) {
      mockTasks = next;
    },
    get agents() {
      return mockAgents;
    },
    set agents(next) {
      mockAgents = next;
    },
    get availableAgents() {
      return mockAvailableAgents;
    },
    set availableAgents(next) {
      mockAvailableAgents = next;
    },
    get taskOrder() {
      return mockTaskOrder;
    },
    set taskOrder(next) {
      mockTaskOrder = next;
    },
  });
  return core.harness.moduleMock();
});

const switchAgentMock = vi.hoisted(() => vi.fn());
vi.mock('./agents', () => ({ switchAgent: switchAgentMock }));

const setInitialPromptMock = vi.hoisted(() => vi.fn());
vi.mock('./tasks', () => ({ setInitialPrompt: setInitialPromptMock }));

const taskStatusMocks = vi.hoisted(() => ({
  getAgentOutputTail: vi.fn().mockReturnValue(''),
  isAgentRateLimited: vi.fn().mockReturnValue(false),
  isAgentAskingQuestion: vi.fn().mockReturnValue(false),
}));
vi.mock('./taskStatus', () => ({
  getAgentOutputTail: taskStatusMocks.getAgentOutputTail,
  isAgentRateLimited: taskStatusMocks.isAgentRateLimited,
  isAgentAskingQuestion: taskStatusMocks.isAgentAskingQuestion,
  stripAnsi: (s: string) => s,
}));

const promptDetectMocks = vi.hoisted(() => ({
  chunkContainsAgentPrompt: vi.fn().mockReturnValue(true),
}));
vi.mock('../../electron/mcp/prompt-detect', () => promptDetectMocks);

const {
  startUltrakodOrchestrator,
  stopUltrakodOrchestrator,
  pickNextBestModel,
  switchAgentToNextBestModel,
} = await import('./ultrakodOrchestrator');

const PROVIDER_TO_AGENT_ID: Record<Provider, string | undefined> = {
  anthropic: 'claude-code',
  openai: 'codex',
  google: 'gemini',
  deepseek: undefined,
  mistral: undefined,
};
const NO_CLI_EXCLUDE = ['deepseek-v4-flash', 'mistral-small-3', 'mistral-large-2'];
const CLI_AGENT_IDS = ['claude-code', 'codex', 'gemini'];
const FUTURE = new Date(Date.now() + 60_000).toISOString();

/** The agent id the orchestrator would consider "preferred" for a mode with
 *  nothing cooling down — computed from the real registry so this test
 *  doesn't hardcode which specific model currently wins the ranking. */
function preferredAgentIdFor(mode: RoutingMode): string {
  const model = getModelForMode(mode, NO_CLI_EXCLUDE);
  const id = model && PROVIDER_TO_AGENT_ID[model.provider];
  if (!id) throw new Error(`no CLI-mapped model found for mode ${mode}`);
  return id;
}

function providerForAgentId(agentId: string): Provider {
  const entry = (
    Object.entries(PROVIDER_TO_AGENT_ID) as Array<[Provider, string | undefined]>
  ).find(([, id]) => id === agentId);
  if (!entry) throw new Error(`no provider maps to agent id ${agentId}`);
  return entry[0];
}

function agentDef(id: string, overrides: Partial<AgentDefLike> = {}): AgentDefLike {
  return {
    id,
    name: id,
    command: id,
    args: [],
    resume_args: [],
    skip_permissions_args: [],
    description: '',
    available: true,
    ...overrides,
  };
}

function setup(taskOverrides: Partial<TaskLike>, agentDefOverride: AgentDefLike): void {
  mockAgents = {
    'agent-1': { id: 'agent-1', taskId: 'task-1', def: agentDefOverride, status: 'running' },
  };
  mockTasks = {
    'task-1': {
      id: 'task-1',
      agentIds: ['agent-1'],
      selectedAgentId: 'agent-1',
      ultrakodMode: true,
      ultrakodRoutingMode: 'balanced',
      lastPrompt: 'do the thing',
      ...taskOverrides,
    },
  };
  mockTaskOrder = ['task-1'];
}

describe('ultrakodOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    for (const p of ['anthropic', 'openai', 'google', 'deepseek', 'mistral'] as const) {
      clearCooldown(p);
    }
    const harness = expectDefined(core.harness, 'mock store harness');
    harness.reset(harness.state());
    mockAvailableAgents = CLI_AGENT_IDS.map((id) => agentDef(id));
    // Mirror switchAgent's real side effect (mutating the agent's def in the
    // store) so multi-tick tests see the same state the real implementation
    // would leave behind.
    switchAgentMock.mockImplementation((agentId: string, newDef: AgentDefLike) => {
      if (mockAgents[agentId]) mockAgents[agentId] = { ...mockAgents[agentId], def: newDef };
    });
    taskStatusMocks.getAgentOutputTail.mockReturnValue('some recent output');
    taskStatusMocks.isAgentRateLimited.mockReturnValue(false);
    taskStatusMocks.isAgentAskingQuestion.mockReturnValue(false);
    promptDetectMocks.chunkContainsAgentPrompt.mockReturnValue(true);
  });

  afterEach(() => {
    stopUltrakodOrchestrator();
    vi.useRealTimers();
  });

  it('does nothing for tasks without ultrakodMode', () => {
    setup({ ultrakodMode: false }, agentDef('claude-code'));
    taskStatusMocks.isAgentRateLimited.mockReturnValue(true);

    startUltrakodOrchestrator();
    vi.advanceTimersByTime(3_000);

    expect(switchAgentMock).not.toHaveBeenCalled();
  });

  it('switches away from a rate-limited agent to a different installed CLI', () => {
    setup({}, agentDef('claude-code'));
    taskStatusMocks.isAgentRateLimited.mockReturnValue(true);

    startUltrakodOrchestrator();
    vi.advanceTimersByTime(3_000);

    expect(switchAgentMock).toHaveBeenCalledTimes(1);
    const [agentId, newDef] = switchAgentMock.mock.calls[0] as [string, AgentDefLike];
    expect(agentId).toBe('agent-1');
    expect(newDef.id).not.toBe('claude-code');
    expect(CLI_AGENT_IDS).toContain(newDef.id);
    expect(setInitialPromptMock).toHaveBeenCalledWith(
      'task-1',
      expect.stringContaining('do the thing'),
    );
  });

  it('does not re-switch every tick once settled on the next-best CLI', () => {
    setup({}, agentDef('claude-code'));
    taskStatusMocks.isAgentRateLimited.mockReturnValue(true);

    startUltrakodOrchestrator();
    vi.advanceTimersByTime(3_000);
    expect(switchAgentMock).toHaveBeenCalledTimes(1);

    // The freshly-switched-to CLI hasn't (yet) reported a rate limit of its own —
    // markAgentSpawned resets that signal on every respawn in the real code.
    taskStatusMocks.isAgentRateLimited.mockReturnValue(false);
    vi.advanceTimersByTime(3_000);
    expect(switchAgentMock).toHaveBeenCalledTimes(1);
  });

  it('does not switch when no other provider has an installed CLI', () => {
    mockAvailableAgents = [agentDef('claude-code')];
    setup({}, agentDef('claude-code'));
    taskStatusMocks.isAgentRateLimited.mockReturnValue(true);

    startUltrakodOrchestrator();
    vi.advanceTimersByTime(3_000);

    expect(switchAgentMock).not.toHaveBeenCalled();
  });

  it('switches back to the preferred model once available and the agent is idle', () => {
    const preferredId = preferredAgentIdFor('balanced');
    const fallbackId = CLI_AGENT_IDS.find((id) => id !== preferredId);
    if (!fallbackId) throw new Error('expected a non-preferred CLI agent id');
    setup({}, agentDef(fallbackId));

    startUltrakodOrchestrator();
    vi.advanceTimersByTime(3_000);

    expect(switchAgentMock).toHaveBeenCalledTimes(1);
    const [, newDef] = switchAgentMock.mock.calls[0] as [string, AgentDefLike];
    expect(newDef.id).toBe(preferredId);
  });

  it('does not switch back while the agent is mid-turn (not idle at its prompt)', () => {
    const preferredId = preferredAgentIdFor('balanced');
    const fallbackId = CLI_AGENT_IDS.find((id) => id !== preferredId);
    if (!fallbackId) throw new Error('expected a non-preferred CLI agent id');
    setup({}, agentDef(fallbackId));
    promptDetectMocks.chunkContainsAgentPrompt.mockReturnValue(false);

    startUltrakodOrchestrator();
    vi.advanceTimersByTime(3_000);

    expect(switchAgentMock).not.toHaveBeenCalled();
  });

  it('does not switch back while the preferred provider is still cooling down', () => {
    const preferredId = preferredAgentIdFor('balanced');
    const fallbackId = CLI_AGENT_IDS.find((id) => id !== preferredId);
    if (!fallbackId) throw new Error('expected a non-preferred CLI agent id');
    markCoolingDown(providerForAgentId(preferredId), new Date(Date.now() + 60_000).toISOString());
    setup({}, agentDef(fallbackId));

    startUltrakodOrchestrator();
    vi.advanceTimersByTime(3_000);

    expect(switchAgentMock).not.toHaveBeenCalled();
  });

  it('ignores agents that have already exited', () => {
    setup({}, agentDef('claude-code'));
    mockAgents['agent-1'].status = 'exited';
    taskStatusMocks.isAgentRateLimited.mockReturnValue(true);

    startUltrakodOrchestrator();
    vi.advanceTimersByTime(3_000);

    expect(switchAgentMock).not.toHaveBeenCalled();
  });

  describe('pickNextBestModel', () => {
    it('considers every provider in the registry, not just installed CLIs', () => {
      // Every CLI-mappable provider cooling down — only DeepSeek/Mistral
      // (API-only, no CLI in this app) remain as candidates.
      markCoolingDown('anthropic', FUTURE);
      markCoolingDown('openai', FUTURE);
      markCoolingDown('google', FUTURE);

      const pick = pickNextBestModel('cheap');

      expect(pick).not.toBeNull();
      expect(pick?.installedAgentDef).toBeNull();
      expect(['deepseek', 'mistral']).toContain(pick?.model.provider);
    });

    it('excludes the given provider explicitly', () => {
      const pick = pickNextBestModel('cheap', 'anthropic');
      expect(pick?.model.provider).not.toBe('anthropic');
    });

    it('returns null when nothing is left after exclusions', () => {
      for (const p of ['openai', 'google', 'deepseek', 'mistral'] as const) {
        markCoolingDown(p, FUTURE);
      }
      expect(pickNextBestModel('cheap', 'anthropic')).toBeNull();
    });
  });

  describe('switchAgentToNextBestModel', () => {
    it('switches live to the next-best installed CLI, even outside ultrakodMode', () => {
      setup({ ultrakodMode: false, ultrakodRoutingMode: 'balanced' }, agentDef('claude-code'));

      const pick = switchAgentToNextBestModel('task-1', 'agent-1');

      expect(pick).not.toBeNull();
      expect(pick?.installedAgentDef).not.toBeNull();
      expect(switchAgentMock).toHaveBeenCalledTimes(1);
      const [agentId, newDef] = switchAgentMock.mock.calls[0] as [string, AgentDefLike];
      expect(agentId).toBe('agent-1');
      expect(newDef.id).toBe(pick?.installedAgentDef?.id);
      expect(newDef.id).not.toBe('claude-code');
    });

    it('does not call switchAgent when the next-best model has no installed CLI', () => {
      setup({ ultrakodMode: false }, agentDef('claude-code'));
      markCoolingDown('openai', FUTURE);
      markCoolingDown('google', FUTURE);

      const pick = switchAgentToNextBestModel('task-1', 'agent-1');

      expect(pick).not.toBeNull();
      expect(pick?.installedAgentDef).toBeNull();
      expect(switchAgentMock).not.toHaveBeenCalled();
    });

    it('returns null and switches nothing when every provider is cooling down or excluded', () => {
      setup({ ultrakodMode: false }, agentDef('claude-code'));
      for (const p of ['openai', 'google', 'deepseek', 'mistral'] as const) {
        markCoolingDown(p, FUTURE);
      }

      const pick = switchAgentToNextBestModel('task-1', 'agent-1');

      expect(pick).toBeNull();
      expect(switchAgentMock).not.toHaveBeenCalled();
    });

    it('returns null for an unknown task or agent', () => {
      setup({ ultrakodMode: false }, agentDef('claude-code'));
      expect(switchAgentToNextBestModel('no-such-task', 'agent-1')).toBeNull();
      expect(switchAgentToNextBestModel('task-1', 'no-such-agent')).toBeNull();
      expect(switchAgentMock).not.toHaveBeenCalled();
    });
  });
});
