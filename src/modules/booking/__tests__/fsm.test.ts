import { describe, it, expect } from 'vitest';
import { applyTransition } from '../lib/fsm';

const ALL = new Set(['booking.edit', 'booking.create']);
const base = {
  perms: ALL, now: new Date('2026-08-15T00:00:00Z'),
  startsAt: new Date('2026-08-16T00:00:00Z'), cancelCutoffMin: 60, byVendor: false,
};

describe('applyTransition', () => {
  it('pay: pending → confirmed', () => {
    expect(applyTransition({ ...base, from: 'pending', action: 'pay' })).toEqual({ ok: true, to: 'confirmed' });
  });
  it('complete only after the appointment window — too_early before', () => {
    const r = applyTransition({ ...base, from: 'confirmed', action: 'complete',
      now: new Date('2026-08-15T23:00:00Z') });
    expect(r).toEqual({ ok: false, code: 'too_early' });
  });
  it('customer cancel blocked past the cutoff', () => {
    const r = applyTransition({ ...base, from: 'confirmed', action: 'cancel',
      now: new Date('2026-08-15T23:30:00Z') }); // 30 min before start < 60 cutoff
    expect(r).toEqual({ ok: false, code: 'too_late_to_cancel' });
  });
  it('vendor cancel ignores the cutoff', () => {
    const r = applyTransition({ ...base, from: 'confirmed', action: 'cancel', byVendor: true,
      now: new Date('2026-08-15T23:30:00Z') });
    expect(r).toEqual({ ok: true, to: 'cancelled' });
  });
  it('illegal transition: complete from pending', () => {
    expect(applyTransition({ ...base, from: 'pending', action: 'complete',
      now: new Date('2026-08-16T01:00:00Z') })).toEqual({ ok: false, code: 'illegal_transition' });
  });
  it('missing permission beats everything (403 > 409)', () => {
    expect(applyTransition({ ...base, perms: new Set<string>(), from: 'pending', action: 'cancel' }))
      .toEqual({ ok: false, code: 'missing_perm' });
  });
});
