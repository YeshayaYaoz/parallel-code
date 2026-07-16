import { createSignal, createMemo, onMount, onCleanup, Show } from 'solid-js';
import { theme } from '../lib/theme';
import { invoke } from '../lib/ipc';
import { IPC } from '../../electron/ipc/channels';
import { errMessage } from '../lib/log';
import {
  startGitHubAuth,
  waitForGitHubAuth,
  getGitHubAuthStatus,
  logoutGitHub,
  type GitHubAuthWaitMessage,
} from '../lib/github';

type ConnectState =
  | { phase: 'idle' }
  | { phase: 'connected'; login: string }
  | { phase: 'waiting'; userCode: string; verificationUri: string }
  | { phase: 'error'; message: string };

interface GitHubConnectSectionProps {
  /** Called whenever the connected state is (re)established, including on
   *  mount if already connected — lets callers like the "Clone from GitHub"
   *  flow advance to the repo picker automatically. */
  onConnected?: (login: string) => void;
}

/** GitHub connect/disconnect panel for Settings. Also used to prompt for
 *  auth from the "Clone from GitHub" project flow. */
export function GitHubConnectSection(props: GitHubConnectSectionProps) {
  const [state, setState] = createSignal<ConnectState>({ phase: 'idle' });
  let activeWait: { cancel: () => void } | null = null;

  const connectedLogin = createMemo(() => {
    const s = state();
    return s.phase === 'connected' ? s.login : undefined;
  });
  const waitingInfo = createMemo(() => {
    const s = state();
    return s.phase === 'waiting'
      ? { userCode: s.userCode, verificationUri: s.verificationUri }
      : undefined;
  });
  const errorMessage = createMemo(() => {
    const s = state();
    return s.phase === 'error' ? s.message : undefined;
  });
  const showConnectButton = createMemo(() => {
    const phase = state().phase;
    return phase === 'idle' || phase === 'error';
  });

  const setConnected = (login: string) => {
    setState({ phase: 'connected', login });
    props.onConnected?.(login);
  };

  const handleWaitMessage = (msg: GitHubAuthWaitMessage): void => {
    if (msg.type === 'connected') {
      setConnected(msg.login);
    } else {
      setState({ phase: 'error', message: msg.message });
    }
  };

  onMount(async () => {
    try {
      const status = await getGitHubAuthStatus();
      if (status.connected && status.login) {
        setConnected(status.login);
      }
    } catch {
      // Leave in idle state — user can still try to connect.
    }
  });

  onCleanup(() => {
    activeWait?.cancel();
  });

  async function handleConnect(): Promise<void> {
    activeWait?.cancel();
    setState({ phase: 'idle' });
    try {
      const start = await startGitHubAuth();
      setState({
        phase: 'waiting',
        userCode: start.userCode,
        verificationUri: start.verificationUri,
      });
      invoke(IPC.ShellOpenExternal, { url: start.verificationUri }).catch(() => {
        /* user can still open it manually */
      });

      activeWait = waitForGitHubAuth(
        { deviceCode: start.deviceCode, interval: start.interval, expiresIn: start.expiresIn },
        handleWaitMessage,
      );
    } catch (err) {
      setState({ phase: 'error', message: errMessage(err) });
    }
  }

  function handleCancelWaiting(): void {
    activeWait?.cancel();
    activeWait = null;
    setState({ phase: 'idle' });
  }

  async function handleDisconnect(): Promise<void> {
    await logoutGitHub().catch(() => {
      /* best-effort */
    });
    setState({ phase: 'idle' });
  }

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
      <Show when={connectedLogin()}>
        {(login) => (
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
              Connected as <strong>{login()}</strong>
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
        )}
      </Show>

      <Show when={waitingInfo()}>
        {(info) => (
          <div
            style={{
              display: 'flex',
              'flex-direction': 'column',
              gap: '8px',
              padding: '12px 14px',
              'border-radius': '8px',
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
            }}
          >
            <span style={{ 'font-size': '13px', color: theme.fg }}>
              Enter this code at{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  invoke(IPC.ShellOpenExternal, { url: info().verificationUri }).catch(() => {});
                }}
                style={{ color: theme.accent }}
              >
                {info().verificationUri.replace(/^https?:\/\//, '')}
              </a>
              :
            </span>
            <span
              style={{
                'font-size': '20px',
                'font-weight': '700',
                'letter-spacing': '0.15em',
                color: theme.fg,
                'font-family': "'JetBrains Mono', monospace",
              }}
            >
              {info().userCode}
            </span>
            <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
              <span style={{ 'font-size': '12px', color: theme.fgSubtle }}>
                Waiting for approval…
              </span>
              <button
                type="button"
                onClick={handleCancelWaiting}
                style={{
                  'margin-left': 'auto',
                  padding: '5px 10px',
                  background: 'transparent',
                  border: `1px solid ${theme.border}`,
                  'border-radius': '6px',
                  color: theme.fgMuted,
                  cursor: 'pointer',
                  'font-size': '12px',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Show>

      <Show when={showConnectButton()}>
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
          <button
            type="button"
            onClick={() => void handleConnect()}
            style={{
              'align-self': 'flex-start',
              padding: '8px 16px',
              background: theme.accent,
              border: 'none',
              'border-radius': '8px',
              color: theme.accentText,
              cursor: 'pointer',
              'font-size': '13px',
              'font-weight': '600',
            }}
          >
            Connect GitHub
          </button>
          <Show when={errorMessage()}>
            {(message) => (
              <span style={{ 'font-size': '12px', color: theme.error }}>{message()}</span>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
