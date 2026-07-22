import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';
import { randomUUID } from 'node:crypto';

export const config = { path: '/api/orders/cancel-remaining/:saleId', method: 'POST' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  const saleId = new URL(req.url).pathname.split('/').pop() ?? '';
  if (!UUID.test(saleId)) return jsonError(404, 'not_found');
  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;
  let body: { sale_line_ids?: unknown; reason?: unknown; idempotency_key?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
  const ids = Array.isArray(body.sale_line_ids) ? body.sale_line_ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)) : [];
  const key = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
  if (!ids.length || ids.length !== new Set(ids).size || !key) return jsonError(400, 'invalid_body');
  const sql = db();
  const sale = await sql`SELECT id FROM public.sales WHERE id = ${saleId}::uuid AND bucket_id = ${a.ctx.clientId}::uuid LIMIT 1` as Array<{ id: string }>;
  if (!sale[0]) return jsonError(404, 'not_found');
  const lines = await sql`
    SELECT sl.id, sl.qty, sl.line_total_cents, r.id AS reservation_id, r.qty AS reserved_qty, r.qty_consumed, r.status
    FROM public.sale_lines sl
    JOIN public.inventory_reservations r ON r.sale_line_id = sl.id
    WHERE sl.sale_id = ${saleId}::uuid AND sl.id = ANY(${ids}::uuid[])
    FOR UPDATE
  ` as Array<{ id:string; qty:number; line_total_cents:number; reservation_id:string|null; reserved_qty:number|null; qty_consumed:number|null; status:string|null }>;
  if (lines.length !== ids.length) return jsonError(409, 'invalid_sale_line');
  const shipped = await sql`SELECT 1 FROM public.orders_fulfillment_lines fl JOIN public.orders_fulfillments f ON f.id = fl.fulfillment_id WHERE f.sale_id = ${saleId}::uuid AND f.status = 'shipped' AND fl.sale_line_id = ANY(${ids}::uuid[]) LIMIT 1`;
  if (shipped[0]) return jsonError(409, 'fulfillment_already_shipped');
  if (lines.some((l) => !l.reservation_id || l.status !== 'reserved' || Number(l.reserved_qty) <= Number(l.qty_consumed))) return jsonError(409, 'no_cancellable_quantity');
  const duplicate = await sql`SELECT 1 FROM public.orders_fulfillment_cancellations WHERE client_id=${a.ctx.clientId}::uuid AND idempotency_key=${key} LIMIT 1`;
  if (duplicate[0]) return jsonError(409, 'duplicate_request');
  const cancellationId = randomUUID();
  const reason = typeof body.reason === 'string' ? body.reason : null;
  let amount = 0;
  const queries = [sql`INSERT INTO public.orders_fulfillment_cancellations (id,client_id,sale_id,reason,idempotency_key,created_by) VALUES (${cancellationId}::uuid,${a.ctx.clientId}::uuid,${saleId}::uuid,${reason},${key},${a.ctx.userNodeId}::uuid)`];
  for (const line of lines) {
    const qty = Number(line.reserved_qty) - Number(line.qty_consumed);
    const cents = Math.round(Number(line.line_total_cents) * qty / Number(line.qty)); amount += cents;
    queries.push(sql`INSERT INTO public.orders_fulfillment_cancellation_lines (cancellation_id,sale_line_id,qty,refund_amount_cents) VALUES (${cancellationId}::uuid,${line.id}::uuid,${qty},${cents})`);
    queries.push(sql`UPDATE public.inventory_stock s SET qty_reserved = s.qty_reserved - ${qty}, updated_at = now() FROM public.inventory_reservations r WHERE r.id = ${line.reservation_id}::uuid AND r.status = 'reserved' AND s.client_id = ${a.ctx.clientId}::uuid AND s.product_id = r.product_id AND s.variant_id IS NOT DISTINCT FROM r.variant_id`);
    queries.push(sql`UPDATE public.inventory_reservations SET status = 'released', released_at = now() WHERE id = ${line.reservation_id}::uuid AND status = 'reserved'`);
  }
  queries.push(sql`UPDATE public.orders_fulfillments AS fulfillment SET status='cancelled'::fulfillment_status, updated_at=now() WHERE fulfillment.sale_id=${saleId}::uuid AND fulfillment.client_id=${a.ctx.clientId}::uuid AND fulfillment.status IN ('pending','picked','packed') AND NOT EXISTS (SELECT 1 FROM public.orders_fulfillment_lines AS fulfillment_line WHERE fulfillment_line.fulfillment_id=fulfillment.id AND NOT (fulfillment_line.sale_line_id = ANY(${ids}::uuid[])))`);
  queries.push(sql`INSERT INTO public.orders_refunds (client_id,sale_id,amount_cents,reason,requested_by,cancellation_id) VALUES (${a.ctx.clientId}::uuid,${saleId}::uuid,${amount},${reason},${a.ctx.userNodeId}::uuid,${cancellationId}::uuid)`);
  try {
    await sql.transaction(queries);
  } catch (error: any) {
    if (error?.code === '23505') return jsonError(409, 'duplicate_request');
    throw error;
  }
  await logAudit(sql,{session:ordersAuditSession(a.ctx),op:'orders.fulfillment.remaining_cancelled',clientId:a.ctx.clientId,targetType:'sale',targetId:saleId,detail:{cancellation_id:cancellationId,amount_cents:amount}});
  return jsonOk({ cancellation_id:cancellationId, refund_amount_cents:amount });
}
