import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { PROVIDER_TO_AGENT_ID } from './registry.js';

const execFileAsync = promisify(execFile);

interface AgentDef {
  id: string;
  name: string;
  command: string;
  args: string[];
  resume_args: string[];
  skip_permissions_args: string[];
  description: string;
  available?: boolean;
  prompt_ready_delay_ms?: number;
}

const DEFAULT_AGENTS: AgentDef[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    resume_args: ['--continue'],
    skip_permissions_args: ['--dangerously-skip-permissions'],
    description: "Anthropic's Claude Code CLI agent",
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    args: [],
    resume_args: ['resume', '--last'],
    skip_permissions_args: ['--dangerously-bypass-approvals-and-sandbox'],
    description: "OpenAI's Codex CLI agent",
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: [],
    resume_args: ['--resume', 'latest'],
    skip_permissions_args: ['--yolo'],
    description: "Google's Gemini CLI agent",
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: [],
    resume_args: [],
    skip_permissions_args: [],
    description: 'Open source AI coding agent (opencode.ai)',
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    command: 'copilot',
    args: [],
    resume_args: ['--continue'],
    skip_permissions_args: ['--yolo'],
    description: "GitHub's Copilot CLI agent",
    // Copilot CLI shows up to two init dialogs (folder trust + instructions init)
    // before reaching its real prompt.  A modest stability delay lets the prompt
    // settle before sending, without being so long that the user notices the wait.
    prompt_ready_delay_ms: 1_000,
  },
  {
    id: 'antigravity',
    name: 'Antigravity CLI',
    command: 'agy',
    args: [],
    resume_args: ['-c'],
    skip_permissions_args: ['--dangerously-skip-permissions'],
    description: "Google's Antigravity CLI agent (successor to Gemini CLI)",
    // Antigravity paints a TUI that needs a beat to settle before auto-send.
    prompt_ready_delay_ms: 1_000,
  },
  {
    id: 'ultrakod',
    name: 'Ultrakod',
    command: 'ultrakod',
    args: [],
    resume_args: [],
    skip_permissions_args: [],
    description: 'Model router and context management CLI for optimal model selection',
    prompt_ready_delay_ms: 500,
  },
];

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    await execFileAsync(lookup, [command], { encoding: 'utf8', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// TTL cache to avoid repeated `which` calls
let cachedAgents: AgentDef[] | null = null;
let cacheTime = 0;
const AGENT_CACHE_TTL = 30_000;

export function getSkipPermissionsArgs(command: string): string[] {
  const base = path.basename(command);
  const agent = DEFAULT_AGENTS.find((a) => a.command === base || a.command === command);
  return agent ? [...agent.skip_permissions_args] : [];
}

export async function listAgents(): Promise<AgentDef[]> {
  const now = Date.now();
  if (cachedAgents && now - cacheTime < AGENT_CACHE_TTL) {
    return cachedAgents;
  }

  const resolved = await Promise.all(
    DEFAULT_AGENTS.map(async (agent) => ({
      ...agent,
      // 'ultrakod' is a placeholder def with no real CLI of its own (see
      // NewTaskDialog.tsx, which resolves it to a real installed CLI at task
      // creation time) — checking PATH for a literal `ultrakod` binary would
      // always report unavailable. Patched below based on its actual pool.
      available: agent.id === 'ultrakod' ? true : await isCommandAvailable(agent.command),
    })),
  );
  const cliAgentIds = new Set(Object.values(PROVIDER_TO_AGENT_ID));
  const anyCliInstalled = resolved.some((a) => cliAgentIds.has(a.id) && a.available);
  cachedAgents = resolved.map((a) =>
    a.id === 'ultrakod' ? { ...a, available: anyCliInstalled } : a,
  );
  cacheTime = now;
  return cachedAgents;
}
