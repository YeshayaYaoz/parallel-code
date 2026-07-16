import { Dialog } from './Dialog';
import { theme } from '../lib/theme';

interface AddProjectChooserDialogProps {
  open: boolean;
  onClose: () => void;
  onChooseLocal: () => void;
  onChooseGitHub: () => void;
}

function ChooserOption(props: { label: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => props.onClick()}
      style={{
        display: 'flex',
        'flex-direction': 'column',
        gap: '4px',
        padding: '14px 16px',
        background: theme.bgInput,
        border: `1px solid ${theme.border}`,
        'border-radius': '10px',
        color: theme.fg,
        cursor: 'pointer',
        'text-align': 'left',
      }}
    >
      <span style={{ 'font-size': '14px', 'font-weight': '600' }}>{props.label}</span>
      <span style={{ 'font-size': '12px', color: theme.fgMuted }}>{props.description}</span>
    </button>
  );
}

/** Entry point for the "+" button next to Projects: pick a local folder, or
 *  clone a repo straight from GitHub. */
export function AddProjectChooserDialog(props: AddProjectChooserDialogProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose} width="400px" panelStyle={{ gap: '14px' }}>
      <h2 style={{ margin: '0', 'font-size': '16px', color: theme.fg, 'font-weight': '600' }}>
        Add Project
      </h2>
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
        <ChooserOption
          label="Open Local Folder"
          description="Add a project already on this machine"
          onClick={props.onChooseLocal}
        />
        <ChooserOption
          label="Clone from GitHub"
          description="Pick one of your repos and clone it locally"
          onClick={props.onChooseGitHub}
        />
      </div>
    </Dialog>
  );
}
