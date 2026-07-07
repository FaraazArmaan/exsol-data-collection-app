// /api/manufacturing/lots — component lot/batch traceability.
//   GET ?order_id=  → lots consumed by an order (trace back)
//   GET ?lot_ref=   → orders a lot fed into (trace forward)   (products.view)
//   POST            → record a consumed lot { production_order_id, component_product_id, lot_ref, qty } (products.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/lots', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.products.view']);
    if (!a.ok) return a.res;
    const url = new URL(req.url);
    const orderId = url.searchParams.get('order_id') ?? '';
    const lotRef = (url.searchParams.get('lot_ref') ?? '').trim();
    if (!UUID_RE.test(orderId) && !lotRef) return jsonError(400, 'filter_required');

    const orderFilter = UUID_RE.test(orderId) ? orderId : null;
    const sql = db();
    const lots = (await sql`
      SELECT l.id, l.production_order_id, l.component_product_id,
             cp.name AS component_name, l.lot_ref, l.qty, l.created_at,
             op.name AS output_product_name, po.status AS order_status
      FROM public.manufacturing_consumption_lots l
      JOIN public.products cp ON cp.id = l.component_product_id
      JOIN public.production_orders po ON po.id = l.production_order_id
      JOIN public.boms b ON b.id = po.bom_id
      JOIN public.products op ON op.id = b.output_product_id
      WHERE l.client_id = ${a.ctx.clientId}::uuid
        AND (${orderFilter}::uuid IS NULL OR l.production_order_id = ${orderFilter}::uuid)
        AND (${lotRef} = '' OR l.lot_ref = ${lotRef})
      ORDER BY l.created_at DESC
    `) as unknown[];
    return jsonOk({ lots });
  }

  if (req.method === 'POST') {
    const a = await requireManufacturing(req, ['manufacturing.products.edit']);
    if (!a.ok) return a.res;
    let body: { production_order_id?: unknown; component_product_id?: unknown; lot_ref?: unknown; qty?: unknown };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const orderId = typeof body.production_order_id === 'string' ? body.production_order_id.trim() : '';
    const componentId = typeof body.component_product_id === 'string' ? body.component_product_id.trim() : '';
    const lotRef = typeof body.lot_ref === 'string' ? body.lot_ref.trim() : '';
    const qty = typeof body.qty === 'number' ? Math.trunc(body.qty) : NaN;
    if (!UUID_RE.test(orderId)) return jsonError(404, 'order_not_found');
    if (!UUID_RE.test(componentId)) return jsonError(404, 'component_not_found');
    if (!lotRef) return jsonError(400, 'lot_ref_required');
    if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'qty_required');

    const sql = db();
    const order = (await sql`
      SELECT id FROM public.production_orders WHERE id = ${orderId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<{ id: string }>;
    if (order.length === 0) return jsonError(404, 'order_not_found');
    const comp = (await sql`
      SELECT id FROM public.products WHERE id = ${componentId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL LIMIT 1
    `) as Array<{ id: string }>;
    if (comp.length === 0) return jsonError(404, 'component_not_found');

    const rows = (await sql`
      INSERT INTO public.manufacturing_consumption_lots (client_id, production_order_id, component_product_id, lot_ref, qty)
      VALUES (${a.ctx.clientId}::uuid, ${orderId}::uuid, ${componentId}::uuid, ${lotRef}, ${qty}::int)
      RETURNING id, production_order_id, component_product_id, lot_ref, qty, created_at
    `) as Array<Record<string, unknown>>;
    return jsonOk({ lot: rows[0] }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
