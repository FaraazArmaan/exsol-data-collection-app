// /api/pos/tax — staff storefront tax settings (GET current + PUT upsert).
//
// Gated on pos.sale.refund (financial config, frozen-key reuse) with L1 bypass.
// One row per client; PUT upserts. rate_bps is basis points (1800 = 18%).

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';
import { z } from 'zod';

export const config = { path: '/api/pos/tax' };

const PutBody = z.object({
  enabled: z.boolean(),
  rateBps: z.number().int().min(0).max(10000),
  label: z.string().trim().min(1).max(40),
  inclusive: z.boolean(),
});

const DEFAULTS = { enabled: false, rateBps: 0, label: 'Tax', inclusive: false };

export default async function handler(req: Request): Promise<Response> {
  const a = await requirePos(req, ['pos.sale.refund']);
  if (!a.ok) return a.res;
  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT enabled, rate_bps, label, inclusive FROM public.client_tax_config
      WHERE client_id = ${a.ctx.clientId}::uuid
    `) as Array<{ enabled: boolean; rate_bps: number; label: string; inclusive: boolean }>;
    const r = rows[0];
    return jsonOk({
      tax: r
        ? { enabled: r.enabled, rateBps: Number(r.rate_bps), label: r.label, inclusive: r.inclusive }
        : DEFAULTS,
    });
  }

  if (req.method === 'PUT') {
    let body: z.infer<typeof PutBody>;
    try {
      body = PutBody.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }
    await sql`
      INSERT INTO public.client_tax_config (client_id, enabled, rate_bps, label, inclusive)
      VALUES (${a.ctx.clientId}::uuid, ${body.enabled}, ${body.rateBps}, ${body.label}, ${body.inclusive})
      ON CONFLICT (client_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        rate_bps = EXCLUDED.rate_bps,
        label = EXCLUDED.label,
        inclusive = EXCLUDED.inclusive
    `;
    return jsonOk({ ok: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
