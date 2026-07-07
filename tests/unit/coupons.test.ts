import { describe, it, expect } from 'vitest';
import { evaluateCoupon, customerKey, type CouponRow } from '../../netlify/functions/_shared/coupons';

const NOW = Date.parse('2026-07-07T12:00:00Z');

function base(overrides: Partial<CouponRow> = {}): CouponRow {
  return {
    id: 'c1',
    code: 'SAVE10',
    discount_type: 'percent',
    discount_value: 10,
    min_order_cents: 0,
    max_redemptions: null,
    per_customer_limit: null,
    redeemed_count: 0,
    starts_at: null,
    expires_at: null,
    active: true,
    ...overrides,
  };
}

describe('evaluateCoupon', () => {
  it('applies a percentage discount, floored', () => {
    // 15% of 999 = 149.85 → 149
    const r = evaluateCoupon(base({ discount_value: 15 }), 999, NOW);
    expect(r).toEqual({ ok: true, discountCents: 149 });
  });

  it('applies a fixed discount in minor units', () => {
    const r = evaluateCoupon(base({ discount_type: 'fixed', discount_value: 500 }), 2000, NOW);
    expect(r).toEqual({ ok: true, discountCents: 500 });
  });

  it('clamps a fixed discount to the subtotal (never negative total)', () => {
    const r = evaluateCoupon(base({ discount_type: 'fixed', discount_value: 5000 }), 2000, NOW);
    expect(r).toEqual({ ok: true, discountCents: 2000 });
  });

  it('rejects an inactive coupon', () => {
    expect(evaluateCoupon(base({ active: false }), 2000, NOW)).toEqual({ ok: false, code: 'coupon_inactive' });
  });

  it('rejects before the start window', () => {
    const r = evaluateCoupon(base({ starts_at: '2026-08-01T00:00:00Z' }), 2000, NOW);
    expect(r).toEqual({ ok: false, code: 'coupon_not_started' });
  });

  it('rejects at/after expiry', () => {
    const r = evaluateCoupon(base({ expires_at: '2026-07-07T12:00:00Z' }), 2000, NOW);
    expect(r).toEqual({ ok: false, code: 'coupon_expired' });
  });

  it('rejects when global cap is exhausted', () => {
    const r = evaluateCoupon(base({ max_redemptions: 5, redeemed_count: 5 }), 2000, NOW);
    expect(r).toEqual({ ok: false, code: 'coupon_exhausted' });
  });

  it('rejects when subtotal is below the minimum order', () => {
    const r = evaluateCoupon(base({ min_order_cents: 3000 }), 2000, NOW);
    expect(r).toEqual({ ok: false, code: 'coupon_min_order' });
  });

  it('rejects a percent discount that rounds to zero', () => {
    // 1% of 50 = 0.5 → floor 0
    const r = evaluateCoupon(base({ discount_value: 1 }), 50, NOW);
    expect(r).toEqual({ ok: false, code: 'coupon_no_effect' });
  });

  it('gate order: inactive beats an otherwise-valid window', () => {
    const r = evaluateCoupon(base({ active: false, expires_at: '2020-01-01T00:00:00Z' }), 2000, NOW);
    expect(r).toEqual({ ok: false, code: 'coupon_inactive' });
  });
});

describe('customerKey', () => {
  it('prefers a lower-cased email', () => {
    expect(customerKey({ phone: '999', email: 'A@B.com ' })).toBe('a@b.com');
  });
  it('falls back to phone when email is absent/blank', () => {
    expect(customerKey({ phone: ' 98765 ', email: '' })).toBe('98765');
    expect(customerKey({ phone: '98765' })).toBe('98765');
  });
});
