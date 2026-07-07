// GET /api/warehouse/putaway?status=pending|done|cancelled|all — the putaway queue.
// Joins products for name/sku and the destination location (once confirmed).
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/putaway', method: 'GET' };

const STATUSES = new Set(['pending', 'done', 'cancelled', 'all']);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.products.view']);
  if (!a.ok) return a.res;

  const raw = new URL(req.url).searchParams.get('status') ?? 'pending';
  const status = STATUSES.has(raw) ? raw : 'pending';

  const sql = db();
  const rows = (await sql`
    SELECT t.id, t.product_id, p.name AS product_name, p.sku, t.qty, t.status,
           t.purchase_order_id, t.location_id, l.name AS location_name,
           t.created_at, t.done_at
    FROM public.warehouse_putaway_tasks t
    JOIN public.products p ON p.id = t.product_id
    LEFT JOIN public.warehouse_locations l ON l.id = t.location_id
    WHERE t.client_id = ${a.ctx.clientId}::uuid
      AND (${status} = 'all' OR t.status = ${status})
    ORDER BY t.created_at DESC
  `) as unknown[];

  return jsonOk({ tasks: rows });
}
