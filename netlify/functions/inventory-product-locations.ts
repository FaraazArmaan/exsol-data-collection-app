// GET /api/inventory/product-locations?product_id=<uuid> — the warehousing
// bridge: one product's stock broken out across warehouse locations, alongside
// its inventory on-hand total (the two are tracked independently by design).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireInventory } from './_inventory-authz';

export const config = { path: '/api/inventory/product-locations', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireInventory(req, ['inventory.products.view']);
  if (!a.ok) return a.res;

  const productId = (new URL(req.url).searchParams.get('product_id') ?? '').trim();
  if (!productId) return jsonError(400, 'product_id_required');

  const cid = a.ctx.clientId;
  const sql = db();

  const stock = (await sql`
    SELECT qty_on_hand FROM public.inventory_stock
    WHERE client_id = ${cid}::uuid AND product_id = ${productId}::uuid AND variant_id IS NULL LIMIT 1
  `) as Array<{ qty_on_hand: number }>;

  const byLocation = (await sql`
    SELECT l.id AS location_id, l.name AS location_name, l.kind AS location_kind, sbl.qty
    FROM public.stock_by_location sbl
    JOIN public.warehouse_locations l ON l.id = sbl.location_id
    WHERE l.client_id = ${cid}::uuid AND sbl.product_id = ${productId}::uuid
    ORDER BY l.name ASC
  `) as Array<{ location_id: string; location_name: string; location_kind: string; qty: number }>;

  const locationTotal = byLocation.reduce((sum, r) => sum + r.qty, 0);

  return jsonOk({
    on_hand: stock[0]?.qty_on_hand ?? 0,
    location_total: locationTotal,
    by_location: byLocation,
  });
}
