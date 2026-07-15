import { For, Show, createMemo, createSignal } from 'solid-js';
import { Dialog } from './Dialog';
import { theme } from '../lib/theme';
import { errMessage } from '../lib/log';
import { openDialog } from '../lib/dialog';
import { addProject } from '../store/store';
import { GitHubConnectSection } from './GitHubConnectSection';
import { listGitHubRepos, cloneGitHubRepo, type GitHubRepoSummary } from '../lib/github';

interface CloneFromGitHubDialogProps {
  open: boolean;
  onClose: () => void;
  onCloned: (projectId: string) => void;
}

function repoNameFromFullName(fullName: string): string {
  return fullName.slice(fullName.lastIndexOf('/') + 1);
}

export function CloneFromGitHubDialog(props: CloneFromGitHubDialogProps) {
  const [connected, setConnected] = createSignal(false);
  const [repos, setRepos] = createSignal<GitHubRepoSummary[] | null>(null);
  const [loadingRepos, setLoadingRepos] = createSignal(false);
  const [reposError, setReposError] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [selectedRepo, setSelectedRepo] = createSignal<GitHubRepoSummary | null>(null);
  const [destParentDir, setDestParentDir] = createSignal<string | null>(null);
  const [cloning, setCloning] = createSignal(false);
  const [cloneError, setCloneError] = createSignal('');

  const filteredRepos = createMemo(() => {
    const q = query().trim().toLowerCase();
    const list = repos() ?? [];
    if (!q) return list;
    return list.filter((repo) => repo.fullName.toLowerCase().includes(q));
  });

  async function loadRepos(): Promise<void> {
    setLoadingRepos(true);
    setReposError('');
    try {
      const list = await listGitHubRepos();
      setRepos(list);
    } catch (err) {
      setReposError(errMessage(err));
    } finally {
      setLoadingRepos(false);
    }
  }

  function handleConnected(): void {
    setConnected(true);
    if (repos() === null) void loadRepos();
  }

  async function handleChooseFolder(): Promise<void> {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) setDestParentDir(selected as string);
  }

  async function handleClone(): Promise<void> {
    const repo = selectedRepo();
    const parentDir = destParentDir();
    if (!repo || !parentDir) return;

    setCloning(true);
    setCloneError('');
    try {
      const repoName = repoNameFromFullName(repo.fullName);
      const destDir = await cloneGitHubRepo(repo.cloneUrl, parentDir, repoName);
      const projectId = addProject(repoName, destDir, true);
      props.onCloned(projectId);
      handleClose();
    } catch (err) {
      setCloneError(errMessage(err));
    } finally {
      setCloning(false);
    }
  }

  function handleClose(): void {
    setSelectedRepo(null);
    setDestParentDir(null);
    setCloneError('');
    setQuery('');
    props.onClose();
  }

  return (
    <Dialog open={props.open} onClose={handleClose} width="520px" panelStyle={{ gap: '18px' }}>
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '18px' }}>
        <h2 style={{ margin: '0', 'font-size': '16px', color: theme.fg, 'font-weight': '600' }}>
          Clone from GitHub
        </h2>

        <GitHubConnectSection onConnected={handleConnected} />

        <Show when={connected()}>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <input
              type="text"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search your repositories…"
              style={{
                padding: '9px 12px',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
                'border-radius': '8px',
                color: theme.fg,
                'font-size': '13px',
                outline: 'none',
              }}
            />

            <Show when={loadingRepos()}>
              <div style={{ 'font-size': '12px', color: theme.fgMuted, padding: '8px 0' }}>
                Loading repositories…
              </div>
            </Show>

            <Show when={reposError()}>
              <div style={{ 'font-size': '12px', color: theme.error }}>{reposError()}</div>
            </Show>

            <Show when={!loadingRepos() && !reposError()}>
              <div
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  gap: '6px',
                  'max-height': '240px',
                  overflow: 'auto',
                }}
              >
                <Show when={filteredRepos().length === 0}>
                  <div style={{ 'font-size': '12px', color: theme.fgMuted, padding: '8px 0' }}>
                    No repositories match.
                  </div>
                </Show>
                <For each={filteredRepos()}>
                  {(repo) => {
                    const selected = () => selectedRepo()?.fullName === repo.fullName;
                    return (
                      <button
                        type="button"
                        onClick={() => setSelectedRepo(repo)}
                        style={{
                          display: 'flex',
                          'align-items': 'center',
                          gap: '8px',
                          padding: '9px 12px',
                          background: selected() ? theme.bgSelected : theme.bgInput,
                          border: selected()
                            ? `1px solid ${theme.accent}`
                            : `1px solid ${theme.border}`,
                          'border-radius': '8px',
                          color: theme.fg,
                          cursor: 'pointer',
                          'font-size': '13px',
                          'text-align': 'left',
                        }}
                      >
                        <span style={{ flex: '1', 'min-width': '0' }}>{repo.fullName}</span>
                        <Show when={repo.private}>
                          <span style={{ 'font-size': '10px', color: theme.fgSubtle }}>
                            Private
                          </span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>

            <Show when={selectedRepo()}>
              {(repo) => (
                <div
                  style={{
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '8px',
                    padding: '12px',
                    background: theme.bgInput,
                    border: `1px solid ${theme.border}`,
                    'border-radius': '8px',
                  }}
                >
                  <span style={{ 'font-size': '12px', color: theme.fgMuted }}>
                    Clone <strong>{repo().fullName}</strong> into:
                  </span>
                  <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
                    <span
                      style={{
                        flex: '1',
                        'min-width': '0',
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                        'font-size': '12px',
                        color: destParentDir() ? theme.fg : theme.fgSubtle,
                        'font-family': "'JetBrains Mono', monospace",
                      }}
                    >
                      {destParentDir()
                        ? `${destParentDir()}/${repoNameFromFullName(repo().fullName)}`
                        : 'Choose a destination folder…'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleChooseFolder()}
                      style={{
                        padding: '6px 12px',
                        background: 'transparent',
                        border: `1px solid ${theme.border}`,
                        'border-radius': '6px',
                        color: theme.fgMuted,
                        cursor: 'pointer',
                        'font-size': '12px',
                        'white-space': 'nowrap',
                      }}
                    >
                      Choose folder
                    </button>
                  </div>
                </div>
              )}
            </Show>

            <Show when={cloneError()}>
              <div style={{ 'font-size': '12px', color: theme.error }}>{cloneError()}</div>
            </Show>
          </div>
        </Show>

        <div style={{ display: 'flex', 'justify-content': 'flex-end', gap: '8px' }}>
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: '9px 18px',
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              'border-radius': '8px',
              color: theme.fgMuted,
              cursor: 'pointer',
              'font-size': '13px',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedRepo() || !destParentDir() || cloning()}
            onClick={() => void handleClone()}
            style={{
              padding: '9px 18px',
              background: theme.accent,
              border: 'none',
              'border-radius': '8px',
              color: theme.accentText,
              cursor: selectedRepo() && destParentDir() && !cloning() ? 'pointer' : 'not-allowed',
              'font-size': '13px',
              'font-weight': '600',
              opacity: selectedRepo() && destParentDir() && !cloning() ? '1' : '0.4',
            }}
          >
            {cloning() ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
