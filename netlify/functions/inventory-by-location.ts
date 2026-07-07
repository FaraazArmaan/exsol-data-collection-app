// GET /api/inventory/by-location — stock broken down by warehouse location.
// Reads the warehouse module's warehouse_locations + stock_by_location tables
// (cross-module READ). Works whether or not the warehouse module is enabled —
// with no locations the client just sees an empty map.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireInventory } from './_inventory-authz';

export const config = { path: '/api/inventory/by-location', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireInventory(req, ['inventory.products.view']);
  if (!a.ok) return a.res;

  const cid = a.ctx.clientId;
  const sql = db();

  const locations = (await sql`
    SELECT id, name, kind FROM public.warehouse_locations
    WHERE client_id = ${cid}::uuid
    ORDER BY name ASC
  `) as unknown[];

  const items = (await sql`
    SELECT l.id AS location_id, l.name AS location_name, l.kind AS location_kind,
           sbl.product_id, p.name AS product_name, p.sku, sbl.qty
    FROM public.stock_by_location sbl
    JOIN public.warehouse_locations l ON l.id = sbl.location_id
    JOIN public.products p ON p.id = sbl.product_id
    WHERE l.client_id = ${cid}::uuid AND p.deleted_at IS NULL
    ORDER BY l.name ASC, p.name ASC
  `) as unknown[];

  return jsonOk({ locations, items });
}
