// /api/pos/coupons/:id — staff coupon mutate (PATCH) + remove (DELETE).
//
// PATCH toggles `active` and edits the non-monetary knobs (caps, window, min
// order). discount_type/value are immutable once created — redemptions are
// recorded against the terms in force at checkout, so changing them would
// retro-rewrite history. DELETE only hard-removes a never-used coupon; once it
// has redemptions it 409s (deactivate instead) to preserve the ledger.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';
import { z } from 'zod';

export const config = { path: '/api/pos/coupons/:id' };

const PatchBody = z.object({
  active: z.boolean().optional(),
  minOrderCents: z.number().int().min(0).optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  perCustomerLimit: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

function idFromPath(req: Request): string | null {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 1];
  return id && id !== 'coupons' ? id : null;
}

export default async function handler(req: Request): Promise<Response> {
  const a = await requirePos(req, ['pos.sale.refund']);
  if (!a.ok) return a.res;
  const sql = db();
  const id = idFromPath(req);
  if (!id) return jsonError(400, 'missing_id');

  if (req.method === 'PATCH') {
    let body: z.infer<typeof PatchBody>;
    try {
      body = PatchBody.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }
    // Read-merge-write: the Neon driver has no sql-fragment composition, and the
    // nullable knobs are tri-state (absent = keep, null = clear, value = set), so
    // resolve the final values in JS then write them concretely.
    const cur = (await sql`
      SELECT active, min_order_cents, max_redemptions, per_customer_limit, expires_at
      FROM public.coupons
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    `) as Array<{
      active: boolean; min_order_cents: number; max_redemptions: number | null;
      per_customer_limit: number | null; expires_at: string | null;
    }>;
    if (!cur[0]) return jsonError(404, 'coupon_not_found');
    const active = body.active ?? cur[0].active;
    const minOrder = body.minOrderCents ?? cur[0].min_order_cents;
    const maxRedemptions = body.maxRedemptions === undefined ? cur[0].max_redemptions : body.maxRedemptions;
    const perCustomer = body.perCustomerLimit === undefined ? cur[0].per_customer_limit : body.perCustomerLimit;
    const expiresAt = body.expiresAt === undefined ? cur[0].expires_at : body.expiresAt;
    const rows = (await sql`
      UPDATE public.coupons SET
        active = ${active},
        min_order_cents = ${minOrder},
        max_redemptions = ${maxRedemptions},
        per_customer_limit = ${perCustomer},
        expires_at = ${expiresAt}
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id
    `) as Array<{ id: string }>;
    if (!rows[0]) return jsonError(404, 'coupon_not_found');
    return jsonOk({ id: rows[0].id });
  }

  if (req.method === 'DELETE') {
    const rows = (await sql`
      DELETE FROM public.coupons
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid AND redeemed_count = 0
      RETURNING id
    `) as Array<{ id: string }>;
    if (!rows[0]) {
      // Either not found or has redemptions — disambiguate for the UI.
      const exists = (await sql`
        SELECT redeemed_count FROM public.coupons
        WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      `) as Array<{ redeemed_count: number }>;
      if (!exists[0]) return jsonError(404, 'coupon_not_found');
      return jsonError(409, 'coupon_has_redemptions');
    }
    return jsonOk({ id: rows[0].id });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
