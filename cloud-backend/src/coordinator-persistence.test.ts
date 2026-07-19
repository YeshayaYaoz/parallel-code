import { describe, it, expect } from 'vitest';
import { setupCoordinatorHarness, mockNextTask } from './coordinator-test-harness.js';
import { snapshotCoordinatorState, restoreCoordinatorState } from './coordinator-persistence.js';

describe('coordinator-persistence', () => {
  it('restores registered coordinators and known tasks from a snapshot', async () => {
    const { Coordinator, coordinator, registerDefaultCoordinator } =
      await setupCoordinatorHarness();

    mockNextTask({ id: 'task-1', branch_name: 'task/restore-me', worktree_path: '/tmp/restore' });
    coordinator.registerCoordinator('coord-1', 'proj-1');
    await coordinator.createTask({
      name: 'restore-me',
      prompt: 'do',
      coordinatorTaskId: 'coord-1',
    });

    const snapshot = snapshotCoordinatorState(coordinator);

    // A brand-new Coordinator instance simulates a fresh process after restart.
    const fresh = registerDefaultCoordinator(new Coordinator());
    expect(fresh.listTasks()).toHaveLength(0);

    restoreCoordinatorState(fresh, snapshot);

    const restoredTasks = fresh.listTasks();
    expect(restoredTasks).toHaveLength(1);
    expect(restoredTasks[0].id).toBe('task-1');
    expect(restoredTasks[0].branchName).toBe('task/restore-me');
    expect(fresh.isRegisteredCoordinator('coord-1')).toBe(true);
  });

  it('discards an unreadable snapshot without throwing', async () => {
    const { coordinator } = await setupCoordinatorHarness();
    expect(() => restoreCoordinatorState(coordinator, 'not json')).not.toThrow();
    expect(coordinator.listTasks()).toHaveLength(0);
  });

  it('skips a task whose coordinator failed to register, without aborting the rest', async () => {
    const { Coordinator, registerDefaultCoordinator } = await setupCoordinatorHarness();
    const fresh = registerDefaultCoordinator(new Coordinator());

    const snapshot = JSON.stringify({
      coordinators: [],
      tasks: [
        {
          id: 'orphan-task',
          name: 'orphan',
          projectId: 'proj-1',
          projectRoot: '/tmp/project',
          branchName: 'task/orphan',
          worktreePath: '/tmp/orphan',
          agentId: 'agent-orphan',
          coordinatorTaskId: 'never-registered',
          status: 'running',
          exitCode: null,
        },
      ],
    });

    expect(() => restoreCoordinatorState(fresh, snapshot)).not.toThrow();
    expect(fresh.listTasks()).toHaveLength(0);
  });
});
