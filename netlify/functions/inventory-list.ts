// GET /api/inventory/list?q=<search> — vendor stock list.
// Bucket-scoped; joins inventory_stock → products for name/sku; optional search
// over name/sku; low-stock rows (qty_on_hand <= reorder_level) sort first.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireInventory } from './_inventory-authz';

export const config = { path: '/api/inventory/list', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireInventory(req, ['inventory.products.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const like = `%${q}%`;
  const state = (url.searchParams.get('state') ?? '').trim();

  const sql = db();
  const rows = (await sql`
    SELECT s.product_id,
           p.name,
           p.sku,
           p.unit,
           s.qty_on_hand,
           s.reorder_level,
           s.lifecycle_state,
           (s.qty_on_hand <= s.reorder_level) AS low
    FROM public.inventory_stock s
    JOIN public.products p ON p.id = s.product_id
    WHERE s.client_id = ${a.ctx.clientId}::uuid
      AND s.variant_id IS NULL
      AND p.deleted_at IS NULL
      AND (${q} = '' OR p.name ILIKE ${like} OR coalesce(p.sku, '') ILIKE ${like})
      AND (${state} = '' OR s.lifecycle_state = ${state})
    ORDER BY low DESC, p.name ASC
  `) as unknown[];

  return jsonOk({ items: rows });
}
