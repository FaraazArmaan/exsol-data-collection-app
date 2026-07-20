// POST /api/procurement/orders/:id/transition — advance a PO through its FSM.
// Body: { action: 'order' | 'approve' | 'reject' | 'receive' | 'cancel' }.
//   draft --order--> ordered            (total < threshold, or threshold = 0)
//   draft --order--> pending_approval    (total >= per-client threshold)
//   pending_approval --approve--> ordered   (stamps approved_by/at)
//   pending_approval --reject-->  draft     (clears submitted_at)
//   draft/ordered --receive--> received  (increments inventory + 'purchase' movements)
//   draft/ordered/pending_approval --cancel--> cancelled
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/orders/:id/transition', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Action = 'order' | 'approve' | 'reject' | 'receive' | 'cancel';
const ACTIONS: readonly Action[] = ['order', 'approve', 'reject', 'receive', 'cancel'];
const PERM: Record<Action, string> = {
  order: 'procurement.products.edit',
  approve: 'procurement.products.edit',
  reject: 'procurement.products.edit',
  receive: 'procurement.products.edit',
  cancel: 'procurement.products.delete',
};
const FROM: Record<Action, string[]> = {
  order: ['draft'],
  approve: ['pending_approval'],
  reject: ['pending_approval'],
  receive: ['draft', 'ordered'],
  cancel: ['draft', 'ordered', 'pending_approval'],
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const segments = new URL(req.url).pathname.split('/');
  const id = segments[segments.length - 2] ?? '';
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  let body: { action?: unknown };
  try {
    body = (await req.json()) as { action?: unknown };
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) return jsonError(400, 'invalid_action');

  const a = await requireProcurement(req, [PERM[action]]);
  if (!a.ok) return a.res;

  const sql = db();
  const orders = (await sql`
    SELECT id, status FROM public.purchase_orders
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string }>;
  const po = orders[0];
  if (!po) return jsonError(404, 'not_found');
  if (!FROM[action].includes(po.status)) return jsonError(409, 'illegal_transition', { from: po.status });

  if (action === 'order') {
    // Threshold-aware: over the client's PO approval threshold routes to approval.
    const agg = (await sql`
      SELECT coalesce(sum(qty * unit_cost_cents), 0)::bigint AS total
      FROM public.purchase_order_items WHERE purchase_order_id = ${id}::uuid
    `) as Array<{ total: string }>;
    const cl = (await sql`
      SELECT po_approval_threshold_cents FROM public.clients WHERE id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<{ po_approval_threshold_cents: string }>;
    const total = Number(agg[0]?.total ?? 0);
    const threshold = Number(cl[0]?.po_approval_threshold_cents ?? 0);
    if (threshold > 0 && total >= threshold) {
      await sql`
        UPDATE public.purchase_orders SET status = 'pending_approval'::purchase_order_status, submitted_at = now()
        WHERE id = ${id}::uuid
      `;
      return jsonOk({ id, status: 'pending_approval', requires_approval: true });
    }
    await sql`
      UPDATE public.purchase_orders SET status = 'ordered'::purchase_order_status WHERE id = ${id}::uuid
    `;
    return jsonOk({ id, status: 'ordered' });
  }

  if (action === 'approve') {
    await sql`
      UPDATE public.purchase_orders
      SET status = 'ordered'::purchase_order_status, approved_by = ${a.ctx.userNodeId}::uuid, approved_at = now()
      WHERE id = ${id}::uuid
    `;
    return jsonOk({ id, status: 'ordered' });
  }

  if (action === 'reject') {
    await sql`
      UPDATE public.purchase_orders SET status = 'draft'::purchase_order_status, submitted_at = NULL
      WHERE id = ${id}::uuid
    `;
    return jsonOk({ id, status: 'draft' });
  }

  if (action === 'cancel') {
    await sql`
      UPDATE public.purchase_orders SET status = 'cancelled'::purchase_order_status WHERE id = ${id}::uuid
    `;
    return jsonOk({ id, status: 'cancelled' });
  }

  // receive: increment inventory_stock + write 'purchase' movements + stamp PO.
  const items = (await sql`
    SELECT product_id, qty FROM public.purchase_order_items WHERE purchase_order_id = ${id}::uuid
  `) as Array<{ product_id: string; qty: number }>;

  const queries = [];
  for (const it of items) {
    queries.push(sql`
      INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand)
      VALUES (${a.ctx.clientId}::uuid, ${it.product_id}::uuid, ${it.qty}::int)
      ON CONFLICT (client_id, product_id) WHERE variant_id IS NULL
      DO UPDATE SET qty_on_hand = public.inventory_stock.qty_on_hand + ${it.qty}::int,
                    updated_at = now()
    `);
    queries.push(sql`
      INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${it.product_id}::uuid, ${it.qty}::int, 'purchase', ${`po:${id}`}, ${a.ctx.userNodeId}::uuid)
    `);
  }
  queries.push(sql`
    UPDATE public.purchase_orders SET status = 'received'::purchase_order_status, received_at = now()
    WHERE id = ${id}::uuid
  `);
  await sql.transaction(queries);

  return jsonOk({ id, status: 'received', received_items: items.length });
}
