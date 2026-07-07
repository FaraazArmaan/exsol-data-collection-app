// DELETE /api/pos/bundles/:id — remove a bundle.
//
// The bundle product may already sit on sale_lines (FK RESTRICT), so we never
// hard-delete it: soft-delete the product (deleted_at) — which drops it from the
// storefront menu/catalog — and delete its bundle_items so it stops being a
// bundle. Components (other products) are untouched. Gated on pos.sale.refund.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';

export const config = { path: '/api/pos/bundles/:id' };

function idFromPath(req: Request): string | null {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 1];
  return id && id !== 'bundles' ? id : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'DELETE') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.sale.refund']);
  if (!a.ok) return a.res;
  const id = idFromPath(req);
  if (!id) return jsonError(400, 'missing_id');
  const sql = db();

  // Only proceed if this id is actually a bundle owned by the caller's client.
  const owned = (await sql`
    SELECT 1 FROM public.products p
    WHERE p.id = ${id}::uuid AND p.client_id = ${a.ctx.clientId}::uuid AND p.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.product_bundle_items bi WHERE bi.bundle_product_id = p.id)
  `) as unknown[];
  if (owned.length === 0) return jsonError(404, 'bundle_not_found');

  await sql`DELETE FROM public.product_bundle_items WHERE bundle_product_id = ${id}::uuid`;
  await sql`UPDATE public.products SET deleted_at = now() WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid`;
  return jsonOk({ id });
}
