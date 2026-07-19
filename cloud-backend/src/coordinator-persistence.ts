// Phase 4 (unattended coordinator): snapshot/restore just enough coordinator
// state to survive a container restart. This does NOT restart the actual
// spawned CLI agent processes (those die with the container, same as any PTY
// would) — it restores the coordinator's bookkeeping (registered
// coordinators + known sub-tasks) so getTaskStatus/listTasks/closeTask don't
// simply forget everything, exactly like hydrateTask already does for the
// Electron app's own relaunch path. A restarted coordinator agent process
// re-establishes MCP server info itself via setMCPServerInfo, same as today.
import type { Coordinator } from './coordinator.js';
import { info as logInfo, warn as logWarn } from './log.js';

interface CoordinatorSnapshot {
  coordinators: Array<{
    coordinatorTaskId: string;
    projectId: string;
    branchName?: string;
    worktreePath?: string;
  }>;
  tasks: ReturnType<Coordinator['getTask']>[];
}

export function snapshotCoordinatorState(coordinator: Coordinator): string {
  const coordinators = coordinator.getRegisteredCoordinators();
  const tasks = coordinator
    .listTasks()
    .map((t) => coordinator.getTask(t.id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);
  const snapshot: CoordinatorSnapshot = { coordinators, tasks };
  return JSON.stringify(snapshot);
}

export function restoreCoordinatorState(coordinator: Coordinator, json: string): void {
  let snapshot: CoordinatorSnapshot;
  try {
    snapshot = JSON.parse(json) as CoordinatorSnapshot;
  } catch (err) {
    logWarn('coordinator-persistence', `discarding unreadable snapshot: ${String(err)}`);
    return;
  }

  for (const c of snapshot.coordinators ?? []) {
    coordinator.registerCoordinator(c.coordinatorTaskId, c.projectId, {
      branchName: c.branchName,
      worktreePath: c.worktreePath,
    });
  }

  for (const task of snapshot.tasks ?? []) {
    if (!task) continue;
    try {
      coordinator.hydrateTask({
        ...task,
        signalDoneAt: task.signalDoneAt ? new Date(task.signalDoneAt).toISOString() : undefined,
      });
    } catch (err) {
      // Most likely its coordinator wasn't in the snapshot (or failed to
      // register) — skip this task rather than aborting the whole restore.
      logWarn('coordinator-persistence', `failed to hydrate task ${task.id}: ${String(err)}`);
    }
  }

  logInfo('coordinator-persistence', 'restored from snapshot', {
    coordinators: snapshot.coordinators?.length ?? 0,
    tasks: snapshot.tasks?.length ?? 0,
  });
}
