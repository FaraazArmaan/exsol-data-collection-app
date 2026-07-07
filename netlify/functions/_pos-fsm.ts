export type SaleStatus = 'pending_payment'|'paid'|'fulfilled'|'cancelled'|'refunded';
export type SaleChannel = 'instore'|'online'|'pickup';
export type FsmAction = 'markPaid'|'fulfill'|'cancel'|'refund';

export const FSM_ERROR = {
  MISSING_PERM: 'missing_perm',
  ILLEGAL_TRANSITION: 'illegal_transition',
} as const;
export type FsmError = (typeof FSM_ERROR)[keyof typeof FSM_ERROR];

const PERM: Record<FsmAction, string> = {
  markPaid: 'pos.sale.markPaid',
  fulfill:  'pos.sale.fulfill',
  cancel:   'pos.sale.cancel',
  refund:   'pos.sale.refund',
};

export const ALLOWED_FROM: Record<FsmAction, readonly SaleStatus[]> = {
  markPaid: ['pending_payment'],
  fulfill:  ['paid'],
  cancel:   ['pending_payment'],
  refund:   ['paid', 'fulfilled'],
};

const NATURAL_TO: Record<FsmAction, SaleStatus> = {
  markPaid: 'paid',
  fulfill:  'fulfilled',
  cancel:   'cancelled',
  refund:   'refunded',
};

export interface TransitionInput {
  from: SaleStatus;
  channel: SaleChannel;
  action: FsmAction;
  perms: ReadonlySet<string>;
}
export type TransitionResult =
  | { ok: true; to: SaleStatus; alsoPaid: boolean }      // alsoPaid=true only on instore+markPaid auto-fulfill
  | { ok: false; code: FsmError };

export function applyTransition(i: TransitionInput): TransitionResult {
  // §5.3 precedence — perm check FIRST so 403 wins over 409.
  if (!i.perms.has(PERM[i.action])) return { ok: false, code: FSM_ERROR.MISSING_PERM };
  if (!ALLOWED_FROM[i.action].includes(i.from)) return { ok: false, code: FSM_ERROR.ILLEGAL_TRANSITION };
  let to = NATURAL_TO[i.action];
  let alsoPaid = false;
  if (i.action === 'markPaid' && i.channel === 'instore') {
    // §5.1 — instore + markPaid auto-fulfills.
    to = 'fulfilled';
    alsoPaid = true;
  }
  return { ok: true, to, alsoPaid };
}
