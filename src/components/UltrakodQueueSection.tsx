import { createResource, createSignal, Show } from 'solid-js';
import { theme } from '../lib/theme';
import { errMessage } from '../lib/log';
import {
  getUltrakodQueueStatus,
  setUltrakodQueueConfig,
  clearUltrakodQueueConfig,
} from '../lib/ultrakod-queue';

/** Settings panel for the live CLI queue: the Railway URL + shared token
 *  used to submit rate-limited terminal input for remote answering. See
 *  RateLimitQueueBanner.tsx for where this gets used. */
export function UltrakodQueueSection() {
  const [status, { refetch }] = createResource(getUltrakodQueueStatus);
  const [baseUrl, setBaseUrl] = createSignal('');
  const [token, setToken] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();

  async function handleSave(): Promise<void> {
    const url = baseUrl().trim();
    const tok = token().trim();
    if (!url || !tok) {
      setError('Both the Railway URL and the shared token are required.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await setUltrakodQueueConfig(url, tok);
      setBaseUrl('');
      setToken('');
      await refetch();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(): Promise<void> {
    await clearUltrakodQueueConfig().catch(() => {
      /* best-effort */
    });
    await refetch();
  }

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
      <Show when={status()?.connected}>
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '10px',
            padding: '10px 12px',
            'border-radius': '8px',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
          }}
        >
          <span style={{ 'font-size': '13px', color: theme.fg, flex: '1' }}>
            Connected to <strong>{status()?.baseUrl}</strong>
          </span>
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              'border-radius': '6px',
              color: theme.fgMuted,
              cursor: 'pointer',
              'font-size': '12px',
            }}
          >
            Disconnect
          </button>
        </div>
      </Show>

      <Show when={!status()?.connected}>
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
            <span
              style={{
                'font-size': '13px',
                color: theme.fg,
                'white-space': 'nowrap',
                width: '110px',
              }}
            >
              Railway URL
            </span>
            <input
              type="text"
              value={baseUrl()}
              onInput={(e) => setBaseUrl(e.currentTarget.value)}
              placeholder="https://your-service.up.railway.app"
              style={{
                flex: '1',
                background: theme.taskPanelBg,
                border: `1px solid ${theme.border}`,
                'border-radius': '6px',
                padding: '6px 10px',
                color: theme.fg,
                'font-size': '13px',
                'font-family': "'JetBrains Mono', monospace",
                outline: 'none',
              }}
            />
          </label>
          <label style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
            <span
              style={{
                'font-size': '13px',
                color: theme.fg,
                'white-space': 'nowrap',
                width: '110px',
              }}
            >
              Shared token
            </span>
            <input
              type="password"
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
              placeholder="CLI_QUEUE_TOKEN value from Railway"
              style={{
                flex: '1',
                background: theme.taskPanelBg,
                border: `1px solid ${theme.border}`,
                'border-radius': '6px',
                padding: '6px 10px',
                color: theme.fg,
                'font-size': '13px',
                'font-family': "'JetBrains Mono', monospace",
                outline: 'none',
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving()}
            style={{
              'align-self': 'flex-start',
              padding: '8px 16px',
              background: theme.accent,
              border: 'none',
              'border-radius': '8px',
              color: theme.accentText,
              cursor: saving() ? 'default' : 'pointer',
              opacity: saving() ? 0.6 : 1,
              'font-size': '13px',
              'font-weight': '600',
            }}
          >
            Save
          </button>
          <Show when={error()}>
            {(message) => (
              <span style={{ 'font-size': '12px', color: theme.error }}>{message()}</span>
            )}
          </Show>
        </div>
      </Show>

      <span style={{ 'font-size': '11px', color: theme.fgSubtle }}>
        When a terminal hits a usage limit, you'll be offered to queue the pending input here — it
        gets answered once a model is available again (even hours later, computer off), and the
        answer is resent into that terminal next time this app is running. Text-only continuation,
        not real file edits — see ultrakod-listener's README for the coding-task path.
      </span>
    </div>
  );
}
