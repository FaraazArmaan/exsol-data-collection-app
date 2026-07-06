// POST /api/procurement/orders/:id/transition — advance a PO through its FSM.
// Body: { action: 'order' | 'receive' | 'cancel' }.
//   draft   --order-->   ordered
//   draft   --receive--> received   (a draft may be received directly)
//   ordered --receive--> received
//   draft/ordered --cancel--> cancelled
// Receiving is the money transition: for each line item it increments
// inventory_stock and appends a stock_movements row of type 'purchase', then
// stamps the PO received. All of that runs in one transaction so a partial
// receive can't leave stock and PO status out of sync.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/orders/:id/transition', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Action = 'order' | 'receive' | 'cancel';
const FSM: Record<Action, { from: string[]; to: string; perm: string }> = {
  order:   { from: ['draft'],            to: 'ordered',   perm: 'procurement.products.edit' },
  receive: { from: ['draft', 'ordered'], to: 'received',  perm: 'procurement.products.edit' },
  cancel:  { from: ['draft', 'ordered'], to: 'cancelled', perm: 'procurement.products.delete' },
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // id is the second-to-last segment: /api/procurement/orders/:id/transition
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
  if (action !== 'order' && action !== 'receive' && action !== 'cancel') {
    return jsonError(400, 'invalid_action');
  }
  const rule = FSM[action];

  // Authorize with the verb this action needs.
  const a = await requireProcurement(req, [rule.perm]);
  if (!a.ok) return a.res;

  const sql = db();
  const orders = (await sql`
    SELECT id, status FROM public.purchase_orders
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string }>;
  const po = orders[0];
  if (!po) return jsonError(404, 'not_found');
  if (!rule.from.includes(po.status)) return jsonError(409, 'illegal_transition', { from: po.status });

  if (action !== 'receive') {
    await sql`
      UPDATE public.purchase_orders SET status = ${rule.to}::purchase_order_status
      WHERE id = ${id}::uuid
    `;
    return jsonOk({ id, status: rule.to });
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
      ON CONFLICT (client_id, product_id)
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
