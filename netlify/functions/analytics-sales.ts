// GET /api/analytics-sales — Sales domain analytics.
//
// Returns KPIs (revenue, sales count, AOV) for the window, optionally with a
// delta vs a comparison window. Series + breakdowns are added in a later slice.
//
// Scoping: subtree filter on created_by_user_node (POS staff sales). Storefront
// sales (source='storefront', no creator node) are "house" revenue, visible only
// at root scope — so the predicate `(isRootScope OR source='pos')` excludes them
// from any subtree-scoped view.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveAnalyticsAccess } from './_analytics-authz';
import { AnalyticsQuery } from './_analytics-validators';
import { compareWindow, pctDelta } from './_analytics-sql';

export const config = { path: '/api/analytics-sales', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const auth = await resolveAnalyticsAccess(req, 'business');
  if (!auth.ok) return auth.res;
  const { clientId, isRootScope, scopeNodes } = auth.access;

  let q: AnalyticsQuery;
  try {
    q = AnalyticsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();
  const nodes: string[] = scopeNodes ?? [];
  const noNodeFilter = scopeNodes === null; // root scope: see all nodes

  async function windowKpis(from: string, to: string) {
    const rows = (await sql`
      SELECT
        COALESCE(SUM(total_cents) FILTER (WHERE status IN ('paid','fulfilled')), 0)::bigint AS revenue_cents,
        COUNT(*) FILTER (WHERE status IN ('paid','fulfilled'))::int AS sales_count
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
        AND created_at >= ${from}::date
        AND created_at <  (${to}::date + interval '1 day')
        AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
        AND (${isRootScope}::boolean OR source = 'pos')
    `) as Array<{ revenue_cents: string; sales_count: number }>;
    const r = rows[0]!;
    const revenue = Number(r.revenue_cents);
    const sales = Number(r.sales_count);
    return { revenue, sales, aov: sales > 0 ? Math.round(revenue / sales) : 0 };
  }

  const cur = await windowKpis(q.from, q.to);
  const cmp = compareWindow(q.from, q.to, q.compare);
  const prior = cmp ? await windowKpis(cmp.from, cmp.to) : null;

  const mk = (id: 'revenue' | 'sales' | 'aov', label: string, unit: 'cents' | 'count') => ({
    id, label, unit,
    value: cur[id],
    delta: prior ? cur[id] - prior[id] : null,
    deltaPct: prior ? pctDelta(cur[id], prior[id]) : null,
  });

  return jsonOk({
    scope: { isRootScope, nodeCount: scopeNodes === null ? 0 : scopeNodes.length },
    kpis: [
      mk('revenue', 'Revenue', 'cents'),
      mk('sales', 'Sales', 'count'),
      mk('aov', 'Avg order value', 'cents'),
    ],
    series: [],
    breakdowns: [],
    generatedAt: new Date().toISOString(),
  });
}
