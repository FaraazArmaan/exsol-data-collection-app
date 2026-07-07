// POST /api/warehouse/putaway-generate — enqueue a pending putaway task for every
// received-PO line that doesn't have one yet. Idempotent (partial unique index on
// purchase_order_item_id). Reads Procurement's purchase_orders/items (cross-module
// READ) and writes only to the warehouse-owned putaway table.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/putaway-generate', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.products.edit']);
  if (!a.ok) return a.res;

  const sql = db();
  const created = (await sql`
    INSERT INTO public.warehouse_putaway_tasks
      (client_id, purchase_order_id, purchase_order_item_id, product_id, qty)
    SELECT po.client_id, po.id, poi.id, poi.product_id, poi.qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    WHERE po.client_id = ${a.ctx.clientId}::uuid AND po.status = 'received'
    ON CONFLICT (purchase_order_item_id) WHERE purchase_order_item_id IS NOT NULL DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;

  return jsonOk({ created: created.length });
}
