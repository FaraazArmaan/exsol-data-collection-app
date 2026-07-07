// POST /api/public/coupon-validate — storefront coupon preview (unauthenticated).
//
// Answers "would this code work for a cart of this size?" so the storefront can
// show the discount before checkout. Advisory only: pub-sale-create re-evaluates
// against server prices and the live redeemed_count at charge time, so a preview
// can never be trusted into an actual discount. Rate-limited to blunt code
// enumeration; a bad/expired/absent code returns a uniform {valid:false} shape.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveStorefront } from './_pub-authz';
import { checkLimit, clientIp } from './_pub-ratelimit';
import { evaluateCoupon, type CouponRow } from './_shared/coupons';
import { z } from 'zod';

export const config = { path: '/api/public/coupon-validate', method: 'POST' };

const Body = z.object({
  slug: z.string().min(1).max(120),
  code: z.string().trim().min(1).max(40),
  subtotalCents: z.number().int().min(0),
});

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slugHint = typeof raw?.slug === 'string' ? raw.slug : '';

  const rl = await checkLimit(clientIp(req), 'coupon', {
    perMinute: 20,
    perSlugIp: slugHint ? { slug: slugHint, per10min: 15 } : undefined,
  });
  if (!rl.ok) return jsonError(429, rl.code);

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(raw);
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }

  const tenant = await resolveStorefront(body.slug);
  if (!tenant) return jsonError(404, 'storefront_unavailable');

  const sql = db();
  const rows = (await sql`
    SELECT id, code, discount_type, discount_value, min_order_cents, max_redemptions,
           per_customer_limit, redeemed_count, starts_at, expires_at, active
    FROM public.coupons
    WHERE client_id = ${tenant.clientId}::uuid AND lower(code) = lower(${body.code})
    LIMIT 1
  `) as CouponRow[];
  if (!rows[0]) return jsonOk({ valid: false, reason: 'coupon_not_found' });

  const result = evaluateCoupon(rows[0], body.subtotalCents, Date.now());
  if (!result.ok) return jsonOk({ valid: false, reason: result.code });
  return jsonOk({ valid: true, code: rows[0].code, discountCents: result.discountCents });
}
