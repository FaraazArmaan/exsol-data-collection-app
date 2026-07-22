import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/pickups', method: ['GET', 'POST'] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, [req.method === 'POST' ? 'orders.business.create' : 'orders.business.view']);
  if (!a.ok) return a.res;
  const sql = db();
  if (req.method === 'GET') {
    const rows = await sql`SELECT p.*, s.order_no, s.customer_name FROM public.orders_pickup_handoffs p JOIN public.sales s ON s.id=p.sale_id WHERE p.client_id=${a.ctx.clientId}::uuid ORDER BY p.ready_at DESC`;
    return jsonOk(rows);
  }
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: { sale_id?: unknown; idempotency_key?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
  const saleId = typeof body.sale_id === 'string' ? body.sale_id : '';
  const key = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
  if (!UUID.test(saleId) || !key) return jsonError(400, 'invalid_body');
  const existing = await sql`SELECT * FROM public.orders_pickup_handoffs WHERE client_id=${a.ctx.clientId}::uuid AND ready_idempotency_key=${key} LIMIT 1`;
  if (existing[0]) return jsonOk(existing[0]);
  const sale = await sql`SELECT id, channel, status FROM public.sales WHERE id=${saleId}::uuid AND bucket_id=${a.ctx.clientId}::uuid LIMIT 1` as Array<{ id:string; channel:string; status:string }>;
  if (!sale[0]) return jsonError(404, 'sale_not_found');
  if (sale[0].channel !== 'pickup') return jsonError(409, 'pickup_not_required');
  const readiness = await sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='packed')::int AS packed FROM public.orders_fulfillments WHERE client_id=${a.ctx.clientId}::uuid AND sale_id=${saleId}::uuid` as Array<{ total:number; packed:number }>;
  if (!readiness[0] || Number(readiness[0].total) === 0 || Number(readiness[0].total) !== Number(readiness[0].packed)) return jsonError(409, 'fulfillment_not_ready');
  try {
    const rows = await sql`INSERT INTO public.orders_pickup_handoffs (client_id,sale_id,ready_by,ready_idempotency_key) VALUES (${a.ctx.clientId}::uuid,${saleId}::uuid,${a.ctx.userNodeId}::uuid,${key}) RETURNING *`;
    const created = rows[0];
    if (!created) throw new Error('pickup_insert_missing');
    await logAudit(sql,{session:ordersAuditSession(a.ctx),op:'orders.pickup.ready',clientId:a.ctx.clientId,targetType:'sale',targetId:saleId,detail:{pickup_id:String(created.id)}});
    return jsonOk(created,{status:201});
  } catch (error: any) { if (error?.code === '23505') return jsonError(409, 'pickup_already_ready'); throw error; }
}
