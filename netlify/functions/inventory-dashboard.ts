// GET /api/inventory/dashboard — KPI rollup for the inventory overview.
// KPIs: distinct SKUs tracked, total units on hand, low-stock count, and the
// 30-day movement volume. Plus the worst low-stock items and recent movements.
// (Stock value — moving-average cost — is layered on by the Cost Calculator.)
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireInventory } from './_inventory-authz';

export const config = { path: '/api/inventory/dashboard', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireInventory(req, ['inventory.products.view']);
  if (!a.ok) return a.res;

  const cid = a.ctx.clientId;
  const sql = db();

  const kpiRows = (await sql`
    SELECT
      (SELECT count(*)::int FROM public.inventory_stock WHERE client_id = ${cid}::uuid AND variant_id IS NULL) AS total_skus,
      (SELECT coalesce(sum(qty_on_hand), 0)::int FROM public.inventory_stock WHERE client_id = ${cid}::uuid AND variant_id IS NULL) AS total_units,
      (SELECT count(*)::int FROM public.inventory_stock WHERE client_id = ${cid}::uuid AND variant_id IS NULL AND qty_on_hand <= reorder_level) AS low_stock_count,
      (SELECT count(*)::int FROM public.stock_movements WHERE client_id = ${cid}::uuid AND variant_id IS NULL AND created_at >= now() - interval '30 days') AS movement_volume_30d
  `) as Array<Record<string, number>>;

  const lowStock = (await sql`
    SELECT s.product_id, p.name, p.sku, s.qty_on_hand, s.reorder_level
    FROM public.inventory_stock s
    JOIN public.products p ON p.id = s.product_id
    WHERE s.client_id = ${cid}::uuid AND s.variant_id IS NULL AND p.deleted_at IS NULL AND s.qty_on_hand <= s.reorder_level
    ORDER BY (s.reorder_level - s.qty_on_hand) DESC, p.name ASC
    LIMIT 8
  `) as unknown[];

  const recentMovements = (await sql`
    SELECT m.id, m.type, m.qty_delta, m.created_at, p.name AS product_name
    FROM public.stock_movements m
    JOIN public.products p ON p.id = m.product_id
    WHERE m.client_id = ${cid}::uuid AND m.variant_id IS NULL
    ORDER BY m.created_at DESC
    LIMIT 8
  `) as unknown[];

  // Moving-average cost per product, sourced from purchase movements joined to
  // their PO line cost (ref = 'po:<uuid>'). Valuation = qty_on_hand × avg cost.
  // Products with no costed purchase contribute 0 (no cost basis to value).
  const perProduct = (await sql`
    WITH purch AS (
      SELECT product_id, qty_delta, (substring(ref from 4))::uuid AS po_id
      FROM public.stock_movements
      WHERE client_id = ${cid}::uuid AND variant_id IS NULL AND type = 'purchase' AND ref ~ '^po:[0-9a-fA-F-]{36}$'
    ),
    avg_cost AS (
      SELECT pu.product_id,
             SUM(pu.qty_delta * poi.unit_cost_cents)::numeric / NULLIF(SUM(pu.qty_delta), 0) AS unit_cost
      FROM purch pu
      JOIN public.purchase_order_items poi
        ON poi.purchase_order_id = pu.po_id AND poi.product_id = pu.product_id
      GROUP BY pu.product_id
    )
    SELECT s.product_id, p.name, s.qty_on_hand,
           round(coalesce(ac.unit_cost, 0))::bigint AS unit_cost_minor,
           round(s.qty_on_hand * coalesce(ac.unit_cost, 0))::bigint AS value_minor
    FROM public.inventory_stock s
    JOIN public.products p ON p.id = s.product_id
    LEFT JOIN avg_cost ac ON ac.product_id = s.product_id
    WHERE s.client_id = ${cid}::uuid AND s.variant_id IS NULL AND p.deleted_at IS NULL
    ORDER BY value_minor DESC
  `) as Array<{ product_id: string; name: string; qty_on_hand: number; unit_cost_minor: string; value_minor: string }>;

  const valued = perProduct.map((r) => ({
    product_id: r.product_id,
    name: r.name,
    qty_on_hand: r.qty_on_hand,
    unit_cost_minor: Number(r.unit_cost_minor),
    value_minor: Number(r.value_minor),
  }));
  const stockValueMinor = valued.reduce((sum, r) => sum + r.value_minor, 0);
  const topValue = valued.filter((r) => r.value_minor > 0).slice(0, 5);

  const kpis = { ...(kpiRows[0] ?? {}), stock_value_minor: stockValueMinor };
  return jsonOk({ kpis, lowStock, recentMovements, topValue });
}
