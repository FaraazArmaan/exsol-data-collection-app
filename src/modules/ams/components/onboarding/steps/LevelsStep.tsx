import { useState } from 'react';
import type { WizardState, WizardAction, LevelDraft } from '../state';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function LevelsStep({ state, dispatch }: Props) {
  const nextLevelNumber = state.levels.length === 0
    ? 1
    : Math.max(...state.levels.map((l) => l.level_number)) + 1;
  const [draft, setDraft] = useState<LevelDraft>({ level_number: nextLevelNumber, label: '', allowed_role_keys: [] });
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    if (state.levels.some((l) => l.level_number === draft.level_number)) {
      setError(`Level ${draft.level_number} already defined`); return;
    }
    if (draft.allowed_role_keys.length === 0 && state.roles.length > 0) {
      setError('Pick at least one allowed role'); return;
    }
    dispatch({ type: 'addLevel', level: { ...draft, label: draft.label?.trim() || null } });
    const next = draft.level_number + 1;
    setDraft({ level_number: next, label: '', allowed_role_keys: [] });
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Levels</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Levels define the hierarchy depth. Level 1 is the top (the Owner level). You can skip; we'll
        auto-seed a "Primary" L1 referencing the first role.
      </p>

      {state.levels.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {state.levels.sort((a, b) => a.level_number - b.level_number).map((l, i) => (
            <div key={l.level_number} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <strong style={{ flex: 1 }}>Level {l.level_number}{l.label ? ` — ${l.label}` : ''}</strong>
              <span className="muted" style={{ fontSize: 11 }}>roles: {l.allowed_role_keys.join(', ') || '(none)'}</span>
              <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'removeLevel', index: i })}>×</button>
            </div>
          ))}
        </div>
      )}

      {state.roles.length === 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>Add roles first (or skip and we'll auto-seed).</p>
      ) : (
        <fieldset style={{ border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
          <legend style={{ fontSize: 12, padding: '0 6px' }}>Add a level</legend>
          <label>Level number
            <input type="number" min={1} value={draft.level_number}
              onChange={(e) => setDraft({ ...draft, level_number: parseInt(e.target.value || '1', 10) })} />
          </label>
          <label>Label (optional)
            <input type="text" value={draft.label ?? ''} onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="e.g. Primary, Manager, Staff" />
          </label>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 4px' }}>Allowed roles at this level:</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {state.roles.map((r) => {
              const checked = draft.allowed_role_keys.includes(r.key);
              return (
                <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={checked}
                    onChange={() => setDraft({ ...draft, allowed_role_keys: checked
                      ? draft.allowed_role_keys.filter((k) => k !== r.key)
                      : [...draft.allowed_role_keys, r.key] })} />
                  {r.label}
                </label>
              );
            })}
          </div>
          {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
          <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={add}>+ Add level</button>
        </fieldset>
      )}
    </div>
  );
}
