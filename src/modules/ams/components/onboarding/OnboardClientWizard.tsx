// src/modules/ams/components/onboarding/OnboardClientWizard.tsx
import { useEffect, useReducer, useState } from 'react';
import {
  initialState, reducer, validators, applyAutoSeed, STEP_ORDER,
  type WizardStep,
} from './state';
import { Stepper } from './Stepper';
import { NameStep } from './steps/NameStep';
import { ProductsStep } from './steps/ProductsStep';
import { RolesStep } from './steps/RolesStep';
import { LevelsStep } from './steps/LevelsStep';
import { CardinalityStep } from './steps/CardinalityStep';
import { OwnerStep } from './steps/OwnerStep';
import { SuccessStep } from './steps/SuccessStep';
import { onboardClient } from '../../api';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function OnboardClientWizard({ onClose, onCreated }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [createdClient, setCreatedClient] = useState<{ id: string; name: string; slug: string; tempPassword: string; email: string } | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Heartbeat: ping /api/auth-me every 5 minutes while the wizard is mounted
  // to keep the 15-minute admin session cookie refreshed. auth-me.ts calls
  // mintSession() when claims are within 10 minutes of expiry, so a 5-minute
  // interval guarantees the cookie never approaches its hard expiry while a
  // user is filling out the multi-step form.
  useEffect(() => {
    const id = window.setInterval(() => {
      void fetch('/api/auth-me', { credentials: 'same-origin' });
    }, 5 * 60 * 1000);
    return () => { window.clearInterval(id); };
  }, []);

  const currentIdx = STEP_ORDER.indexOf(state.step as Exclude<WizardStep, 'success'>);
  const isLastStep = state.step === 'owner';
  const isSuccess = state.step === 'success';

  function next() {
    const v = validators[state.step as keyof typeof validators](state);
    if (!v.ok) return;
    if (isLastStep) {
      void submit();
    } else {
      const nextStep = STEP_ORDER[currentIdx + 1]!;
      dispatch({ type: 'goToStep', step: nextStep });
    }
  }

  function back() {
    if (currentIdx > 0) dispatch({ type: 'goToStep', step: STEP_ORDER[currentIdx - 1]! });
  }

  function skip() {
    // Skip is allowed on every step except Name and Owner.
    if (state.step === 'name' || state.step === 'owner') return;
    const nextStep = STEP_ORDER[currentIdx + 1]!;
    dispatch({ type: 'goToStep', step: nextStep });
  }

  async function submit() {
    dispatch({ type: 'submitStart' });
    const seeded = applyAutoSeed(state);
    const r = await onboardClient({
      name: seeded.name,
      enabled_products: seeded.enabled_products,
      roles: seeded.roles,
      levels: seeded.levels,
      cardinality_rules: seeded.cardinality_rules,
      owner: seeded.owner,
    });
    if (!r.ok) {
      const code = r.error.code;
      if (code === 'unauthorized') {
        setSessionExpired(true);
        return;
      }
      const details = (r.error as { details?: { section?: string } }).details ?? {};
      dispatch({
        type: 'submitError',
        error: { code, section: (details.section as WizardStep | null) ?? null, details },
      });
      return;
    }
    setCreatedClient({
      id: r.data.client.id,
      name: r.data.client.name,
      slug: r.data.client.slug,
      tempPassword: seeded.owner.temp_password,
      email: seeded.owner.email,
    });
    onCreated();
    dispatch({ type: 'submitSuccess' });
  }

  function tryCancel() {
    if (isSuccess) { onClose(); return; }
    if (confirm('Discard onboarding? Nothing has been saved yet.')) onClose();
  }

  const canSkip = state.step !== 'name' && state.step !== 'owner' && !isSuccess;
  const canNext = !isSuccess && validators[state.step as keyof typeof validators]?.(state).ok !== false;

  return (
    <div onClick={tryCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(680px, 92vw)', maxHeight: '90vh', overflow: 'auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{isSuccess ? 'Workspace created' : 'New Workspace'}</h2>
          <button type="button" className="btn btn-ghost" onClick={tryCancel} aria-label="Cancel">×</button>
        </header>

        {sessionExpired ? (
          <div style={{ padding: '24px 8px' }}>
            <p style={{ marginTop: 0 }}>
              Your session expired. Refresh the page to sign in again.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { window.location.reload(); }}
            >
              Refresh
            </button>
          </div>
        ) : (
          <>
        <Stepper currentStep={state.step} onJumpTo={(s) => dispatch({ type: 'goToStep', step: s })} />

        {state.step === 'name' && <NameStep state={state} dispatch={dispatch} />}
        {state.step === 'products' && <ProductsStep state={state} dispatch={dispatch} />}
        {state.step === 'roles' && <RolesStep state={state} dispatch={dispatch} />}
        {state.step === 'levels' && <LevelsStep state={state} dispatch={dispatch} />}
        {state.step === 'cardinality' && <CardinalityStep state={state} dispatch={dispatch} />}
        {state.step === 'owner' && <OwnerStep state={state} dispatch={dispatch} />}
        {isSuccess && createdClient && (
          <SuccessStep clientId={createdClient.id} clientName={createdClient.name} clientSlug={createdClient.slug}
            ownerTempPassword={createdClient.tempPassword} ownerEmail={createdClient.email} onClose={onClose} />
        )}

        {state.submitError && (
          <div className="error" style={{ marginTop: 12 }}>
            {state.submitError.code} {state.submitError.section ? `(in ${state.submitError.section})` : ''}
            {state.submitError.section && state.submitError.section !== state.step && (
              <button type="button" className="btn btn-ghost" style={{ marginLeft: 8 }}
                onClick={() => dispatch({ type: 'goToStep', step: state.submitError!.section! })}>Jump to fix →</button>
            )}
          </div>
        )}

        {!isSuccess && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-ghost" onClick={back} disabled={currentIdx === 0 || state.submitting}>← Back</button>
            <div style={{ display: 'flex', gap: 8 }}>
              {canSkip && (
                <button type="button" className="btn btn-ghost" onClick={skip} disabled={state.submitting}>Skip</button>
              )}
              <button type="button" className="btn btn-primary" onClick={next} disabled={!canNext || state.submitting}>
                {state.submitting ? 'Creating…' : (isLastStep ? 'Create workspace' : 'Next →')}
              </button>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
