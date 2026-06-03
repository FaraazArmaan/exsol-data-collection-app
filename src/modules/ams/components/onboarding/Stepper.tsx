import { STEP_ORDER, type WizardStep } from './state';

const LABELS: Record<Exclude<WizardStep, 'success'>, string> = {
  name: 'Name',
  products: 'Products',
  roles: 'Roles',
  levels: 'Levels',
  cardinality: 'Cardinality',
  owner: 'Owner',
};

interface Props {
  currentStep: WizardStep;
  onJumpTo: (step: WizardStep) => void;
}

export function Stepper({ currentStep, onJumpTo }: Props) {
  if (currentStep === 'success') return null;
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      {STEP_ORDER.map((step, idx) => {
        const isCurrent = step === currentStep;
        const isCompleted = idx < currentIdx;
        const canJump = isCompleted; // can revisit completed steps; no skip-ahead
        return (
          <button
            key={step}
            type="button"
            onClick={() => canJump && onJumpTo(step)}
            disabled={!canJump && !isCurrent}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
              background: isCurrent ? 'var(--accent)' : 'transparent',
              color: isCurrent ? 'var(--text-on-accent)' : (isCompleted ? 'var(--text-primary)' : 'var(--text-muted)'),
              border: '1px solid', borderColor: isCurrent ? 'var(--accent)' : 'var(--border-subtle)',
              borderRadius: 'var(--radius-sm)', cursor: canJump ? 'pointer' : 'default',
              font: 'inherit', fontSize: 12,
            }}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span style={{ width: 18, height: 18, borderRadius: '50%',
              background: isCurrent || isCompleted ? 'currentColor' : 'transparent',
              border: '1px solid currentColor', display: 'inline-block',
              fontSize: 10, lineHeight: '16px', textAlign: 'center',
              color: isCurrent ? 'var(--accent)' : (isCompleted ? 'var(--bg-base)' : 'var(--text-muted)'),
            }}>
              {isCompleted ? '✓' : idx + 1}
            </span>
            {LABELS[step]}
          </button>
        );
      })}
    </div>
  );
}
