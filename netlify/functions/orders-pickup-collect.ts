import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/pickups/:id/collect', method: 'POST' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;
  const id = new URL(req.url).pathname.split('/').slice(-2, -1)[0] ?? '';
  if (!UUID.test(id)) return jsonError(404, 'not_found');
  let body: { collector_name?: unknown; collector_phone_last4?: unknown; idempotency_key?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
  const name = typeof body.collector_name === 'string' ? body.collector_name.trim() : '';
  const last4 = typeof body.collector_phone_last4 === 'string' ? body.collector_phone_last4.trim() : '';
  const key = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
  if (!name || name.length > 120 || !/^\d{4}$/.test(last4) || !key) return jsonError(400, 'invalid_body');
  const sql = db();
  const duplicate = await sql`SELECT * FROM public.orders_pickup_handoffs WHERE client_id=${a.ctx.clientId}::uuid AND collection_idempotency_key=${key} LIMIT 1`;
  if (duplicate[0]) return jsonOk(duplicate[0]);
  const rows = await sql`UPDATE public.orders_pickup_handoffs AS pickup SET status='collected',collected_at=now(),collected_by=${a.ctx.userNodeId}::uuid,collector_name=${name},collector_phone_last4=${last4},collection_idempotency_key=${key} WHERE pickup.id=${id}::uuid AND pickup.client_id=${a.ctx.clientId}::uuid AND pickup.status='ready' AND EXISTS (SELECT 1 FROM public.orders_fulfillments AS fulfillment WHERE fulfillment.sale_id=pickup.sale_id) AND NOT EXISTS (SELECT 1 FROM public.orders_fulfillments AS fulfillment WHERE fulfillment.sale_id=pickup.sale_id AND fulfillment.status <> 'fulfilled') RETURNING pickup.*`;
  if (!rows[0]) return jsonError(409, 'pickup_not_collectable');
  await logAudit(sql,{session:ordersAuditSession(a.ctx),op:'orders.pickup.collected',clientId:a.ctx.clientId,targetType:'orders_pickup_handoff',targetId:id,detail:{sale_id:rows[0].sale_id}});
  return jsonOk(rows[0]);
}
