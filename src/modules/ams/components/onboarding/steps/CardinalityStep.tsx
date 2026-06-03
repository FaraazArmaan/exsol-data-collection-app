import { useState } from 'react';
import type { WizardState, WizardAction, CardinalityDraft } from '../state';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function CardinalityStep({ state, dispatch }: Props) {
  const [draft, setDraft] = useState<CardinalityDraft>({ parent_role_key: null, child_role_key: '', max_children: 1 });
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    if (draft.child_role_key === '') { setError('Pick a child role'); return; }
    if (state.cardinality_rules.some((r) =>
      r.parent_role_key === draft.parent_role_key && r.child_role_key === draft.child_role_key)) {
      setError('Rule already defined for this parent/child combo'); return;
    }
    dispatch({ type: 'addCardinality', rule: draft });
    setDraft({ parent_role_key: null, child_role_key: '', max_children: 1 });
  }

  function labelOf(key: string | null): string {
    if (key === null) return '(top-level)';
    return state.roles.find((r) => r.key === key)?.label ?? key;
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Cardinality rules</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Optionally cap how many children of each role can exist under each parent role. Skip for no caps.
      </p>

      {state.cardinality_rules.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {state.cardinality_rules.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ flex: 1, fontSize: 13 }}>
                Under <strong>{labelOf(r.parent_role_key)}</strong>: at most <strong>{r.max_children}</strong> {labelOf(r.child_role_key)}
              </span>
              <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'removeCardinality', index: i })}>×</button>
            </div>
          ))}
        </div>
      )}

      {state.roles.length === 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>Add roles first (or skip).</p>
      ) : (
        <fieldset style={{ border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
          <legend style={{ fontSize: 12, padding: '0 6px' }}>Add a cardinality rule</legend>
          <label>Parent role
            <select value={draft.parent_role_key ?? '_top'}
              onChange={(e) => setDraft({ ...draft, parent_role_key: e.target.value === '_top' ? null : e.target.value })}>
              <option value="_top">(top-level)</option>
              {state.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          <label>Child role
            <select value={draft.child_role_key}
              onChange={(e) => setDraft({ ...draft, child_role_key: e.target.value })}>
              <option value="">— pick —</option>
              {state.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          <label>Max children
            <input type="number" min={0} value={draft.max_children}
              onChange={(e) => setDraft({ ...draft, max_children: parseInt(e.target.value || '0', 10) })} />
          </label>
          {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
          <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={add}>+ Add rule</button>
        </fieldset>
      )}
    </div>
  );
}
