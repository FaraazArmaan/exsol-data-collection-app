// /api/manufacturing/qc
//   GET ?order_id=  → QC checklist items for a production order (products.view)
//   POST            → add a checklist item { production_order_id, item } (products.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/qc', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.products.view']);
    if (!a.ok) return a.res;
    const orderId = new URL(req.url).searchParams.get('order_id') ?? '';
    if (!UUID_RE.test(orderId)) return jsonError(400, 'order_id_required');
    const sql = db();
    const checks = (await sql`
      SELECT id, production_order_id, item, result, disposition, scrap_qty, notes, created_at
      FROM public.manufacturing_qc_checks
      WHERE client_id = ${a.ctx.clientId}::uuid AND production_order_id = ${orderId}::uuid
      ORDER BY created_at ASC
    `) as unknown[];
    return jsonOk({ checks });
  }

  if (req.method === 'POST') {
    const a = await requireManufacturing(req, ['manufacturing.products.edit']);
    if (!a.ok) return a.res;
    let body: { production_order_id?: unknown; item?: unknown };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const orderId = typeof body.production_order_id === 'string' ? body.production_order_id.trim() : '';
    const item = typeof body.item === 'string' ? body.item.trim() : '';
    if (!orderId || !UUID_RE.test(orderId)) return jsonError(404, 'order_not_found');
    if (!item) return jsonError(400, 'item_required');

    const sql = db();
    const owned = (await sql`
      SELECT id FROM public.production_orders WHERE id = ${orderId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<{ id: string }>;
    if (owned.length === 0) return jsonError(404, 'order_not_found');

    const rows = (await sql`
      INSERT INTO public.manufacturing_qc_checks (client_id, production_order_id, item)
      VALUES (${a.ctx.clientId}::uuid, ${orderId}::uuid, ${item})
      RETURNING id, production_order_id, item, result, disposition, scrap_qty, notes, created_at
    `) as Array<Record<string, unknown>>;
    return jsonOk({ check: rows[0] }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
