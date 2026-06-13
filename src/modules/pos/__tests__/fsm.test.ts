import { describe, it, expect } from 'vitest';
import { allowedActions, instoreAutoFulfills } from '../lib/fsm';

const perms = (...keys: string[]) => new Set(keys);

describe('allowedActions', () => {
  it('pending_payment + all 4 perms → [markPaid, cancel]', () => {
    expect(allowedActions({
      status: 'pending_payment', channel: 'instore',
      perms: perms('pos.sale.markPaid','pos.sale.fulfill','pos.sale.cancel','pos.sale.refund'),
    })).toEqual(['markPaid', 'cancel']);
  });
  it('paid + pickup + all 4 perms → [fulfill, refund]', () => {
    expect(allowedActions({
      status: 'paid', channel: 'pickup',
      perms: perms('pos.sale.markPaid','pos.sale.fulfill','pos.sale.cancel','pos.sale.refund'),
    })).toEqual(['fulfill', 'refund']);
  });
  it('fulfilled + only refund perm → [refund]', () => {
    expect(allowedActions({
      status: 'fulfilled', channel: 'instore',
      perms: perms('pos.sale.refund'),
    })).toEqual(['refund']);
  });
  it('fulfilled + no perms → []', () => {
    expect(allowedActions({ status: 'fulfilled', channel: 'instore', perms: perms() }))
      .toEqual([]);
  });
  it('cancelled + all perms → [] (terminal)', () => {
    expect(allowedActions({
      status: 'cancelled', channel: 'instore',
      perms: perms('pos.sale.markPaid','pos.sale.fulfill','pos.sale.cancel','pos.sale.refund'),
    })).toEqual([]);
  });
  it('refunded + all perms → [] (terminal)', () => {
    expect(allowedActions({
      status: 'refunded', channel: 'instore',
      perms: perms('pos.sale.markPaid','pos.sale.fulfill','pos.sale.cancel','pos.sale.refund'),
    })).toEqual([]);
  });
  it('preserves canonical order (markPaid before fulfill before cancel before refund)', () => {
    expect(allowedActions({
      status: 'pending_payment', channel: 'instore',
      perms: perms('pos.sale.cancel','pos.sale.markPaid'),
    })).toEqual(['markPaid', 'cancel']);   // not [cancel, markPaid]
  });
});

describe('instoreAutoFulfills', () => {
  it('returns true only for markPaid + instore', () => {
    expect(instoreAutoFulfills('markPaid', 'instore')).toBe(true);
    expect(instoreAutoFulfills('markPaid', 'pickup')).toBe(false);
    expect(instoreAutoFulfills('markPaid', 'online')).toBe(false);
    expect(instoreAutoFulfills('fulfill',  'instore')).toBe(false);
    expect(instoreAutoFulfills('cancel',   'instore')).toBe(false);
    expect(instoreAutoFulfills('refund',   'instore')).toBe(false);
  });
});
