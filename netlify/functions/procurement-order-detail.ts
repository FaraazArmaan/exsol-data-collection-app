// GET /api/procurement/orders/:id — one PO with supplier + line items.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/orders/:id', method: 'GET' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireProcurement(req, ['procurement.products.view']);
  if (!a.ok) return a.res;

  const id = new URL(req.url).pathname.split('/').pop() ?? '';
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const sql = db();
  const orders = (await sql`
    SELECT po.id, po.status,
           to_char(po.expected_on, 'YYYY-MM-DD') AS expected_on,
           po.received_at, po.notes, po.created_at,
           po.supplier_id, s.name AS supplier_name
    FROM public.purchase_orders po
    JOIN public.suppliers s ON s.id = po.supplier_id
    WHERE po.id = ${id}::uuid AND po.client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  if (orders.length === 0) return jsonError(404, 'not_found');

  const items = (await sql`
    SELECT poi.id, poi.product_id, p.name AS product_name, poi.qty, poi.unit_cost_cents
    FROM public.purchase_order_items poi
    JOIN public.products p ON p.id = poi.product_id
    WHERE poi.purchase_order_id = ${id}::uuid
    ORDER BY p.name ASC
  `) as unknown[];

  return jsonOk({ order: orders[0], items });
}
