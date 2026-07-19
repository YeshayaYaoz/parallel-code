#!/usr/bin/env node
// Standalone entry point. Boots the same WebSocket+REST protocol
// (server-remote.ts, ported verbatim from electron/remote/server.ts) backed
// by a single Coordinator instance, as a plain Node process instead of
// inside the Electron main process — so the existing remote client
// (src/remote/*, today built into the Electron app's bundled mobile SPA)
// can attach to this process exactly as it already attaches to a desktop
// instance, without any client-side changes.
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { Coordinator } from './coordinator.js';
import { startRemoteServer, type RemoteProject } from './server-remote.js';
import { createTask, deleteTask } from './tasks.js';
import { spawnAgent, writeToAgent, getAgentMeta } from './pty.js';
import { info as logInfo, warn as logWarn } from './log.js';
import { loadCoordinatorSnapshot, saveCoordinatorSnapshot } from './persistence.js';
import { snapshotCoordinatorState, restoreCoordinatorState } from './coordinator-persistence.js';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 7777);
const HOST = process.env.HOST ?? '0.0.0.0';
const STATIC_DIR = process.env.STATIC_DIR ?? path.join(thisDir, '..', 'public');

// This process manages exactly one project (see Coordinator.setDefaultProject
// and the README's "Multiple projects" section — one Fly machine per
// project). PROJECT_ROOT must be a git repo checkout on this container's
// filesystem; there is no remote-clone-on-demand step here yet.
const PROJECT_ROOT = process.env.PROJECT_ROOT;
const PROJECT_ID = process.env.PROJECT_ID ?? 'default';
const PROJECT_NAME = process.env.PROJECT_NAME ?? path.basename(PROJECT_ROOT ?? PROJECT_ID);
const AGENT_COMMAND = process.env.AGENT_COMMAND ?? 'claude';
const AGENT_ARGS = process.env.AGENT_ARGS ? (JSON.parse(process.env.AGENT_ARGS) as string[]) : [];
const PLAIN_TASK_PROMPT_DELAY_MS = 3000;

if (!PROJECT_ROOT) {
  logWarn(
    'index',
    'PROJECT_ROOT is not set — plain task creation (POST /api/mobile/tasks) will be unavailable until it is configured.',
  );
} else if (!existsSync(PROJECT_ROOT)) {
  throw new Error(`PROJECT_ROOT does not exist: ${PROJECT_ROOT}`);
}

// Plain (non-coordinator) task bookkeeping — the Coordinator only tracks its
// own sub-tasks, so tasks created via createTaskFromMobile below need their
// own name lookup (getTaskName) and agentId/branchName record (for deletion).
const plainTaskNames = new Map<string, string>();
const plainTasks = new Map<string, { agentId: string; branchName: string }>();

const coordinator = new Coordinator();

// Phase 4 (unattended coordinator): resume whatever coordinators/sub-tasks
// were known before this process last stopped, so a Fly machine restart
// doesn't leave the API reporting an empty task list. See
// coordinator-persistence.ts for what is (and isn't) restored.
const previousSnapshot = loadCoordinatorSnapshot();
if (previousSnapshot) {
  restoreCoordinatorState(coordinator, previousSnapshot);
}

coordinator.setNotifier((channel, data) => {
  logInfo('coordinator', channel, data as Record<string, unknown>);
  try {
    saveCoordinatorSnapshot(snapshotCoordinatorState(coordinator));
  } catch (err) {
    logWarn('coordinator-persistence', `failed to save snapshot: ${String(err)}`);
  }
});

const server = await startRemoteServer({
  port: PORT,
  host: HOST,
  staticDir: STATIC_DIR,
  getTaskName: (taskId) =>
    plainTaskNames.get(taskId) ?? coordinator.getTask(taskId)?.name ?? taskId,
  getAgentStatus: (agentId) => {
    const meta = getAgentMeta(agentId);
    return {
      status: meta ? ('running' as const) : ('exited' as const),
      exitCode: null,
      lastLine: '',
    };
  },
  getCoordinator: () => coordinator,
  getProjects: PROJECT_ROOT
    ? async (): Promise<RemoteProject[]> => [{ id: PROJECT_ID, name: PROJECT_NAME }]
    : undefined,
  createTaskFromMobile: PROJECT_ROOT
    ? async (req) => {
        if (req.projectId !== PROJECT_ID) {
          throw new Error(`Unknown projectId: ${req.projectId}`);
        }
        const result = await createTask(req.name, PROJECT_ROOT, [], 'task');
        plainTaskNames.set(result.id, req.name);
        const agentId = randomUUID();
        plainTasks.set(result.id, { agentId, branchName: result.branch_name });
        spawnAgent({
          taskId: result.id,
          agentId,
          command: req.agentCommand ?? AGENT_COMMAND,
          args: req.agentArgs ?? AGENT_ARGS,
          cwd: result.worktree_path,
          env: {},
          cols: 120,
          rows: 40,
        });
        if (req.prompt) {
          // A freshly spawned CLI needs a moment to boot before it accepts
          // piped input; this is a fixed delay rather than prompt-readiness
          // detection (prompt-detect.ts) since that's driven by the
          // coordinator's own sub-task lifecycle, not this plain-task path.
          setTimeout(() => {
            try {
              writeToAgent(agentId, req.prompt + '\r');
            } catch {
              /* agent already gone */
            }
          }, PLAIN_TASK_PROMPT_DELAY_MS);
        }
        return { taskId: result.id, agentId };
      }
    : undefined,
  deleteTaskFromMobile: PROJECT_ROOT
    ? async (taskId) => {
        const record = plainTasks.get(taskId);
        if (!record) throw new Error(`Unknown task: ${taskId}`);
        await deleteTask({
          agentIds: [record.agentId],
          branchName: record.branchName,
          deleteBranch: true,
          projectRoot: PROJECT_ROOT,
        });
        plainTasks.delete(taskId);
        plainTaskNames.delete(taskId);
      }
    : undefined,
});

logInfo('server', `cloud-backend listening on ${server.url}`, {
  port: server.port,
  bindHost: server.bindHost,
});
// The coordinator token is the operator credential — full access, including
// /api/state and (per server-remote.ts) task creation. Logged once at boot
// rather than embedded in a URL like the mobile token, since it's meant for
// whoever can read this process's own logs (fly logs / docker logs), not for
// pasting into a browser bar.
logInfo('server', `operator (coordinator) token: ${server.token}`);

async function shutdown(): Promise<void> {
  await server.stop();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
