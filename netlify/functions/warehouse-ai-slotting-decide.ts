// POST /api/warehouse/ai-slotting-decide — human confirms or dismisses a suggestion.
// Body: { suggestion_id, action: 'apply' | 'dismiss' }. Apply runs the real location
// transfer (decrement source, upsert destination, net-zero transfer movement pair)
// then marks the suggestion applied. The AI never moves stock on its own.
// (warehouse.products.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/ai-slotting-decide', method: 'POST' };

interface Body { suggestion_id?: unknown; action?: unknown }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.products.edit']);
  if (!a.ok) return a.res;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const suggestionId = typeof body.suggestion_id === 'string' ? body.suggestion_id.trim() : '';
  const action = body.action === 'apply' || body.action === 'dismiss' ? body.action : null;
  if (!suggestionId) return jsonError(400, 'suggestion_id_required');
  if (!action) return jsonError(400, 'action_invalid');

  const sql = db();
  const rows = (await sql`
    SELECT id, product_id, from_location_id, to_location_id, suggested_qty, status
    FROM public.warehouse_slotting_suggestions
    WHERE id = ${suggestionId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as Array<{ id: string; product_id: string; from_location_id: string; to_location_id: string; suggested_qty: number; status: string }>;
  if (rows.length === 0) return jsonError(404, 'not_found');
  const s = rows[0]!;
  if (s.status !== 'pending') return jsonError(409, 'already_decided');

  if (action === 'dismiss') {
    await sql`
      UPDATE public.warehouse_slotting_suggestions
      SET status = 'dismissed', decided_by = ${a.ctx.userNodeId}::uuid, decided_at = now()
      WHERE id = ${suggestionId}::uuid
    `;
    return jsonOk({ suggestion_id: suggestionId, status: 'dismissed' });
  }

  // apply → verify the source still holds enough, then transfer atomically.
  const src = (await sql`
    SELECT qty FROM public.stock_by_location
    WHERE location_id = ${s.from_location_id}::uuid AND product_id = ${s.product_id}::uuid LIMIT 1
  `) as Array<{ qty: number }>;
  if (src.length === 0 || src[0]!.qty < s.suggested_qty) return jsonError(400, 'insufficient_stock');

  const ref = `ai-slotting → ${s.to_location_id}`;
  try {
    await sql.transaction([
      sql`
        UPDATE public.stock_by_location SET qty = qty - ${s.suggested_qty}::int
        WHERE location_id = ${s.from_location_id}::uuid AND product_id = ${s.product_id}::uuid
      `,
      sql`
        INSERT INTO public.stock_by_location (location_id, product_id, qty)
        VALUES (${s.to_location_id}::uuid, ${s.product_id}::uuid, ${s.suggested_qty}::int)
        ON CONFLICT (location_id, product_id)
        DO UPDATE SET qty = public.stock_by_location.qty + ${s.suggested_qty}::int, updated_at = now()
      `,
      sql`
        INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
        VALUES (${a.ctx.clientId}::uuid, ${s.product_id}::uuid, ${-s.suggested_qty}::int, 'transfer', 'ai-slotting (out)', ${a.ctx.userNodeId}::uuid)
      `,
      sql`
        INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
        VALUES (${a.ctx.clientId}::uuid, ${s.product_id}::uuid, ${s.suggested_qty}::int, 'transfer', ${ref}, ${a.ctx.userNodeId}::uuid)
      `,
      sql`
        UPDATE public.warehouse_slotting_suggestions
        SET status = 'applied', decided_by = ${a.ctx.userNodeId}::uuid, decided_at = now()
        WHERE id = ${suggestionId}::uuid
      `,
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === '23514') return jsonError(400, 'insufficient_stock');
    throw e;
  }

  return jsonOk({ suggestion_id: suggestionId, status: 'applied', qty: s.suggested_qty });
}
