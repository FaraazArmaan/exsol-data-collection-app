// POST /api/manufacturing/order-advance/:id — drive the production-order FSM.
// planned→in_progress→done, planned/in_progress→cancelled; done/cancelled terminal.
// Completing (→done) consumes component stock and produces output stock in one
// transaction, recording type='production' movements. Insufficient component
// stock is rejected (409) with a shortfall list — nothing is written and the
// order stays in_progress. The inventory_stock qty_on_hand>=0 CHECK is the
// concurrency backstop (23514 → 409).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/order-advance/:id', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

const LEGAL: Record<string, string[]> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const a = await requireManufacturing(req, ['manufacturing.products.edit']);
  if (!a.ok) return a.res;

  let body: { to?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
  const to = typeof body.to === 'string' ? body.to : '';
  if (!['in_progress', 'done', 'cancelled'].includes(to)) return jsonError(400, 'invalid_to');

  const sql = db();
  const orderRows = (await sql`
    SELECT po.id, po.status, po.qty, po.bom_id, b.output_product_id
    FROM public.production_orders po
    JOIN public.boms b ON b.id = po.bom_id
    WHERE po.id = ${id}::uuid AND po.client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string; qty: number; bom_id: string; output_product_id: string }>;
  if (!orderRows[0]) return jsonError(404, 'not_found');
  const order = orderRows[0];

  if (!(LEGAL[order.status] ?? []).includes(to)) {
    return jsonError(409, 'illegal_transition', { from: order.status, to });
  }

  // Non-completing transitions: status flip only.
  if (to !== 'done') {
    await sql`
      UPDATE public.production_orders SET status = ${to}::production_order_status, updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    `;
    return jsonOk({ id, status: to });
  }

  // Completing: gather component requirements and current stock.
  const comps = (await sql`
    SELECT bc.component_product_id, bc.qty, p.name
    FROM public.bom_components bc
    JOIN public.products p ON p.id = bc.component_product_id
    WHERE bc.bom_id = ${order.bom_id}::uuid
  `) as Array<{ component_product_id: string; qty: number; name: string }>;
  const need = comps.map((c) => ({ product_id: c.component_product_id, name: c.name, need: c.qty * order.qty }));
  const productIds = need.map((n) => n.product_id);

  const stockRows = (await sql`
    SELECT product_id, qty_on_hand FROM public.inventory_stock
    WHERE client_id = ${a.ctx.clientId}::uuid AND product_id = ANY(${productIds}::uuid[])
  `) as Array<{ product_id: string; qty_on_hand: number }>;
  const stockMap = new Map(stockRows.map((r) => [r.product_id, r.qty_on_hand]));

  const shortfalls = need
    .filter((n) => (stockMap.get(n.product_id) ?? 0) < n.need)
    .map((n) => ({ product_id: n.product_id, name: n.name, need: n.need, have: stockMap.get(n.product_id) ?? 0 }));
  if (shortfalls.length > 0) return jsonError(409, 'insufficient_stock', { shortfalls });

  // Atomic consume + produce + complete. No GREATEST clamp — the qty>=0 CHECK
  // aborts the txn if a concurrent op drained stock (23514 → 409).
  const queries = [];
  for (const n of need) {
    queries.push(sql`
      UPDATE public.inventory_stock SET qty_on_hand = qty_on_hand - ${n.need}::int, updated_at = now()
      WHERE client_id = ${a.ctx.clientId}::uuid AND product_id = ${n.product_id}::uuid AND variant_id IS NULL
    `);
    queries.push(sql`
      INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${n.product_id}::uuid, ${-n.need}::int, 'production', ${order.id}, ${a.ctx.userNodeId}::uuid)
    `);
  }
  queries.push(sql`
    INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand)
    VALUES (${a.ctx.clientId}::uuid, ${order.output_product_id}::uuid, ${order.qty}::int)
    ON CONFLICT (client_id, product_id) WHERE variant_id IS NULL
    DO UPDATE SET qty_on_hand = public.inventory_stock.qty_on_hand + ${order.qty}::int, updated_at = now()
  `);
  queries.push(sql`
    INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
    VALUES (${a.ctx.clientId}::uuid, ${order.output_product_id}::uuid, ${order.qty}::int, 'production', ${order.id}, ${a.ctx.userNodeId}::uuid)
  `);
  // Optimistic guard: only flip a still-in_progress order to done. NOTE (v1 limitation):
  // this keeps the order status monotonic but does NOT by itself prevent a truly
  // concurrent second `to:'done'` from double-consuming stock — the losing request's
  // component decrements would still commit. Full prevention needs SELECT ... FOR UPDATE
  // row-locking on the order, deferred as a hardening pass (not reachable via the
  // sequential UI, which 409s the second click as an illegal transition).
  queries.push(sql`
    UPDATE public.production_orders SET status = 'done', completed_at = now(), updated_at = now()
    WHERE id = ${order.id}::uuid AND client_id = ${a.ctx.clientId}::uuid AND status = 'in_progress'
  `);

  try {
    await sql.transaction(queries);
  } catch (e: any) {
    if (e?.code === '23514') return jsonError(409, 'insufficient_stock', { shortfalls: [] });
    throw e;
  }
  return jsonOk({ id, status: 'done' });
}
