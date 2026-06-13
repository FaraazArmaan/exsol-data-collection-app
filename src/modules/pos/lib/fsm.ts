// FE mirror of the POS sale FSM. Used to gate action buttons in the
// detail drawer. The server's _fsm.ts is the source of truth — this
// file mirrors the matrix to give the FE instant-feedback gating
// without round-tripping. Server still enforces on every transition.

export type SaleStatus = 'pending_payment'|'paid'|'fulfilled'|'cancelled'|'refunded';
export type SaleChannel = 'instore'|'online'|'pickup';
export type FsmAction = 'markPaid'|'fulfill'|'cancel'|'refund';

const PERM: Record<FsmAction, string> = {
  markPaid: 'pos.sale.markPaid',
  fulfill:  'pos.sale.fulfill',
  cancel:   'pos.sale.cancel',
  refund:   'pos.sale.refund',
};

const ALLOWED_FROM: Record<FsmAction, readonly SaleStatus[]> = {
  markPaid: ['pending_payment'],
  fulfill:  ['paid'],
  cancel:   ['pending_payment'],
  refund:   ['paid', 'fulfilled'],
};

// Canonical button order in the drawer.
const ORDER: readonly FsmAction[] = ['markPaid', 'fulfill', 'cancel', 'refund'];

export function allowedActions(args: {
  status: SaleStatus;
  channel: SaleChannel;
  perms: ReadonlySet<string>;
}): FsmAction[] {
  return ORDER.filter((a) =>
    args.perms.has(PERM[a]) && ALLOWED_FROM[a].includes(args.status));
}

export function instoreAutoFulfills(action: FsmAction, channel: SaleChannel): boolean {
  return action === 'markPaid' && channel === 'instore';
}
