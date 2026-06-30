import { createSignal, onMount, Show } from 'solid-js';
import { initAuth } from './auth';
import { connect } from './ws';
import { AgentList } from './AgentList';
import { AgentDetail } from './AgentDetail';
import { ConnectScreen } from './ConnectScreen';

export function App() {
  const [authed, setAuthed] = createSignal(false);
  // Separate view state from detail data so the agentId/taskName signals
  // never become empty while AgentDetail is still mounted (avoids reactive
  // race where Show disposes children *after* props re-evaluate to null).
  const [view, setView] = createSignal<'list' | 'detail'>('list');
  const [detailAgentId, setDetailAgentId] = createSignal('');
  const [detailTaskName, setDetailTaskName] = createSignal('');

  function selectAgent(id: string, name: string) {
    setDetailAgentId(id);
    setDetailTaskName(name);
    setView('detail');
  }

  function onConnected() {
    setAuthed(true);
    connect();
  }

  onMount(() => {
    const token = initAuth();
    if (token) onConnected();
  });

  return (
    <Show when={authed()} fallback={<ConnectScreen onConnected={onConnected} />}>
      <Show when={view() === 'detail'} fallback={<AgentList onSelect={selectAgent} />}>
        <AgentDetail
          agentId={detailAgentId()}
          taskName={detailTaskName()}
          onBack={() => setView('list')}
        />
      </Show>
    </Show>
  );
}
