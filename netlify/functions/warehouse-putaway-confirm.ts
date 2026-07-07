// POST /api/warehouse/putaway-confirm — put a pending task away into a location.
// Body: { task_id, location_id }. Allocates the task qty into stock_by_location and
// writes a net-zero pair of type='transfer' movement rows (receiving-dock → bin),
// so the product's total on-hand is unchanged (receipt already counted it). Atomic.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/putaway-confirm', method: 'POST' };

interface Body {
  task_id?: unknown;
  location_id?: unknown;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.products.edit']);
  if (!a.ok) return a.res;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const taskId = typeof body.task_id === 'string' ? body.task_id.trim() : '';
  const locationId = typeof body.location_id === 'string' ? body.location_id.trim() : '';
  if (!taskId || !locationId) return jsonError(400, 'fields_required');

  const sql = db();
  const task = (await sql`
    SELECT id, product_id, qty, status FROM public.warehouse_putaway_tasks
    WHERE id = ${taskId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as Array<{ id: string; product_id: string; qty: number; status: string }>;
  if (task.length === 0) return jsonError(404, 'task_not_found');
  if (task[0]!.status !== 'pending') return jsonError(409, 'task_not_pending');

  const loc = (await sql`
    SELECT id FROM public.warehouse_locations
    WHERE id = ${locationId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as Array<{ id: string }>;
  if (loc.length === 0) return jsonError(404, 'location_not_found');

  const productId = task[0]!.product_id;
  const qty = task[0]!.qty;
  const ref = `putaway → ${locationId}`;

  await sql.transaction([
    sql`
      INSERT INTO public.stock_by_location (location_id, product_id, qty)
      VALUES (${locationId}::uuid, ${productId}::uuid, ${qty}::int)
      ON CONFLICT (location_id, product_id)
      DO UPDATE SET qty = public.stock_by_location.qty + ${qty}::int, updated_at = now()
    `,
    sql`
      INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${-qty}::int, 'transfer', 'putaway (receiving)', ${a.ctx.userNodeId}::uuid)
    `,
    sql`
      INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${qty}::int, 'transfer', ${ref}, ${a.ctx.userNodeId}::uuid)
    `,
    sql`
      UPDATE public.warehouse_putaway_tasks
      SET status = 'done', location_id = ${locationId}::uuid, done_by = ${a.ctx.userNodeId}::uuid, done_at = now()
      WHERE id = ${taskId}::uuid
    `,
  ]);

  return jsonOk({ task_id: taskId, location_id: locationId, qty });
}
