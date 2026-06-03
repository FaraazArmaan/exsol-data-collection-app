// src/modules/ams/components/onboarding/steps/NameStep.tsx
import type { WizardState, WizardAction } from '../state';
// deriveSlug from the shared identifier helper (mirrors server behavior).
function deriveSlugPreview(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/g, '');
  if (s.length < 2) return '(name too short)';
  return s;
}

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function NameStep({ state, dispatch }: Props) {
  const slug = state.name.trim() ? deriveSlugPreview(state.name) : '';
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Workspace name</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        This is the client/workspace display name. We'll derive a URL slug from it automatically.
      </p>
      <label>Name *
        <input type="text" autoFocus required value={state.name}
          onChange={(e) => dispatch({ type: 'setName', value: e.target.value })}
          placeholder="e.g. Joe's Hardware" />
      </label>
      {slug && (
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          URL slug preview: <code style={{ background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>{slug}</code>
        </p>
      )}
    </div>
  );
}
