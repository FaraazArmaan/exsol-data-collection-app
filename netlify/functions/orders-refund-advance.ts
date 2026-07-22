// Orders may reject a customer-service refund request. Payments alone submits it to a provider.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/refund-advance/:id', method: 'POST' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split('/').pop() ?? '';
  if (!id) return jsonError(404, 'not_found');
  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;
  let body: { to?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
  const sql = db();
  const refund = await sql`SELECT state FROM public.orders_refunds WHERE id=${id}::uuid AND client_id=${a.ctx.clientId}::uuid LIMIT 1` as Array<{state:string}>;
  if (!refund[0]) return jsonError(404, 'not_found');
  if (body.to !== 'rejected') return jsonError(409, body.to === 'completed' ? 'illegal_transition' : 'payments_refund_submission_required');
  if (refund[0].state !== 'requested') return jsonError(409, 'illegal_transition');
  const rows = await sql`UPDATE public.orders_refunds SET state='rejected'::refund_state WHERE id=${id}::uuid RETURNING id` as Array<{id:string}>;
  await logAudit(sql,{session:ordersAuditSession(a.ctx),op:'orders.refund.rejected',clientId:a.ctx.clientId,targetType:'refund',targetId:id,detail:{to:'rejected'}});
  return jsonOk({ id, state:'rejected', sale_refunded:false });
}
