import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/returns/:id/advance', method: 'POST' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;
  const id = new URL(req.url).pathname.split('/').slice(-2, -1)[0] ?? '';
  if (!UUID.test(id)) return jsonError(404, 'not_found');
  let body: { to?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
  const to = body.to === 'authorized' || body.to === 'refused' ? body.to : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!to || (to === 'refused' && !reason)) return jsonError(400, 'invalid_body');

  const sql = db();
  const rows = to === 'authorized'
    ? await sql`UPDATE public.orders_return_cases SET status='authorized',authorized_by=${a.ctx.userNodeId}::uuid,authorized_at=now() WHERE id=${id}::uuid AND client_id=${a.ctx.clientId}::uuid AND status='requested' RETURNING *`
    : await sql`UPDATE public.orders_return_cases SET status='refused',refused_by=${a.ctx.userNodeId}::uuid,refused_at=now(),refusal_reason=${reason} WHERE id=${id}::uuid AND client_id=${a.ctx.clientId}::uuid AND status='requested' RETURNING *`;
  if (!rows[0]) return jsonError(409, 'return_not_decidable');
  await logAudit(sql, {
    session: ordersAuditSession(a.ctx), op: `orders.return.${to}`, clientId: a.ctx.clientId,
    targetType: 'orders_return_case', targetId: id, detail: reason ? { reason } : null,
  });
  return jsonOk(rows[0]);
}
