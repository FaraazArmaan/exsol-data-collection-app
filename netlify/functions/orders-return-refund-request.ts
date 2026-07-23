import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/returns/:id/refund-request', method: 'POST' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, ['orders.business.create']);
  if (!a.ok) return a.res;
  const caseId = new URL(req.url).pathname.split('/').slice(-2, -1)[0] ?? '';
  if (!UUID.test(caseId)) return jsonError(404, 'not_found');
  let body: { return_line_id?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
  const lineId = typeof body.return_line_id === 'string' ? body.return_line_id : '';
  if (!UUID.test(lineId)) return jsonError(400, 'invalid_body');
  const sql = db();
  const lines = await sql`SELECT line.id,line.qty,line.refund_id,c.sale_id,sale.qty AS sale_qty,sale.line_total_cents FROM public.orders_return_case_lines line JOIN public.orders_return_cases c ON c.id=line.return_case_id JOIN public.sale_lines sale ON sale.id=line.sale_line_id WHERE line.id=${lineId}::uuid AND line.return_case_id=${caseId}::uuid AND c.client_id=${a.ctx.clientId}::uuid AND c.status IN ('authorized','awaiting_receipt') AND line.inventory_return_id IS NOT NULL LIMIT 1` as Array<{id:string;qty:number;refund_id:string|null;sale_id:string;sale_qty:number;line_total_cents:number}>;
  const line = lines[0];
  if (!line) return jsonError(409, 'refund_not_requestable');
  if (line.refund_id) {
    const existing = await sql`SELECT * FROM public.orders_refunds WHERE id=${line.refund_id}::uuid`;
    if (!existing[0]) throw new Error('return_refund_link_missing');
    return jsonOk({ ...existing[0], amount_cents: Number(existing[0].amount_cents) });
  }
  const amount = Math.round(Number(line.line_total_cents) * Number(line.qty) / Number(line.sale_qty));
  const rows = await sql`INSERT INTO public.orders_refunds (client_id,sale_id,amount_cents,reason,requested_by) VALUES (${a.ctx.clientId}::uuid,${line.sale_id}::uuid,${amount},${typeof body.reason === 'string' ? body.reason : null},${a.ctx.userNodeId}::uuid) RETURNING *`;
  const refund = rows[0];
  if (!refund) throw new Error('return_refund_insert_missing');
  await sql`UPDATE public.orders_return_case_lines SET refund_id=${refund.id}::uuid WHERE id=${lineId}::uuid`;
  await logAudit(sql, { session: ordersAuditSession(a.ctx), op: 'orders.return.refund_requested', clientId: a.ctx.clientId, targetType: 'orders_return_case', targetId: caseId, detail: { return_line_id: lineId, refund_id: String(refund.id), amount_cents: amount } });
  return jsonOk({ ...refund, amount_cents: Number(refund.amount_cents) }, { status: 201 });
}
