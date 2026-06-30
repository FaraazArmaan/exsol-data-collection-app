export type BookingStatus =
  | 'pending' | 'confirmed' | 'blocked' | 'completed' | 'cancelled' | 'no_show';
export type BookingAction = 'pay' | 'cancel' | 'complete' | 'noShow' | 'unblock';

// Platform validates only <module>.<bucket>.<verb> keys, so booking maps its
// actions onto the customers bucket (see spec §5 — bucket×verb permission model).
export const PERM: Record<BookingAction, string> = {
  pay: 'booking.customers.create',  // payment confirmation path (public create / webhook)
  cancel: 'booking.customers.edit',
  complete: 'booking.customers.edit',
  noShow: 'booking.customers.edit',
  unblock: 'booking.customers.edit',
};

const ALLOWED_FROM: Record<BookingAction, readonly BookingStatus[]> = {
  pay: ['pending'],
  cancel: ['pending', 'confirmed'],
  complete: ['confirmed'],
  noShow: ['confirmed'],
  unblock: ['blocked'],
};
const NATURAL_TO: Record<BookingAction, BookingStatus> = {
  pay: 'confirmed', cancel: 'cancelled', complete: 'completed', noShow: 'no_show', unblock: 'blocked',
};

export type FsmError = 'missing_perm' | 'illegal_transition' | 'too_late_to_cancel' | 'too_early';

export interface TransitionInput {
  from: BookingStatus; action: BookingAction; perms: ReadonlySet<string>;
  now: Date; startsAt: Date; cancelCutoffMin: number; byVendor: boolean;
}

export function applyTransition(i: TransitionInput):
  | { ok: true; to: BookingStatus } | { ok: false; code: FsmError } {
  if (!i.perms.has(PERM[i.action])) return { ok: false, code: 'missing_perm' };
  if (!ALLOWED_FROM[i.action].includes(i.from)) return { ok: false, code: 'illegal_transition' };

  if (i.action === 'cancel' && !i.byVendor) {
    const cutoff = new Date(i.startsAt.getTime() - i.cancelCutoffMin * 60_000);
    if (i.now >= cutoff) return { ok: false, code: 'too_late_to_cancel' };
  }
  if ((i.action === 'complete' || i.action === 'noShow') && i.now < i.startsAt) {
    return { ok: false, code: 'too_early' };
  }
  return { ok: true, to: NATURAL_TO[i.action] };
}
