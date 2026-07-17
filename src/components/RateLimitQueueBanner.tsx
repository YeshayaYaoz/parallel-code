// Offers to queue a rate-limited terminal's pending input to the ultrakod
// Railway live-CLI-queue service (see src/lib/ultrakod-queue.ts) once
// taskStatus.ts's looksLikeRateLimited detector fires. Submission is an
// explicit click, not automatic — it uploads recent terminal output to an
// external service, which deserves a deliberate confirmation rather than
// silent background behavior.
import { createSignal, Show } from 'solid-js';
import { theme } from '../lib/theme';
import { store, setStore } from '../store/core';
import { isAgentRateLimited, getAgentOutputTail } from '../store/taskStatus';
import { submitCliQueueTask } from '../lib/ultrakod-queue';
import { switchAgentToNextBestModel, cancelQueuedTask } from '../store/store';
import { errMessage } from '../lib/log';

interface RateLimitQueueBannerProps {
  taskId: string;
  agentId: string;
}

export function RateLimitQueueBanner(props: RateLimitQueueBannerProps) {
  const [submitting, setSubmitting] = createSignal(false);
  const [switching, setSwitching] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const [note, setNote] = createSignal<string | undefined>();

  const task = () => store.tasks[props.taskId];
  const queuedId = () => task()?.queuedRailwayTaskId;
  const showOffer = () =>
    isAgentRateLimited(props.agentId) && !queuedId() && !submitting() && !switching();
  // Live cross-provider switching is an Ultrakod-mode capability — plain CLI
  // sessions (claude-code, codex, etc. run directly, not through Ultrakod)
  // only get the queue-remotely/cancel options, available on every CLI.
  const canSwitch = () => !!task()?.ultrakodMode;

  async function handleQueue(mode: 'cheap' | 'balanced' | 'extra' = 'balanced'): Promise<void> {
    const currentTask = task();
    if (!currentTask) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const railwayTaskId = crypto.randomUUID();
      await submitCliQueueTask({
        taskId: railwayTaskId,
        mode,
        prompt: currentTask.lastPrompt || 'Continue where we left off.',
        context: { transcriptExcerpt: getAgentOutputTail(props.agentId).slice(-4000) },
      });
      setStore('tasks', props.taskId, 'queuedRailwayTaskId', railwayTaskId);
    } catch (err) {
      setError(errMessage(err));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  async function handleSwitch(): Promise<void> {
    setSwitching(true);
    setError(undefined);
    setNote(undefined);
    try {
      const pick = switchAgentToNextBestModel(props.taskId, props.agentId);
      if (!pick) {
        setError('No alternative model available right now.');
        return;
      }
      if (!pick.installedAgentDef) {
        setNote(`No CLI installed for ${pick.model.name} — queuing via API instead.`);
        await handleQueue(task()?.ultrakodRoutingMode ?? 'balanced');
      }
    } finally {
      setSwitching(false);
    }
  }

  async function handleCancel(): Promise<void> {
    await cancelQueuedTask(props.taskId);
  }

  const secondaryButtonStyle = {
    padding: '4px 10px',
    background: 'transparent',
    border: `1px solid ${theme.border}`,
    'border-radius': '6px',
    color: theme.fg,
    cursor: 'pointer',
    'font-size': '12px',
    'white-space': 'nowrap',
  } as const;

  return (
    <Show when={showOffer() || queuedId() || error() || switching()}>
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '12px',
          right: '12px',
          'z-index': '10',
          display: 'flex',
          'align-items': 'center',
          gap: '10px',
          'font-size': '12px',
          color: theme.fg,
          background: 'color-mix(in srgb, var(--island-bg) 92%, transparent)',
          padding: '8px 12px',
          'border-radius': '8px',
          border: `1px solid ${theme.border}`,
        }}
      >
        <Show when={queuedId()}>
          <span style={{ flex: '1' }}>
            {note() ?? '⏳ Queued — will resend into this terminal once a model is available.'}
          </span>
          <button type="button" onClick={() => void handleCancel()} style={secondaryButtonStyle}>
            Cancel
          </button>
        </Show>
        <Show when={!queuedId() && switching()}>
          <span style={{ flex: '1' }}>Switching…</span>
        </Show>
        <Show when={!queuedId() && showOffer()}>
          <span style={{ flex: '1' }}>Usage limit detected on this terminal.</span>
          <Show when={canSwitch()}>
            <button type="button" onClick={() => void handleSwitch()} style={secondaryButtonStyle}>
              Switch to next best model
            </button>
          </Show>
          <button
            type="button"
            onClick={() => {
              setNote(undefined);
              void handleQueue();
            }}
            style={{
              padding: '4px 10px',
              background: theme.accent,
              border: 'none',
              'border-radius': '6px',
              color: theme.accentText,
              cursor: 'pointer',
              'font-size': '12px',
              'white-space': 'nowrap',
            }}
          >
            Queue remotely until it resets
          </button>
        </Show>
        <Show when={error()}>{(m) => <span style={{ color: theme.error }}>{m()}</span>}</Show>
      </div>
    </Show>
  );
}
