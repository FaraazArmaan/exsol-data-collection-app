import type { WizardState, WizardAction } from '../state';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function LevelsStep({ state, dispatch }: Props) {
  const sorted = [...state.levels].sort((a, b) => a.level_number - b.level_number);

  function addLevel() {
    const next = sorted.length === 0
      ? 1
      : Math.max(...sorted.map((l) => l.level_number)) + 1;
    dispatch({ type: 'addLevel', level: { level_number: next, label: null } });
  }

  function removeLevel(level_number: number) {
    const idx = state.levels.findIndex((l) => l.level_number === level_number);
    if (idx >= 0) dispatch({ type: 'removeLevel', index: idx });
  }

  function updateLabel(level_number: number, label: string | null) {
    dispatch({ type: 'updateLevelLabel', level_number, label });
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Levels</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        Levels are positions in your org chart. L1 is the top (Owner). Permissions are
        configured after onboarding in Access Levels.
      </p>

      {sorted.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {sorted.map((l) => (
            <div key={l.level_number} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <strong style={{ flex: '0 0 80px' }}>Level {l.level_number}</strong>
              <input
                type="text"
                placeholder="Optional label (e.g. Owner, Manager)"
                value={l.label ?? ''}
                onChange={(e) => updateLabel(l.level_number, e.target.value || null)}
                style={{ flex: 1 }}
              />
              {l.level_number > 1 && (
                <button type="button" className="btn btn-ghost" onClick={() => removeLevel(l.level_number)} title="Remove">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <button type="button" className="btn btn-secondary" onClick={addLevel}>+ Add level</button>

      {sorted.length === 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Skip to auto-seed a single "Primary" L1.
        </p>
      )}
    </div>
  );
}
