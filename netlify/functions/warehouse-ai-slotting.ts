// GET /api/warehouse/ai-slotting?status=pending|applied|dismissed|all — slotting
// suggestions with product + location names for the panel. (warehouse.products.view)
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/ai-slotting', method: 'GET' };

const STATUSES = new Set(['pending', 'applied', 'dismissed', 'all']);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.products.view']);
  if (!a.ok) return a.res;

  const raw = new URL(req.url).searchParams.get('status') ?? 'pending';
  const status = STATUSES.has(raw) ? raw : 'pending';

  const sql = db();
  const rows = (await sql`
    SELECT s.id, s.product_id, p.name AS product_name,
           s.from_location_id, fl.name AS from_name,
           s.to_location_id, tl.name AS to_name,
           s.suggested_qty, s.velocity, s.rationale, s.ai_fallback, s.status, s.created_at
    FROM public.warehouse_slotting_suggestions s
    JOIN public.products p ON p.id = s.product_id
    JOIN public.warehouse_locations fl ON fl.id = s.from_location_id
    JOIN public.warehouse_locations tl ON tl.id = s.to_location_id
    WHERE s.client_id = ${a.ctx.clientId}::uuid
      AND (${status} = 'all' OR s.status = ${status})
    ORDER BY s.velocity DESC, s.created_at DESC
  `) as unknown[];

  return jsonOk({ suggestions: rows });
}
