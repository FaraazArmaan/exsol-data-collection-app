// GET list + POST create for production orders. Scoped by client_id.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/orders', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const items = (await sql`
      SELECT po.id, po.bom_id, b.name AS bom_name, b.output_product_id,
             p.name AS output_product_name, po.qty, po.status,
             po.created_at, po.completed_at
      FROM public.production_orders po
      JOIN public.boms b ON b.id = po.bom_id
      JOIN public.products p ON p.id = b.output_product_id
      WHERE po.client_id = ${a.ctx.clientId}::uuid
      ORDER BY po.created_at DESC
    `) as unknown[];
    return jsonOk({ items });
  }

  if (req.method === 'POST') {
    const a = await requireManufacturing(req, ['manufacturing.products.create']);
    if (!a.ok) return a.res;
    let body: { bom_id?: unknown; qty?: unknown };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const bomId = typeof body.bom_id === 'string' ? body.bom_id.trim() : '';
    const qty = typeof body.qty === 'number' ? Math.trunc(body.qty) : NaN;
    if (!bomId) return jsonError(400, 'bom_id_required');
    // Malformed UUID definitively doesn't exist — return 404 (consistent with cross-tenant philosophy).
    if (!UUID_RE.test(bomId)) return jsonError(404, 'bom_not_found');
    if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'qty_required');

    const sql = db();
    const owned = (await sql`
      SELECT id FROM public.boms WHERE id = ${bomId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as any[];
    if (!owned[0]) return jsonError(404, 'bom_not_found');

    const rows = (await sql`
      INSERT INTO public.production_orders (client_id, bom_id, qty, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${bomId}::uuid, ${qty}::int, ${a.ctx.userNodeId}::uuid)
      RETURNING id, status
    `) as Array<{ id: string; status: string }>;
    return jsonOk({ id: rows[0]!.id, status: rows[0]!.status }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
