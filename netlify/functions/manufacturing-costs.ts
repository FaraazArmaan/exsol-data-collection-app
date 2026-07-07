// /api/manufacturing/costs
//   GET  → per-product unit costs for the client (manufacturing.products.view)
//   POST → upsert one product's unit cost (manufacturing.products.edit)
// The cost basis for BOM rollup + scrap valuation.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/costs', method: ['GET', 'POST'] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    // unit_cost_cents is BIGINT → Neon returns it as a string. Number() it so the
    // wire shape matches the `number` type callers rely on (BomBuilderModal, etc.).
    const rows = (await sql`
      SELECT product_id, unit_cost_cents FROM public.manufacturing_product_costs
      WHERE client_id = ${a.ctx.clientId}::uuid
    `) as Array<{ product_id: string; unit_cost_cents: string }>;
    const costs = rows.map((r) => ({ product_id: r.product_id, unit_cost_cents: Number(r.unit_cost_cents) }));
    return jsonOk({ costs });
  }

  if (req.method === 'POST') {
    const a = await requireManufacturing(req, ['manufacturing.products.edit']);
    if (!a.ok) return a.res;
    let body: { product_id?: unknown; unit_cost_cents?: unknown };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const productId = typeof body.product_id === 'string' ? body.product_id.trim() : '';
    const cents = typeof body.unit_cost_cents === 'number' ? Math.trunc(body.unit_cost_cents) : NaN;
    if (!productId) return jsonError(400, 'product_id_required');
    if (!Number.isFinite(cents) || cents < 0) return jsonError(400, 'cost_invalid');

    const sql = db();
    const owned = (await sql`
      SELECT id FROM public.products WHERE id = ${productId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL LIMIT 1
    `) as Array<{ id: string }>;
    if (owned.length === 0) return jsonError(404, 'product_not_found');

    await sql`
      INSERT INTO public.manufacturing_product_costs (client_id, product_id, unit_cost_cents)
      VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${cents}::bigint)
      ON CONFLICT (client_id, product_id)
      DO UPDATE SET unit_cost_cents = ${cents}::bigint, updated_at = now()
    `;
    return jsonOk({ product_id: productId, unit_cost_cents: cents });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
