// Coupon evaluation — pure, DB-free, shared by pub-coupon-validate (preview) and
// pub-sale-create (authoritative apply). Keeping the math here means the
// storefront preview and the checkout charge can NEVER disagree on the discount.
//
// The per-customer cap is intentionally NOT decided here: it needs a redemption
// count from the DB. evaluateCoupon answers "is this code usable for a cart of
// this size right now?"; the caller layers the per-customer check on top.

export interface CouponRow {
  id: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  min_order_cents: number;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  redeemed_count: number;
  starts_at: string | null;
  expires_at: string | null;
  active: boolean;
}

export type CouponEvaluation =
  | { ok: true; discountCents: number }
  | { ok: false; code: CouponRejectCode };

export type CouponRejectCode =
  | 'coupon_inactive'
  | 'coupon_not_started'
  | 'coupon_expired'
  | 'coupon_exhausted'
  | 'coupon_min_order'
  | 'coupon_no_effect';

// Order of checks is deliberate: identity/state gates first (inactive → window →
// global cap), then cart-dependent gates (min order), then the amount. The first
// failing gate wins so the storefront can show one precise reason. Discount is
// floored (never over-credit a fractional percent) and clamped to the subtotal
// so a large fixed coupon can never drive the total negative.
export function evaluateCoupon(
  coupon: CouponRow,
  subtotalCents: number,
  nowMs: number,
): CouponEvaluation {
  if (!coupon.active) return { ok: false, code: 'coupon_inactive' };
  if (coupon.starts_at && Date.parse(coupon.starts_at) > nowMs) {
    return { ok: false, code: 'coupon_not_started' };
  }
  if (coupon.expires_at && Date.parse(coupon.expires_at) <= nowMs) {
    return { ok: false, code: 'coupon_expired' };
  }
  if (coupon.max_redemptions != null && coupon.redeemed_count >= coupon.max_redemptions) {
    return { ok: false, code: 'coupon_exhausted' };
  }
  if (subtotalCents < coupon.min_order_cents) {
    return { ok: false, code: 'coupon_min_order' };
  }

  const raw =
    coupon.discount_type === 'percent'
      ? Math.floor((subtotalCents * coupon.discount_value) / 100)
      : coupon.discount_value;
  const discountCents = Math.min(raw, subtotalCents);
  if (discountCents <= 0) return { ok: false, code: 'coupon_no_effect' };

  return { ok: true, discountCents };
}

// Normalize the identity we cap per-customer on: prefer email (stable, unique),
// fall back to phone. Lower-cased + trimmed so 'A@B.com' and 'a@b.com' collide.
export function customerKey(customer: { phone: string; email?: string | null }): string {
  const raw = (customer.email && customer.email.trim()) || customer.phone;
  return raw.trim().toLowerCase();
}
