// POST /api/orders/backorder-fulfill/:id — partially or fully fulfil a backorder.
//
// Body: { qty: int > 0 }
// Flow:
//   1. Load backorder scoped by client (404 on miss or bad UUID).
//   2. Validate qty <= remaining (400 qty_exceeds_remaining).
//   3. Pre-check stock: SELECT qty_on_hand; missing row or qty_on_hand < qty → 409
//      insufficient_stock — write NOTHING (proves stock was checked before any write).
//   4. sql.transaction: decrement inventory_stock (no GREATEST clamp; 23514 → 409),
//      insert stock_movements, update orders_backorders qty_fulfilled + status + fulfilled_at.
//   5. logAudit op orders.backorder.fulfil.
//   6. Return { id, status, qty_fulfilled }.
//
// Mirrors manufacturing-order-advance.ts for the stock-consume pattern.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/backorder-fulfill/:id', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;
  const { clientId, userNodeId } = a.ctx;

  let body: { qty?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const qty = body.qty;
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1) {
    return jsonError(400, 'invalid_qty');
  }

  const sql = db();

  // 1. Load backorder scoped by client
  const boRows = (await sql`
    SELECT id, product_id, qty_ordered, qty_fulfilled, status
    FROM public.orders_backorders
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; product_id: string; qty_ordered: number; qty_fulfilled: number; status: string }>;
  if (!boRows[0]) return jsonError(404, 'not_found');
  const bo = boRows[0];
  const qtyOrdered = Number(bo.qty_ordered);
  const qtyFulfilled = Number(bo.qty_fulfilled);
  const remaining = qtyOrdered - qtyFulfilled;

  // 2. qty > remaining → 400
  if (qty > remaining) return jsonError(400, 'qty_exceeds_remaining', { remaining });

  const productId = bo.product_id;

  // 3. Pre-check stock — read before any write; missing row or insufficient → 409
  const stockRows = (await sql`
    SELECT qty_on_hand FROM public.inventory_stock
    WHERE client_id = ${clientId}::uuid AND product_id = ${productId}::uuid
    LIMIT 1
  `) as Array<{ qty_on_hand: number | string }>;
  const have = stockRows[0] ? Number(stockRows[0].qty_on_hand) : 0;
  if (have < qty) {
    return jsonError(409, 'insufficient_stock', { have, need: qty });
  }

  // 4. Atomic transaction: decrement stock + movement + update backorder
  const ref = 'backorder:' + id;
  const newQtyFulfilled = qtyFulfilled + qty;
  const newStatus = newQtyFulfilled >= qtyOrdered ? 'fulfilled' : 'partially_fulfilled';

  try {
    await sql.transaction([
      sql`UPDATE public.inventory_stock
          SET qty_on_hand = qty_on_hand - ${qty}::int, updated_at = now()
          WHERE client_id = ${clientId}::uuid AND product_id = ${productId}::uuid`,
      sql`INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
          VALUES (${clientId}::uuid, ${productId}::uuid, ${-qty}::int, 'sale', ${ref}, ${userNodeId}::uuid)`,
      sql`UPDATE public.orders_backorders
          SET qty_fulfilled = qty_fulfilled + ${qty}::int,
              status = CASE
                WHEN qty_fulfilled + ${qty}::int >= qty_ordered THEN 'fulfilled'::backorder_status
                ELSE 'partially_fulfilled'::backorder_status
              END,
              fulfilled_at = CASE
                WHEN qty_fulfilled + ${qty}::int >= qty_ordered THEN now()
                ELSE fulfilled_at
              END,
              updated_at = now()
          WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid`,
    ]);
  } catch (e: any) {
    if (e?.code === '23514') return jsonError(409, 'insufficient_stock', { have: 0, need: qty });
    throw e;
  }

  // 5. Audit
  await logAudit(sql, {
    session: ordersAuditSession(a.ctx),
    op: 'orders.backorder.fulfil',
    clientId,
    targetType: 'orders_backorder',
    targetId: id,
    detail: { qty },
  });

  // 6. Return updated state
  return jsonOk({ id, status: newStatus, qty_fulfilled: newQtyFulfilled });
}
