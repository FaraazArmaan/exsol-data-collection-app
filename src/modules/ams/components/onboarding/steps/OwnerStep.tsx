// src/modules/ams/components/onboarding/steps/OwnerStep.tsx
import { useState } from 'react';
import type { WizardState, WizardAction } from '../state';
import { generateTempPassword } from '../../../../../lib/random-password';
import { resolveOwnerRoleKey, applyAutoSeed } from '../state';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function OwnerStep({ state, dispatch }: Props) {
  const [showPw, setShowPw] = useState(false);
  // Resolve role after auto-seeding so even the skip-everything path renders OK.
  const seeded = applyAutoSeed(state);
  const ownerRoleKey = resolveOwnerRoleKey(seeded);
  const ownerRoleLabel = ownerRoleKey ? seeded.roles.find((r) => r.key === ownerRoleKey)?.label ?? ownerRoleKey : null;

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Seed the L1 Owner</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Create the first user at Level 1. They'll receive the workspace as Owner.
        {ownerRoleLabel && <> Role will be <strong>{ownerRoleLabel}</strong> (the first role allowed at Level 1).</>}
      </p>

      <label>Display name *
        <input type="text" required value={state.owner.display_name}
          onChange={(e) => dispatch({ type: 'setOwner', patch: { display_name: e.target.value } })}
          placeholder="e.g. Joe Smith" />
      </label>
      <label>Email *
        <input type="email" required value={state.owner.email}
          onChange={(e) => dispatch({ type: 'setOwner', patch: { email: e.target.value } })}
          placeholder="owner@example.com" />
      </label>
      <label>Phone
        <input type="text" value={state.owner.phone ?? ''}
          onChange={(e) => dispatch({ type: 'setOwner', patch: { phone: e.target.value || null } })} />
      </label>
      <label>Notes
        <textarea value={state.owner.notes ?? ''}
          onChange={(e) => dispatch({ type: 'setOwner', patch: { notes: e.target.value || null } })}
          rows={2} />
      </label>
      <label>Temp password *
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type={showPw ? 'text' : 'password'} required value={state.owner.temp_password}
            onChange={(e) => dispatch({ type: 'setOwner', patch: { temp_password: e.target.value } })}
            style={{ flex: 1, fontFamily: 'monospace' }} />
          <button type="button" className="btn btn-ghost"
            onClick={() => dispatch({ type: 'setOwner', patch: { temp_password: generateTempPassword() } })}>Regen</button>
          <button type="button" className="btn btn-ghost"
            onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          The Owner must change this on first login.
        </span>
      </label>
    </div>
  );
}
