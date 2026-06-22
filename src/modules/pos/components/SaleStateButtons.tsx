import { allowedActions, instoreAutoFulfills, type SaleStatus, type SaleChannel, type FsmAction } from '../lib/fsm';

const LABELS: Record<FsmAction, string> = {
  markPaid: 'Mark paid (cash)',
  fulfill:  'Mark fulfilled',
  cancel:   'Cancel',
  refund:   'Refund',
};

export function SaleStateButtons(props: {
  status: SaleStatus;
  channel: SaleChannel;
  perms: ReadonlySet<string>;
  onAction: (a: FsmAction) => void;
}) {
  const actions = allowedActions(props);
  if (actions.length === 0) return null;
  return (
    <div className="pos-state-buttons">
      {actions.map((a) => (
        <button key={a} onClick={() => props.onAction(a)}>
          {a === 'markPaid' && instoreAutoFulfills('markPaid', props.channel)
            ? 'Mark paid (cash) & complete'
            : LABELS[a]}
        </button>
      ))}
    </div>
  );
}
