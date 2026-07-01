// GET /api/analytics-catalog — Catalog domain analytics.
//
// Catalog is tenant-wide (scopeColumn = null): not subtree-filtered, gated
// purely by analytics.products.view. KPIs are current-state counts (no date
// window); top-sellers is windowed from sale_lines. products keys on client_id.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveAnalyticsAccess } from './_analytics-authz';
import { AnalyticsQuery } from './_analytics-validators';

export const config = { path: '/api/analytics-catalog', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const auth = await resolveAnalyticsAccess(req, 'products');
  if (!auth.ok) return auth.res;
  const { clientId, isRootScope, scopeNodes } = auth.access;

  let q: AnalyticsQuery;
  try {
    q = AnalyticsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();

  const kpiRows = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active')::int AS active,
      COUNT(*) FILTER (WHERE status = 'active' AND discount_percent > 0)::int AS discounted,
      COUNT(*) FILTER (WHERE status = 'active' AND pos_visible)::int AS pos_visible
    FROM public.products
    WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL
  `) as Array<{ active: number; discounted: number; pos_visible: number }>;
  const k = kpiRows[0]!;

  const topSellers = (await sql`
    SELECT sl.product_name_snap AS key, SUM(sl.qty)::int AS value
    FROM public.sale_lines sl
    JOIN public.sales s ON s.id = sl.sale_id
    WHERE s.bucket_id = ${clientId}::uuid AND s.status IN ('paid','fulfilled')
      AND s.created_at >= ${q.from}::date AND s.created_at < (${q.to}::date + interval '1 day')
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `) as Array<{ key: string; value: number }>;

  const byCategory = (await sql`
    SELECT COALESCE(pc.name, 'Uncategorised') AS key, COUNT(*)::int AS value
    FROM public.products p
    LEFT JOIN public.product_categories pc ON pc.id = p.category_id AND pc.deleted_at IS NULL
    WHERE p.client_id = ${clientId}::uuid AND p.status = 'active' AND p.deleted_at IS NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `) as Array<{ key: string; value: number }>;

  const withPct = (rs: Array<{ key: string; value: number }>) => {
    const total = rs.reduce((a, b) => a + b.value, 0) || 1;
    return rs.map((r) => ({ key: r.key, value: Number(r.value), pct: (r.value / total) * 100 }));
  };

  return jsonOk({
    scope: { isRootScope, nodeCount: scopeNodes === null ? 0 : scopeNodes.length },
    kpis: [
      { id: 'active', label: 'Active products', unit: 'count', value: Number(k.active), delta: null, deltaPct: null },
      { id: 'discounted', label: 'On discount', unit: 'count', value: Number(k.discounted), delta: null, deltaPct: null },
      { id: 'pos_visible', label: 'POS-visible', unit: 'count', value: Number(k.pos_visible), delta: null, deltaPct: null },
    ],
    series: [],
    breakdowns: [
      { id: 'top_sellers', label: 'Top sellers (units)', unit: 'count', viz: 'table', rows: withPct(topSellers) },
      { id: 'by_category', label: 'Products by category', unit: 'count', viz: 'donut', rows: withPct(byCategory) },
    ],
    generatedAt: new Date().toISOString(),
  });
}
