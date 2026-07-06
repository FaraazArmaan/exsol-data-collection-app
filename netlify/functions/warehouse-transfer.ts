// POST /api/warehouse/transfer — move stock between two of the caller's locations.
// Body: { product_id, from_location_id, to_location_id, qty (positive int) }.
// Decrements the source stock_by_location row, upserts the destination, and appends
// TWO type='transfer' movement rows (-qty and +qty) — net-zero on the product's
// total on-hand, so inventory_stock is intentionally left untouched. Atomic.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/transfer', method: 'POST' };

interface TransferBody {
  product_id?: unknown;
  from_location_id?: unknown;
  to_location_id?: unknown;
  qty?: unknown;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.products.edit']);
  if (!a.ok) return a.res;

  let body: TransferBody;
  try {
    body = (await req.json()) as TransferBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const productId = typeof body.product_id === 'string' ? body.product_id.trim() : '';
  const fromId = typeof body.from_location_id === 'string' ? body.from_location_id.trim() : '';
  const toId = typeof body.to_location_id === 'string' ? body.to_location_id.trim() : '';
  const qty = typeof body.qty === 'number' ? Math.trunc(body.qty) : NaN;

  if (!productId || !fromId || !toId) return jsonError(400, 'fields_required');
  if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'qty_invalid');
  if (fromId === toId) return jsonError(400, 'same_location');

  const sql = db();

  // Ownership: product must belong to the caller's client and be live.
  const product = (await sql`
    SELECT id FROM public.products
    WHERE id = ${productId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
    LIMIT 1
  `) as Array<{ id: string }>;
  if (product.length === 0) return jsonError(404, 'product_not_found');

  // Both locations must belong to the caller's client.
  const locs = (await sql`
    SELECT id FROM public.warehouse_locations
    WHERE id = ANY(${[fromId, toId]}::uuid[]) AND client_id = ${a.ctx.clientId}::uuid
  `) as Array<{ id: string }>;
  if (locs.length !== 2) return jsonError(404, 'location_not_found');

  // Source must hold enough. (The qty >= 0 CHECK is a race-safe backstop below.)
  const src = (await sql`
    SELECT qty FROM public.stock_by_location
    WHERE location_id = ${fromId}::uuid AND product_id = ${productId}::uuid
    LIMIT 1
  `) as Array<{ qty: number }>;
  if (src.length === 0 || src[0]!.qty < qty) return jsonError(400, 'insufficient_stock');

  const ref = `transfer ${fromId} -> ${toId}`;
  try {
    const results = await sql.transaction([
      sql`
        UPDATE public.stock_by_location
        SET qty = qty - ${qty}::int
        WHERE location_id = ${fromId}::uuid AND product_id = ${productId}::uuid
        RETURNING qty
      `,
      sql`
        INSERT INTO public.stock_by_location (location_id, product_id, qty)
        VALUES (${toId}::uuid, ${productId}::uuid, ${qty}::int)
        ON CONFLICT (location_id, product_id)
        DO UPDATE SET qty = public.stock_by_location.qty + ${qty}::int, updated_at = now()
        RETURNING qty
      `,
      sql`
        INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
        VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${-qty}::int, 'transfer', ${ref}, ${a.ctx.userNodeId}::uuid)
      `,
      sql`
        INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
        VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${qty}::int, 'transfer', ${ref}, ${a.ctx.userNodeId}::uuid)
      `,
    ]);
    const fromQty = (results[0] as Array<{ qty: number }>)[0]?.qty ?? 0;
    const toQty = (results[1] as Array<{ qty: number }>)[0]?.qty ?? 0;
    return jsonOk({
      product_id: productId,
      from: { location_id: fromId, qty: fromQty },
      to: { location_id: toId, qty: toQty },
    });
  } catch (e) {
    // Concurrent drain could push the source below zero → CHECK 23514; report cleanly.
    if ((e as { code?: string }).code === '23514') return jsonError(400, 'insufficient_stock');
    throw e;
  }
}
