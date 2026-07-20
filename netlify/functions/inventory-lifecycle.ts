// POST /api/inventory/lifecycle — set a product's inventory lifecycle state.
// Body: { product_id, state: 'active' | 'seasonal' | 'discontinued' }.
// Discontinuing an item requests Product Manager's catalog-publication policy.
// Re-activating does NOT auto-show (an owner may have hidden it deliberately).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireInventory } from './_inventory-authz';
import { applyInventoryLifecyclePublicationPolicy } from './_shared/catalog-publication-policy';

export const config = { path: '/api/inventory/lifecycle', method: 'POST' };

const STATES = ['active', 'seasonal', 'discontinued'] as const;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireInventory(req, ['inventory.products.edit']);
  if (!a.ok) return a.res;

  let body: { product_id?: unknown; state?: unknown };
  try {
    body = (await req.json()) as { product_id?: unknown; state?: unknown };
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const productId = typeof body.product_id === 'string' ? body.product_id.trim() : '';
  const state = typeof body.state === 'string' ? body.state.trim() : '';
  if (!productId) return jsonError(400, 'product_id_required');
  if (!(STATES as readonly string[]).includes(state)) return jsonError(400, 'invalid_state');

  const sql = db();
  const owned = (await sql`
    SELECT id FROM public.products
    WHERE id = ${productId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
    LIMIT 1
  `) as Array<{ id: string }>;
  if (owned.length === 0) return jsonError(404, 'product_not_found');

  await sql`
    INSERT INTO public.inventory_stock (client_id, product_id, lifecycle_state)
    VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${state})
    ON CONFLICT (client_id, product_id) WHERE variant_id IS NULL
    DO UPDATE SET lifecycle_state = ${state}, updated_at = now()
  `;

  const storefrontHidden = await applyInventoryLifecyclePublicationPolicy(
    sql, a.ctx.clientId, productId, state,
  );

  return jsonOk({ product_id: productId, lifecycle_state: state, storefront_hidden: storefrontHidden });
}
