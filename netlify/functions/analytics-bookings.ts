// GET /api/analytics-bookings — Bookings domain analytics.
//
// KPIs: booked / completed / cancelled counts. Series: bookings-by-day bucketed
// on the appointment time (lower(time_range)) in the tenant tz. Breakdowns: by
// status and by service. Scoped on the assigned staff node (user_node_id);
// 'blocked' staff-time rows are excluded (they aren't customer bookings).

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveAnalyticsAccess, resolveTenantTz } from './_analytics-authz';
import { AnalyticsQuery } from './_analytics-validators';
import { compareWindow, pctDelta } from './_analytics-sql';

export const config = { path: '/api/analytics-bookings', method: 'GET' };

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
  const nodes = scopeNodes ?? [];
  const noNodeFilter = scopeNodes === null;
  const tz = await resolveTenantTz(sql, clientId);

  async function windowKpis(from: string, to: string) {
    const rows = (await sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('pending','confirmed','completed'))::int AS booked,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status IN ('cancelled','no_show'))::int AS cancelled
      FROM public.bookings
      WHERE bucket_id = ${clientId}::uuid
        AND status <> 'blocked'
        AND lower(time_range) >= ${from}::date
        AND lower(time_range) <  (${to}::date + interval '1 day')
        AND (${noNodeFilter}::boolean OR user_node_id = ANY(${nodes}::uuid[]))
    `) as Array<{ booked: number; completed: number; cancelled: number }>;
    const r = rows[0]!;
    return { booked: Number(r.booked), completed: Number(r.completed), cancelled: Number(r.cancelled) };
  }

  const cur = await windowKpis(q.from, q.to);
  const cmp = compareWindow(q.from, q.to, q.compare);
  const prior = cmp ? await windowKpis(cmp.from, cmp.to) : null;
  const mk = (id: 'booked' | 'completed' | 'cancelled', label: string) => ({
    id, label, unit: 'count' as const, value: cur[id],
    delta: prior ? cur[id] - prior[id] : null,
    deltaPct: prior ? pctDelta(cur[id], prior[id]) : null,
  });

  const seriesRows = (await sql`
    SELECT to_char(date_trunc(${q.granularity}, (lower(time_range) AT TIME ZONE ${tz})), 'YYYY-MM-DD') AS x,
           COUNT(*)::int AS y
    FROM public.bookings
    WHERE bucket_id = ${clientId}::uuid AND status <> 'blocked'
      AND lower(time_range) >= ${q.from}::date
      AND lower(time_range) <  (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR user_node_id = ANY(${nodes}::uuid[]))
    GROUP BY 1 ORDER BY 1
  `) as Array<{ x: string; y: number }>;

  const statusRows = (await sql`
    SELECT status::text AS key, COUNT(*)::int AS value
    FROM public.bookings
    WHERE bucket_id = ${clientId}::uuid AND status <> 'blocked'
      AND lower(time_range) >= ${q.from}::date
      AND lower(time_range) <  (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR user_node_id = ANY(${nodes}::uuid[]))
    GROUP BY 1 ORDER BY 2 DESC
  `) as Array<{ key: string; value: number }>;

  const serviceRows = (await sql`
    SELECT COALESCE(sv.name, 'Unknown') AS key, COUNT(*)::int AS value
    FROM public.bookings b
    LEFT JOIN public.booking_services sv ON sv.id = b.service_id
    WHERE b.bucket_id = ${clientId}::uuid AND b.status <> 'blocked'
      AND lower(b.time_range) >= ${q.from}::date
      AND lower(b.time_range) <  (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR b.user_node_id = ANY(${nodes}::uuid[]))
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `) as Array<{ key: string; value: number }>;

  const toRows = (rs: Array<{ key: string; value: number }>) => {
    const total = rs.reduce((a, b) => a + b.value, 0) || 1;
    return rs.map((r) => ({ key: r.key, value: r.value, pct: (r.value / total) * 100 }));
  };

  return jsonOk({
    scope: { isRootScope, nodeCount: scopeNodes === null ? 0 : scopeNodes.length },
    kpis: [mk('booked', 'Bookings'), mk('completed', 'Completed'), mk('cancelled', 'Cancelled / no-show')],
    series: [{ id: 'bookings_by_day', label: 'Bookings over time', chart: 'line', unit: 'count',
               points: seriesRows.map((r) => ({ x: r.x, y: Number(r.y) })) }],
    breakdowns: [
      { id: 'by_status', label: 'By status', unit: 'count', viz: 'bar', rows: toRows(statusRows) },
      { id: 'by_service', label: 'By service', unit: 'count', viz: 'donut', rows: toRows(serviceRows) },
    ],
    generatedAt: new Date().toISOString(),
  });
}
