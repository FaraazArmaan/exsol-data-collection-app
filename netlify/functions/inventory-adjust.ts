// POST /api/inventory/adjust — manual stock adjustment with a required reason.
// Body: { product_id: uuid, qty_delta: int (non-zero, +restock / -shrinkage), reason: string }.
// Upserts the stock row (clamped at 0) and appends a type='adjustment' movement
// atomically. The product must belong to the caller's client.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireInventory } from './_inventory-authz';

export const config = { path: '/api/inventory/adjust', method: 'POST' };

interface AdjustBody {
  product_id?: unknown;
  variant_id?: unknown;
  qty_delta?: unknown;
  reason?: unknown;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireInventory(req, ['inventory.products.edit']);
  if (!a.ok) return a.res;

  let body: AdjustBody;
  try {
    body = (await req.json()) as AdjustBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const productId = typeof body.product_id === 'string' ? body.product_id.trim() : '';
  const variantId = typeof body.variant_id === 'string' ? body.variant_id.trim() : null;
  const qtyDelta = typeof body.qty_delta === 'number' ? Math.trunc(body.qty_delta) : NaN;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!productId) return jsonError(400, 'product_id_required');
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) return jsonError(400, 'qty_delta_required');
  if (!reason) return jsonError(400, 'reason_required');

  const sql = db();
  // A variant must prove both its tenant and parent-product relationship. Stock
  // remains an Inventory write; Product Manager only creates the catalog fact.
  const owned = variantId
    ? (await sql`
        SELECT p.id FROM public.product_variants v
        JOIN public.products p ON p.id = v.product_id
        WHERE v.id = ${variantId}::uuid AND v.product_id = ${productId}::uuid
          AND v.client_id = ${a.ctx.clientId}::uuid AND p.deleted_at IS NULL
        LIMIT 1
      `) as Array<{ id: string }>
    : (await sql`
        SELECT id FROM public.products
        WHERE id = ${productId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
        LIMIT 1
      `) as Array<{ id: string }>;
  if (owned.length === 0) return jsonError(404, 'product_not_found');

  // Upsert stock + append movement atomically. A fresh row clamps its starting
  // qty at 0 (a negative opening adjustment can't go below zero).
  const stockWrite = variantId
    ? sql`
      INSERT INTO public.inventory_stock (client_id, product_id, variant_id, qty_on_hand)
      VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${variantId}::uuid, GREATEST(0, ${qtyDelta}::int))
      ON CONFLICT (client_id, variant_id) WHERE variant_id IS NOT NULL
      DO UPDATE SET qty_on_hand = GREATEST(0, public.inventory_stock.qty_on_hand + ${qtyDelta}::int),
                    updated_at = now()
      RETURNING qty_on_hand
    `
    : sql`
      INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand)
      VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, GREATEST(0, ${qtyDelta}::int))
      ON CONFLICT (client_id, product_id) WHERE variant_id IS NULL
      DO UPDATE SET qty_on_hand = GREATEST(0, public.inventory_stock.qty_on_hand + ${qtyDelta}::int),
                    updated_at = now()
      RETURNING qty_on_hand
    `;
  const results = await sql.transaction([
    stockWrite,
    sql`
      INSERT INTO public.stock_movements (client_id, product_id, variant_id, qty_delta, type, ref, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${variantId}::uuid, ${qtyDelta}::int, 'adjustment', ${reason}, ${a.ctx.userNodeId}::uuid)
    `,
  ]);

  const qtyOnHand = (results[0] as Array<{ qty_on_hand: number }>)[0]?.qty_on_hand ?? 0;
  return jsonOk({ product_id: productId, variant_id: variantId, qty_on_hand: qtyOnHand });
}
