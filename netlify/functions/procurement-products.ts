// GET /api/procurement/products — physical products for the PO line-item picker.
// Procurement-owned (gated by procurement view) so the create-PO form doesn't
// depend on the caller also holding inventory/products permissions.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/products', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireProcurement(req, ['procurement.products.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const rows = (await sql`
    SELECT id, name, sku
    FROM public.products
    WHERE client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL AND type = 'physical'
    ORDER BY name ASC
  `) as unknown[];
  return jsonOk({ products: rows });
}
