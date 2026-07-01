// GET /api/analytics-customers — Customers domain analytics.
//
// Derived from sales, keyed on customer_phone (there is no customer_id FK, so
// identity is fuzzy — a phone is a customer). Same scope + storefront-at-root
// rule as analytics-sales: subtree managers see only their own attributed
// customers; storefront (guest) customers roll up only at root scope.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveAnalyticsAccess, resolveTenantTz } from './_analytics-authz';
import { AnalyticsQuery } from './_analytics-validators';
import { compareWindow, pctDelta } from './_analytics-sql';

export const config = { path: '/api/analytics-customers', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const auth = await resolveAnalyticsAccess(req, 'customers');
  if (!auth.ok) return auth.res;
  const { clientId, isRootScope, scopeNodes } = auth.access;

  let q: AnalyticsQuery;
  try {
    q = AnalyticsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();
  const nodes = scopeNodes ?? [];
  const noNodeFilter = scopeNodes === null;
  const tz = await resolveTenantTz(sql, clientId);

  async function windowKpis(from: string, to: string) {
    const rows = (await sql`
      WITH per_customer AS (
        SELECT customer_phone, COUNT(*) AS orders, SUM(total_cents) AS spend
        FROM public.sales
        WHERE bucket_id = ${clientId}::uuid
          AND status IN ('paid','fulfilled')
          AND created_at >= ${from}::date AND created_at < (${to}::date + interval '1 day')
          AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
          AND (${isRootScope}::boolean OR source = 'pos')
        GROUP BY customer_phone
      )
      SELECT COUNT(*)::int AS customers,
             COUNT(*) FILTER (WHERE orders >= 2)::int AS returning,
             COALESCE(SUM(spend), 0)::bigint AS revenue_cents
      FROM per_customer
    `) as Array<{ customers: number; returning: number; revenue_cents: string }>;
    const r = rows[0]!;
    const customers = Number(r.customers);
    return {
      customers,
      returning: Number(r.returning),
      avg_spend: customers > 0 ? Math.round(Number(r.revenue_cents) / customers) : 0,
    };
  }

  const cur = await windowKpis(q.from, q.to);
  const cmp = compareWindow(q.from, q.to, q.compare);
  const prior = cmp ? await windowKpis(cmp.from, cmp.to) : null;
  const mk = (id: 'customers' | 'returning' | 'avg_spend', label: string, unit: 'cents' | 'count') => ({
    id, label, unit, value: cur[id],
    delta: prior ? cur[id] - prior[id] : null,
    deltaPct: prior ? pctDelta(cur[id], prior[id]) : null,
  });

  const seriesRows = (await sql`
    SELECT to_char(date_trunc(${q.granularity}, (created_at AT TIME ZONE ${tz})), 'YYYY-MM-DD') AS x,
           COUNT(DISTINCT customer_phone)::int AS y
    FROM public.sales
    WHERE bucket_id = ${clientId}::uuid AND status IN ('paid','fulfilled')
      AND created_at >= ${q.from}::date AND created_at < (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
      AND (${isRootScope}::boolean OR source = 'pos')
    GROUP BY 1 ORDER BY 1
  `) as Array<{ x: string; y: number }>;

  const topRows = (await sql`
    SELECT customer_name || ' · ' || customer_phone AS key, SUM(total_cents)::bigint AS value
    FROM public.sales
    WHERE bucket_id = ${clientId}::uuid AND status IN ('paid','fulfilled')
      AND created_at >= ${q.from}::date AND created_at < (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
      AND (${isRootScope}::boolean OR source = 'pos')
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `) as Array<{ key: string; value: string }>;

  const nvr = [
    { key: 'Returning', value: cur.returning },
    { key: 'New', value: Math.max(0, cur.customers - cur.returning) },
  ];
  const withPct = <T extends { value: number }>(rs: T[]) => {
    const total = rs.reduce((a, b) => a + b.value, 0) || 1;
    return rs.map((r) => ({ ...r, pct: (r.value / total) * 100 }));
  };

  return jsonOk({
    scope: { isRootScope, nodeCount: scopeNodes === null ? 0 : scopeNodes.length },
    kpis: [mk('customers', 'Customers', 'count'), mk('returning', 'Returning', 'count'), mk('avg_spend', 'Avg spend', 'cents')],
    series: [{ id: 'customers_by_day', label: 'Active customers over time', chart: 'line', unit: 'count',
               points: seriesRows.map((r) => ({ x: r.x, y: Number(r.y) })) }],
    breakdowns: [
      { id: 'new_vs_returning', label: 'New vs returning', unit: 'count', viz: 'donut', rows: withPct(nvr) },
      { id: 'top_customers', label: 'Top customers by spend', unit: 'cents', viz: 'table',
        rows: withPct(topRows.map((r) => ({ key: r.key, value: Number(r.value) }))) },
    ],
    generatedAt: new Date().toISOString(),
  });
}
