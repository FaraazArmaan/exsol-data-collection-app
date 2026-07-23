import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders } from './_orders-authz';
import { createOrdersReturnCase } from './_orders-return-cases';

export const config = { path: '/api/orders/returns', method: ['GET', 'POST'] };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, [req.method === 'POST' ? 'orders.business.create' : 'orders.business.view']);
  if (!a.ok) return a.res;
  const sql = db();

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT c.*, s.order_no, s.customer_name,
        COALESCE(json_agg(json_build_object(
          'id', l.id,
          'sale_line_id', l.sale_line_id,
          'qty', l.qty,
          'reason', l.reason,
          'inventory_return_id', l.inventory_return_id,
          'refund_id', l.refund_id,
          'refund_state', refund.state,
          'provider_refund_status', provider.status
        )) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
      FROM public.orders_return_cases c
      JOIN public.sales s ON s.id=c.sale_id
      LEFT JOIN public.orders_return_case_lines l ON l.return_case_id=c.id
      LEFT JOIN public.orders_refunds refund ON refund.id=l.refund_id
      LEFT JOIN LATERAL (
        SELECT status
        FROM public.payment_transactions
        WHERE orders_refund_id=refund.id AND kind='provider_refunded'
        ORDER BY created_at DESC
        LIMIT 1
      ) provider ON true
      WHERE c.client_id=${a.ctx.clientId}::uuid
      GROUP BY c.id, s.order_no, s.customer_name
      ORDER BY c.created_at DESC
    `;
    return jsonOk(rows);
  }
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
  const result = await createOrdersReturnCase(a.ctx, body);
  if (!result.ok) return jsonError(result.status, result.code);
  return jsonOk(result.returnCase, { status: result.created ? 201 : 200 });
}
