import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess } from './_supply-chain-authz';

export const config = { path: '/api/supply-chain-inventory', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  const sql = db();
  const tzRows = (await sql`
    SELECT timezone FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ timezone: string }>;
  const tz = tzRows[0]?.timezone ?? 'UTC';

  const lowStock = (await sql`
    SELECT s.product_id AS "productId", p.name, p.sku,
           s.qty_on_hand AS "qtyOnHand", s.reorder_level AS "reorderLevel",
           (s.reorder_level - s.qty_on_hand) AS deficit
    FROM public.inventory_stock s
    JOIN public.products p ON p.id = s.product_id AND p.deleted_at IS NULL
    WHERE s.client_id = ${clientId}::uuid
      AND s.variant_id IS NULL
      AND s.qty_on_hand <= s.reorder_level
    ORDER BY (s.reorder_level - s.qty_on_hand) DESC
    LIMIT 100
  `) as Array<{
    productId: string; name: string; sku: string | null;
    qtyOnHand: number; reorderLevel: number; deficit: number;
  }>;

  const seriesRows = (await sql`
    WITH days AS (
      SELECT generate_series(
        (date_trunc('day', now() AT TIME ZONE ${tz}) - interval '29 days'),
        date_trunc('day', now() AT TIME ZONE ${tz}),
        interval '1 day'
      )::date AS day
    ),
    vol AS (
      SELECT date_trunc('day', created_at AT TIME ZONE ${tz})::date AS day,
             sum(abs(qty_delta))::int AS volume
      FROM public.stock_movements
      WHERE client_id = ${clientId}::uuid
        AND variant_id IS NULL
        AND created_at >= (now() - interval '30 days')
      GROUP BY 1
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(v.volume, 0) AS volume
    FROM days d
    LEFT JOIN vol v ON v.day = d.day
    ORDER BY d.day
  `) as Array<{ day: string; volume: number | string }>;

  const movementSeries = seriesRows.map((r) => ({ day: r.day, volume: Number(r.volume) }));
  const movementVolume30d = movementSeries.reduce((a, r) => a + r.volume, 0);

  return jsonOk({
    kpis: { lowStockCount: lowStock.length, movementVolume30d },
    lowStock,
    movementSeries,
    generatedAt: new Date().toISOString(),
  });
}
