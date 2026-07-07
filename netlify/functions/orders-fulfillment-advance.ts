// POST /api/orders/fulfillment-advance/:id — drive the fulfillment FSM.
//
// FSM: pending→picked→packed→shipped→fulfilled; any-non-terminal→cancelled.
// fulfilled and cancelled are terminal states.
//
// Side effects by transition:
//   picked  → orders_stage_events(stage='picking', source='orders')
//   packed  → orders_stage_events(stage='packing', source='orders')
//   shipped → orders_stage_events(stage='shipped', source='orders')
//   fulfilled →
//     1. Pre-check stock for each fulfillment line; 409 insufficient_stock if any shortfall.
//     2. Atomic sql.transaction:
//        - decrement inventory_stock per line (no GREATEST clamp; 23514 → 409)
//        - insert stock_movements(-qty, 'sale', 'fulfillment:<id>', user)
//        - set status='fulfilled', fulfilled_at=now()
//        - insert orders_stage_events(stage='delivered', source='orders')
//     3. logAudit op='orders.fulfillment.fulfilled'
//
// NOTE (v1 limitation): a truly concurrent second request to fulfil the same
// fulfillment can reach the pre-check simultaneously and both pass. Full prevention
// requires SELECT ... FOR UPDATE row-locking on the fulfillment row — deferred as a
// hardening pass (mirror of manufacturing-order-advance.ts comment, mig 058).
// Additionally, the stock-decrement queries (inventory_stock UPDATE + stock_movements
// INSERT) inside the transaction also lack row-locking — a concurrent race can
// decrement stock twice against the same qty_on_hand snapshot, relying solely on the
// qty_on_hand >= 0 CHECK constraint (23514 → 409 insufficient_stock) as a last-resort
// backstop rather than a true serialisation guard.
// The sequential UI makes this unreachable in practice: the second click 409s as
// an illegal transition (fulfilled is terminal after the first completes).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/fulfillment-advance/:id', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

// Legal FSM transitions for fulfillment_status.
const LEGAL: Readonly<Record<string, readonly string[]>> = {
  pending:   ['picked', 'cancelled'],
  picked:    ['packed', 'cancelled'],
  packed:    ['shipped', 'cancelled'],
  shipped:   ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
};

// Map fulfillment status → order_stage for stage events.
const STAGE_MAP: Readonly<Record<string, string>> = {
  picked:    'picking',
  packed:    'packing',
  shipped:   'shipped',
  fulfilled: 'delivered',
};

const VALID_TARGETS = new Set(['picked', 'packed', 'shipped', 'fulfilled', 'cancelled']);

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;

  let body: { to?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
  const to = typeof body.to === 'string' ? body.to : '';
  if (!VALID_TARGETS.has(to)) return jsonError(400, 'invalid_to');

  const sql = db();

  // Load fulfillment scoped to client.
  const fulfRows = (await sql`
    SELECT id, sale_id, status
    FROM public.orders_fulfillments
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; sale_id: string; status: string }>;
  if (!fulfRows[0]) return jsonError(404, 'not_found');
  const fulfillment = fulfRows[0];

  // FSM guard.
  if (!(LEGAL[fulfillment.status] ?? []).includes(to)) {
    return jsonError(409, 'illegal_transition', { from: fulfillment.status, to });
  }

  const saleId = fulfillment.sale_id;

  // Non-fulfilling transitions — simple status flip + optional stage event.
  if (to !== 'fulfilled') {
    await sql`
      UPDATE public.orders_fulfillments
      SET status = ${to}::fulfillment_status, updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    `;

    const stageName = STAGE_MAP[to];
    if (stageName) {
      await sql`
        INSERT INTO public.orders_stage_events (client_id, sale_id, stage, source)
        VALUES (${a.ctx.clientId}::uuid, ${saleId}::uuid, ${stageName}::order_stage, 'orders')
      `;
    }

    await logAudit(sql, {
      session: ordersAuditSession(a.ctx),
      op: `orders.fulfillment.${to}`,
      clientId: a.ctx.clientId,
      targetType: 'fulfillment',
      targetId: id,
      detail: { from: fulfillment.status, to },
    });

    return jsonOk({ id, status: to });
  }

  // Fulfilling transition: pre-check stock then atomic commit.
  const lineRows = (await sql`
    SELECT fl.sale_line_id, fl.qty, p.id AS product_id, sl.product_name_snap AS name
    FROM public.orders_fulfillment_lines fl
    JOIN public.sale_lines sl ON sl.id = fl.sale_line_id
    JOIN public.products p ON p.id = sl.product_id
    WHERE fl.fulfillment_id = ${id}::uuid
  `) as Array<{ sale_line_id: string; qty: number; product_id: string; name: string }>;

  const productIds = lineRows.map((l) => l.product_id);
  const stockRows = (await sql`
    SELECT product_id, qty_on_hand
    FROM public.inventory_stock
    WHERE client_id = ${a.ctx.clientId}::uuid AND product_id = ANY(${productIds}::uuid[])
  `) as Array<{ product_id: string; qty_on_hand: number }>;
  const stockMap = new Map(stockRows.map((r) => [r.product_id, Number(r.qty_on_hand)]));

  const shortfalls = lineRows
    .filter((l) => (stockMap.get(l.product_id) ?? 0) < l.qty)
    .map((l) => ({
      product_id: l.product_id,
      name: l.name,
      have: stockMap.get(l.product_id) ?? 0,
      need: l.qty,
    }));
  if (shortfalls.length > 0) return jsonError(409, 'insufficient_stock', { shortfalls });

  // Atomic: decrement stock + movements + status flip + stage event.
  // No GREATEST clamp — the qty_on_hand>=0 CHECK is the concurrency backstop (23514 → 409).
  const queries = [];
  const ref = `fulfillment:${id}`;

  for (const l of lineRows) {
    queries.push(sql`
      UPDATE public.inventory_stock
      SET qty_on_hand = qty_on_hand - ${l.qty}::int, updated_at = now()
      WHERE client_id = ${a.ctx.clientId}::uuid AND product_id = ${l.product_id}::uuid
    `);
    queries.push(sql`
      INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${l.product_id}::uuid, ${-l.qty}::int, 'sale', ${ref}, ${a.ctx.userNodeId}::uuid)
    `);
  }

  queries.push(sql`
    UPDATE public.orders_fulfillments
    SET status = 'fulfilled'::fulfillment_status, fulfilled_at = now(), updated_at = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid AND status = 'shipped'
  `);

  queries.push(sql`
    INSERT INTO public.orders_stage_events (client_id, sale_id, stage, source)
    VALUES (${a.ctx.clientId}::uuid, ${saleId}::uuid, 'delivered'::order_stage, 'orders')
  `);

  try {
    await sql.transaction(queries);
  } catch (e: any) {
    if (e?.code === '23514') return jsonError(409, 'insufficient_stock', { shortfalls: [] });
    throw e;
  }

  // Fetch fulfilled_at to include in response.
  const updatedRows = (await sql`
    SELECT fulfilled_at FROM public.orders_fulfillments WHERE id = ${id}::uuid
  `) as Array<{ fulfilled_at: string }>;

  await logAudit(sql, {
    session: ordersAuditSession(a.ctx),
    op: 'orders.fulfillment.fulfilled',
    clientId: a.ctx.clientId,
    targetType: 'fulfillment',
    targetId: id,
    detail: { from: 'shipped', to: 'fulfilled' },
  });

  return jsonOk({ id, status: 'fulfilled', fulfilled_at: updatedRows[0]?.fulfilled_at ?? null });
}
