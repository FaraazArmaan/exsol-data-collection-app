// GET /api/analytics-team — Team domain analytics.
//
// Built on reliable staff-attributed data (sales.created_by_user_node) + head
// count (user_nodes), NOT audit_log (which is not cleanly client-scoped).
// Storefront sales have no creator node, so they're naturally excluded from all
// staff metrics. Scoped to the caller's subtree.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveAnalyticsAccess, resolveTenantTz } from './_analytics-authz';
import { AnalyticsQuery } from './_analytics-validators';
import { compareWindow, pctDelta } from './_analytics-sql';

export const config = { path: '/api/analytics-team', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const auth = await resolveAnalyticsAccess(req, 'employees');
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
      SELECT
        COUNT(*) FILTER (WHERE status IN ('paid','fulfilled'))::int AS staff_sales,
        COUNT(DISTINCT created_by_user_node) FILTER (WHERE status IN ('paid','fulfilled'))::int AS active_staff
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
        AND created_by_user_node IS NOT NULL
        AND created_at >= ${from}::date AND created_at < (${to}::date + interval '1 day')
        AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
    `) as Array<{ staff_sales: number; active_staff: number }>;
    const r = rows[0]!;
    return { staff_sales: Number(r.staff_sales), active_staff: Number(r.active_staff) };
  }

  const headRows = (await sql`
    SELECT COUNT(*)::int AS v FROM public.user_nodes
    WHERE client_id = ${clientId}::uuid
      AND (${noNodeFilter}::boolean OR id = ANY(${nodes}::uuid[]))
  `) as Array<{ v: number }>;
  const teamMembers = Number(headRows[0]!.v);

  const cur = await windowKpis(q.from, q.to);
  const cmp = compareWindow(q.from, q.to, q.compare);
  const prior = cmp ? await windowKpis(cmp.from, cmp.to) : null;
  const dyn = (id: 'staff_sales' | 'active_staff', label: string) => ({
    id, label, unit: 'count' as const, value: cur[id],
    delta: prior ? cur[id] - prior[id] : null,
    deltaPct: prior ? pctDelta(cur[id], prior[id]) : null,
  });

  const seriesRows = (await sql`
    SELECT to_char(date_trunc(${q.granularity}, (created_at AT TIME ZONE ${tz})), 'YYYY-MM-DD') AS x,
           COUNT(*)::int AS y
    FROM public.sales
    WHERE bucket_id = ${clientId}::uuid AND created_by_user_node IS NOT NULL
      AND status IN ('paid','fulfilled')
      AND created_at >= ${q.from}::date AND created_at < (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
    GROUP BY 1 ORDER BY 1
  `) as Array<{ x: string; y: number }>;

  const perStaff = (await sql`
    SELECT COALESCE(un.display_name, 'Unknown') AS key,
           COUNT(*)::int AS sales, COALESCE(SUM(s.total_cents), 0)::bigint AS revenue
    FROM public.sales s
    JOIN public.user_nodes un ON un.id = s.created_by_user_node
    WHERE s.bucket_id = ${clientId}::uuid AND s.status IN ('paid','fulfilled')
      AND s.created_at >= ${q.from}::date AND s.created_at < (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR s.created_by_user_node = ANY(${nodes}::uuid[]))
    GROUP BY 1 ORDER BY 3 DESC LIMIT 10
  `) as Array<{ key: string; sales: number; revenue: string }>;

  const salesByStaff = perStaff.map((r) => ({ key: r.key, value: Number(r.sales) }));
  const revByStaff = perStaff.map((r) => ({ key: r.key, value: Number(r.revenue) }));
  const withPct = <T extends { value: number }>(rs: T[]) => {
    const total = rs.reduce((a, b) => a + b.value, 0) || 1;
    return rs.map((r) => ({ ...r, pct: (r.value / total) * 100 }));
  };

  return jsonOk({
    scope: { isRootScope, nodeCount: scopeNodes === null ? 0 : scopeNodes.length },
    kpis: [
      { id: 'team_members', label: 'Team members', unit: 'count', value: teamMembers, delta: null, deltaPct: null },
      dyn('active_staff', 'Active staff'),
      dyn('staff_sales', 'Staff sales'),
    ],
    series: [{ id: 'staff_sales_by_day', label: 'Staff sales over time', chart: 'line', unit: 'count',
               points: seriesRows.map((r) => ({ x: r.x, y: Number(r.y) })) }],
    breakdowns: [
      { id: 'sales_by_staff', label: 'Sales by staff', unit: 'count', viz: 'bar', rows: withPct(salesByStaff) },
      { id: 'revenue_by_staff', label: 'Revenue by staff', unit: 'cents', viz: 'table', rows: withPct(revByStaff) },
    ],
    generatedAt: new Date().toISOString(),
  });
}
