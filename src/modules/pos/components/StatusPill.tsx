import type { SaleStatus } from '../lib/fsm';

const COLORS: Record<SaleStatus, string> = {
  pending_payment: 'pill-amber',
  paid:            'pill-amber',
  fulfilled:       'pill-green',
  cancelled:       'pill-gray',
  refunded:        'pill-red',
};
const LABELS: Record<SaleStatus, string> = {
  pending_payment: 'Pending pay',
  paid:            'Paid',
  fulfilled:       'Fulfilled',
  cancelled:       'Cancelled',
  refunded:        'Refunded',
};

export function StatusPill({ status }: { status: SaleStatus }) {
  return <span className={`pos-pill ${COLORS[status]}`}>{LABELS[status]}</span>;
}
