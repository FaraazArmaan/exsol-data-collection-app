// /api/pos/coupons — staff coupon management (list + create).
//
// Gating: requirePos with `pos.sale.refund`. Coupon generation moves money the
// same way refunds do (it discounts real sales), so it rides the most privileged
// existing POS action rather than minting a new `pos.*` key (frozen — iron rule 3).
// L1 Owners bypass via requirePos.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';
import { z } from 'zod';

export const config = { path: '/api/pos/coupons' };

const CreateBody = z
  .object({
    code: z.string().trim().min(1).max(40),
    discountType: z.enum(['percent', 'fixed']),
    discountValue: z.number().int().positive(),
    minOrderCents: z.number().int().min(0).default(0),
    maxRedemptions: z.number().int().positive().nullable().default(null),
    perCustomerLimit: z.number().int().positive().nullable().default(null),
    startsAt: z.string().datetime().nullable().default(null),
    expiresAt: z.string().datetime().nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine(
    (b) => (b.discountType === 'percent' ? b.discountValue >= 1 && b.discountValue <= 100 : b.discountValue > 0),
    { message: 'percent discount must be 1-100', path: ['discountValue'] },
  )
  .refine((b) => !(b.startsAt && b.expiresAt) || Date.parse(b.startsAt) < Date.parse(b.expiresAt), {
    message: 'expiresAt must be after startsAt',
    path: ['expiresAt'],
  });

interface Row {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  min_order_cents: number;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  redeemed_count: number;
  starts_at: string | null;
  expires_at: string | null;
  active: boolean;
  created_at: string;
}

function serialize(r: Row) {
  return {
    id: r.id,
    code: r.code,
    discountType: r.discount_type,
    discountValue: Number(r.discount_value),
    minOrderCents: Number(r.min_order_cents),
    maxRedemptions: r.max_redemptions == null ? null : Number(r.max_redemptions),
    perCustomerLimit: r.per_customer_limit == null ? null : Number(r.per_customer_limit),
    redeemedCount: Number(r.redeemed_count),
    startsAt: r.starts_at,
    expiresAt: r.expires_at,
    active: r.active,
    createdAt: r.created_at,
  };
}

export default async function handler(req: Request): Promise<Response> {
  const a = await requirePos(req, ['pos.sale.refund']);
  if (!a.ok) return a.res;
  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT id, code, discount_type, discount_value, min_order_cents, max_redemptions,
             per_customer_limit, redeemed_count, starts_at, expires_at, active, created_at
      FROM public.coupons
      WHERE client_id = ${a.ctx.clientId}::uuid
      ORDER BY active DESC, created_at DESC
    `) as Row[];
    return jsonOk({ coupons: rows.map(serialize) });
  }

  if (req.method === 'POST') {
    let body: z.infer<typeof CreateBody>;
    try {
      body = CreateBody.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }
    try {
      const rows = (await sql`
        INSERT INTO public.coupons (
          client_id, code, discount_type, discount_value, min_order_cents,
          max_redemptions, per_customer_limit, starts_at, expires_at, active
        ) VALUES (
          ${a.ctx.clientId}::uuid, ${body.code}, ${body.discountType}, ${body.discountValue}, ${body.minOrderCents},
          ${body.maxRedemptions}, ${body.perCustomerLimit}, ${body.startsAt}, ${body.expiresAt}, ${body.active}
        )
        RETURNING id, code, discount_type, discount_value, min_order_cents, max_redemptions,
                  per_customer_limit, redeemed_count, starts_at, expires_at, active, created_at
      `) as Row[];
      return jsonOk({ coupon: serialize(rows[0]!) }, { status: 201 });
    } catch (err: any) {
      if ((err?.code ?? err?.cause?.code) === '23505') return jsonError(409, 'coupon_code_exists');
      throw err;
    }
  }

  return new Response('Method Not Allowed', { status: 405 });
}
