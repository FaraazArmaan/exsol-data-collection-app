// GET /api/warehouse/stock?location_id=<uuid> — per-location stock breakdown.
// Client-scoped by joining through warehouse_locations; optional single-location
// filter. Joins products for name/sku so the UI needs no second call.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/stock', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.products.view']);
  if (!a.ok) return a.res;

  // null → no filter. Passing '' would fail the ::uuid cast even under the OR,
  // since Postgres casts the bound literal regardless of short-circuit.
  const locationId = new URL(req.url).searchParams.get('location_id') || null;

  const sql = db();
  const rows = (await sql`
    SELECT sbl.location_id,
           l.name AS location_name,
           l.kind AS location_kind,
           sbl.product_id,
           p.name AS product_name,
           p.sku,
           sbl.qty
    FROM public.stock_by_location sbl
    JOIN public.warehouse_locations l ON l.id = sbl.location_id
    JOIN public.products p ON p.id = sbl.product_id
    WHERE l.client_id = ${a.ctx.clientId}::uuid
      AND p.deleted_at IS NULL
      AND (${locationId}::uuid IS NULL OR sbl.location_id = ${locationId}::uuid)
    ORDER BY l.name ASC, p.name ASC
  `) as unknown[];

  return jsonOk({ items: rows });
}
