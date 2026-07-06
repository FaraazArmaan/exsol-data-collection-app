import type { POStatus } from './types';

// BIGINT cents may arrive as a string from Neon — Number() coerces both.
export function formatMoney(cents: number | string): string {
  const n = Number(cents) / 100;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const STATUS_LABEL: Record<POStatus, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  received: 'Received',
  cancelled: 'Cancelled',
};

// Maps a PO status to its badge modifier class (.proc-badge-<x>).
export const STATUS_VARIANT: Record<POStatus, string> = {
  draft: 'muted',
  ordered: 'amber',
  received: 'green',
  cancelled: 'red',
};
