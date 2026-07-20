// /api/manufacturing/scrap
//   GET  → scrap log (manufacturing.products.view)
//   POST → scrap a product quantity: decrement inventory_stock + type='adjustment'
//          movement + a scrap_log row, atomically (manufacturing.products.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/scrap', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const logs = (await sql`
      SELECT s.id, s.product_id, p.name AS product_name, s.qty, s.reason,
             to_char(s.occurred_on, 'YYYY-MM-DD') AS occurred_on, s.created_at
      FROM public.manufacturing_scrap_logs s
      JOIN public.products p ON p.id = s.product_id
      WHERE s.client_id = ${a.ctx.clientId}::uuid
      ORDER BY s.occurred_on DESC, s.created_at DESC
    `) as unknown[];
    return jsonOk({ logs });
  }

  if (req.method === 'POST') {
    const a = await requireManufacturing(req, ['manufacturing.products.edit']);
    if (!a.ok) return a.res;
    let body: { product_id?: unknown; qty?: unknown; reason?: unknown; occurred_on?: unknown };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const productId = typeof body.product_id === 'string' ? body.product_id.trim() : '';
    const qty = typeof body.qty === 'number' ? Math.trunc(body.qty) : NaN;
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
    const occurredOn = typeof body.occurred_on === 'string' && body.occurred_on.trim() ? body.occurred_on.trim() : null;
    if (!UUID_RE.test(productId)) return jsonError(404, 'product_not_found');
    if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'qty_required');

    const sql = db();
    const owned = (await sql`
      SELECT id FROM public.products WHERE id = ${productId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL LIMIT 1
    `) as Array<{ id: string }>;
    if (owned.length === 0) return jsonError(404, 'product_not_found');

    const stock = (await sql`
      SELECT qty_on_hand FROM public.inventory_stock WHERE client_id = ${a.ctx.clientId}::uuid AND product_id = ${productId}::uuid AND variant_id IS NULL LIMIT 1
    `) as Array<{ qty_on_hand: number }>;
    if ((stock[0]?.qty_on_hand ?? 0) < qty) return jsonError(400, 'insufficient_stock');

    try {
      await sql.transaction([
        sql`
          UPDATE public.inventory_stock SET qty_on_hand = qty_on_hand - ${qty}::int, updated_at = now()
          WHERE client_id = ${a.ctx.clientId}::uuid AND product_id = ${productId}::uuid AND variant_id IS NULL
        `,
        sql`
          INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
          VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${-qty}::int, 'adjustment', ${`scrap:${reason ?? 'manual'}`}, ${a.ctx.userNodeId}::uuid)
        `,
        sql`
          INSERT INTO public.manufacturing_scrap_logs (client_id, product_id, qty, reason, occurred_on, created_by)
          VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${qty}::int, ${reason}, COALESCE(${occurredOn}::date, current_date), ${a.ctx.userNodeId}::uuid)
        `,
      ]);
    } catch (e) {
      if ((e as { code?: string }).code === '23514') return jsonError(400, 'insufficient_stock');
      throw e;
    }
    return jsonOk({ product_id: productId, qty });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
