import { useState } from 'react';
import type { WizardState, WizardAction, RoleDraft } from '../state';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function RolesStep({ state, dispatch }: Props) {
  const [draft, setDraft] = useState<RoleDraft>({ key: '', label: '', color: '#3b82f6', bucket_family: null });
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    if (!/^[a-z][a-z0-9_-]*$/.test(draft.key)) { setError('Key must be lowercase, start with a letter, alphanumeric/_/-'); return; }
    if (draft.label.trim().length === 0) { setError('Label is required'); return; }
    if (state.roles.some((r) => r.key === draft.key)) { setError('Key must be unique within this workspace'); return; }
    dispatch({ type: 'addRole', role: { ...draft, label: draft.label.trim() } });
    setDraft({ key: '', label: '', color: '#3b82f6', bucket_family: null });
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Roles</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Define the role types in this workspace (e.g. Owner, Manager, Staff). You can skip this step;
        we'll auto-seed an "Owner" role.
      </p>

      {state.roles.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {state.roles.map((r, i) => (
            <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', background: r.color, display: 'inline-block' }} />
              <strong style={{ flex: 1 }}>{r.label}</strong>
              <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.key}</code>
              <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'removeRole', index: i })}>×</button>
            </div>
          ))}
        </div>
      )}

      <fieldset style={{ border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
        <legend style={{ fontSize: 12, padding: '0 6px' }}>Add a role</legend>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ flex: 1, minWidth: 120 }}>Key
            <input type="text" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="owner" />
          </label>
          <label style={{ flex: 2, minWidth: 160 }}>Label
            <input type="text" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Owner" />
          </label>
          <label>Color
            <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
          </label>
        </div>
        {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
        <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={add}>+ Add role</button>
      </fieldset>
    </div>
  );
}
