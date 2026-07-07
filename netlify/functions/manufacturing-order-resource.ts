// POST /api/manufacturing/order-resource — schedule a production order onto a
// resource with an hours estimate. Feeds Capacity Planning together with the
// order's due_on. Body: { order_id, resource_id (nullable), estimated_hours }.
// (manufacturing.products.edit — it edits the order)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/order-resource', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body { order_id?: unknown; resource_id?: unknown; estimated_hours?: unknown }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireManufacturing(req, ['manufacturing.products.edit']);
  if (!a.ok) return a.res;

  let body: Body;
  try { body = (await req.json()) as Body; } catch { return jsonError(400, 'invalid_json'); }
  const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : '';
  const resourceId = typeof body.resource_id === 'string' && body.resource_id.trim() ? body.resource_id.trim() : null;
  const hours = typeof body.estimated_hours === 'number' ? Math.max(0, Math.trunc(body.estimated_hours)) : 0;
  if (!UUID_RE.test(orderId)) return jsonError(404, 'order_not_found');
  if (resourceId !== null && !UUID_RE.test(resourceId)) return jsonError(404, 'resource_not_found');

  const sql = db();
  const order = (await sql`
    SELECT id FROM public.production_orders WHERE id = ${orderId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as Array<{ id: string }>;
  if (order.length === 0) return jsonError(404, 'order_not_found');

  if (resourceId !== null) {
    const res = (await sql`
      SELECT id FROM public.manufacturing_resources WHERE id = ${resourceId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<{ id: string }>;
    if (res.length === 0) return jsonError(404, 'resource_not_found');
  }

  await sql`
    UPDATE public.production_orders
    SET resource_id = ${resourceId}::uuid, estimated_hours = ${hours}::int, updated_at = now()
    WHERE id = ${orderId}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `;
  return jsonOk({ order_id: orderId, resource_id: resourceId, estimated_hours: hours });
}
