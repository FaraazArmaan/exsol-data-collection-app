// GET /api/inventory/movements?product_id=<uuid> — movement ledger for one product.
// Bucket-scoped; most-recent first. Returns the append-only history (sale,
// purchase, adjustment, production, transfer) with delta, reason (ref) and actor.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireInventory } from './_inventory-authz';

export const config = { path: '/api/inventory/movements', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireInventory(req, ['inventory.products.view']);
  if (!a.ok) return a.res;

  const productId = (new URL(req.url).searchParams.get('product_id') ?? '').trim();
  if (!productId) return jsonError(400, 'product_id_required');

  const sql = db();
  const rows = (await sql`
    SELECT m.id,
           m.qty_delta,
           m.type,
           m.ref,
           m.created_by,
           m.created_at
    FROM public.stock_movements m
    WHERE m.client_id = ${a.ctx.clientId}::uuid
      AND m.product_id = ${productId}::uuid
    ORDER BY m.created_at DESC
    LIMIT 200
  `) as unknown[];

  return jsonOk({ movements: rows });
}
