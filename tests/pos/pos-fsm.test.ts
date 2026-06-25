import { describe, it, expect } from 'vitest';
import { applyTransition, FSM_ERROR, type SaleStatus } from '../../netlify/functions/_pos-fsm';

const perms = (...keys: string[]) => new Set(keys);

describe('applyTransition', () => {
  it('pending_payment + markPaid + perm + instore → fulfilled (auto)', () => {
    const r = applyTransition({
      from: 'pending_payment', channel: 'instore',
      action: 'markPaid', perms: perms('pos.sale.markPaid'),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.to).toBe('fulfilled');
      expect(r.alsoPaid).toBe(true);
    }
  });
  it('pending_payment + markPaid + perm + pickup → paid (no auto-fulfill)', () => {
    const r = applyTransition({
      from: 'pending_payment', channel: 'pickup',
      action: 'markPaid', perms: perms('pos.sale.markPaid'),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.to).toBe('paid');
      expect(r.alsoPaid).toBe(false);
    }
  });
  it('error precedence: missing perm wins over illegal state', () => {
    const r = applyTransition({
      from: 'paid', channel: 'instore',  // illegal: can't markPaid an already-paid
      action: 'markPaid', perms: perms(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(FSM_ERROR.MISSING_PERM);
  });
  it.each([
    ['fulfill', 'paid',     'fulfilled', 'pos.sale.fulfill'],
    ['cancel',  'pending_payment', 'cancelled', 'pos.sale.cancel'],
    ['refund',  'paid',     'refunded',  'pos.sale.refund'],
    ['refund',  'fulfilled','refunded',  'pos.sale.refund'],
  ] as const)('%s from %s → %s', (action, from, to, perm) => {
    const r = applyTransition({ from, channel: 'instore', action, perms: perms(perm) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe(to);
  });
  it.each([
    ['markPaid', 'fulfilled'],
    ['fulfill',  'pending_payment'],
    ['cancel',   'paid'],
    ['refund',   'pending_payment'],
  ] as const)('illegal: %s from %s → ILLEGAL_TRANSITION', (action, from) => {
    const r = applyTransition({
      from, channel: 'instore', action,
      perms: perms('pos.sale.markPaid','pos.sale.fulfill','pos.sale.cancel','pos.sale.refund'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(FSM_ERROR.ILLEGAL_TRANSITION);
  });
  it('online + markPaid → paid (no auto-fulfill, like pickup)', () => {
    const r = applyTransition({
      from: 'pending_payment', channel: 'online',
      action: 'markPaid', perms: perms('pos.sale.markPaid'),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.to).toBe('paid');
      expect(r.alsoPaid).toBe(false);
    }
  });
});
