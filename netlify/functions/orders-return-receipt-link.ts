import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/returns/:id/receipt-link', method: 'POST' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;
  const caseId = new URL(req.url).pathname.split('/').slice(-2, -1)[0] ?? '';
  if (!UUID.test(caseId)) return jsonError(404, 'not_found');
  let body: { return_line_id?: unknown; inventory_return_id?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
  const lineId = typeof body.return_line_id === 'string' ? body.return_line_id : '';
  const inventoryId = typeof body.inventory_return_id === 'string' ? body.inventory_return_id : '';
  if (!UUID.test(lineId) || !UUID.test(inventoryId)) return jsonError(400, 'invalid_body');
  const sql = db();
  const rows = await sql`
    UPDATE public.orders_return_case_lines AS line
    SET inventory_return_id=${inventoryId}::uuid
    FROM public.orders_return_cases AS c, public.sale_lines AS sale, public.inventory_returns AS inventory
    WHERE line.id=${lineId}::uuid
      AND line.return_case_id=${caseId}::uuid
      AND c.id=line.return_case_id
      AND sale.id=line.sale_line_id
      AND inventory.id=${inventoryId}::uuid
      AND c.client_id=${a.ctx.clientId}::uuid
      AND c.status IN ('authorized','awaiting_receipt')
      AND inventory.client_id=${a.ctx.clientId}::uuid
      AND inventory.product_id=sale.product_id
      AND inventory.qty=line.qty
      AND line.inventory_return_id IS NULL
    RETURNING line.*
  `;
  if (!rows[0]) return jsonError(409, 'receipt_not_linkable');
  await logAudit(sql, {
    session: ordersAuditSession(a.ctx), op: 'orders.return.inventory_linked', clientId: a.ctx.clientId,
    targetType: 'orders_return_case', targetId: caseId,
    detail: { return_line_id: lineId, inventory_return_id: inventoryId },
  });
  return jsonOk(rows[0]);
}
