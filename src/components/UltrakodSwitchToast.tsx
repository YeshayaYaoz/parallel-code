// Transient "switched models" banner for ultrakod-orchestrator-managed tasks
// — see src/store/ultrakodOrchestrator.ts, which records a switch here
// every time it kills the current CLI and spawns a different one.
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { theme } from '../lib/theme';
import { getLastUltrakodSwitch } from '../store/store';

const VISIBLE_MS = 8_000;

interface UltrakodSwitchToastProps {
  taskId: string;
}

export function UltrakodSwitchToast(props: UltrakodSwitchToastProps) {
  const [visibleMessage, setVisibleMessage] = createSignal<string | undefined>();
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let lastShownAt = 0;

  createEffect(() => {
    const record = getLastUltrakodSwitch(props.taskId);
    if (!record || record.at === lastShownAt) return;
    lastShownAt = record.at;
    setVisibleMessage(record.message);
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setVisibleMessage(undefined), VISIBLE_MS);
  });

  onCleanup(() => {
    if (hideTimer) clearTimeout(hideTimer);
  });

  return (
    <Show when={visibleMessage()}>
      {(msg) => (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            'z-index': '10',
            'font-size': '12px',
            color: theme.fg,
            background: 'color-mix(in srgb, var(--island-bg) 92%, transparent)',
            padding: '6px 12px',
            'border-radius': '8px',
            border: `1px solid ${theme.border}`,
          }}
        >
          🔀 {msg()}
        </div>
      )}
    </Show>
  );
}
