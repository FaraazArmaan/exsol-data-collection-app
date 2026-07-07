// GET /api/warehouse/products — the client's physical products (id, name, sku) for
// warehouse pickers (ASN lines, AI slotting). Gated by warehouse.products.view so
// warehouse-only users don't need an inventory grant. (warehouse.products.view)
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/products', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.products.view']);
  if (!a.ok) return a.res;
  const sql = db();
  const rows = (await sql`
    SELECT id AS product_id, name AS product_name, sku
    FROM public.products
    WHERE client_id = ${a.ctx.clientId}::uuid AND type = 'physical' AND deleted_at IS NULL
    ORDER BY name ASC
  `) as unknown[];
  return jsonOk({ products: rows });
}
