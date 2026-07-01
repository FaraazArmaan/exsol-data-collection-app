// GET /api/analytics-overview — headline scorecard.
//
// Returns one headline KPI per analytics bucket the caller is entitled to, so
// the dashboard's top strip is a single request. A caller holding only some
// buckets gets only those headlines; holding none → 403.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveAnalyticsAccess } from './_analytics-authz';
import { AnalyticsQuery } from './_analytics-validators';
import { compareWindow, pctDelta } from './_analytics-sql';

export const config = { path: '/api/analytics-overview', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  // No requiredBucket — overview serves whatever the caller is entitled to.
  const auth = await resolveAnalyticsAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId, isRootScope, scopeNodes, buckets } = auth.access;
  if (buckets.size === 0) return jsonError(403, 'forbidden');

  let q: AnalyticsQuery;
  try {
    q = AnalyticsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();
  const nodes = scopeNodes ?? [];
  const noNodeFilter = scopeNodes === null;
  const cmp = compareWindow(q.from, q.to, q.compare);
  const kpis: Array<{ id: string; label: string; value: number; unit: string; delta: number | null; deltaPct: number | null }> = [];

  // Windowed headline (revenue/customers) — same scope + storefront-at-root rule
  // as the domain endpoints, with a delta vs the comparison window so the
  // scorecard reflects the compare selector consistently with the panels.
  async function revenue(from: string, to: string): Promise<number> {
    const r = (await sql`
      SELECT COALESCE(SUM(total_cents) FILTER (WHERE status IN ('paid','fulfilled')), 0)::bigint AS v
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
        AND created_at >= ${from}::date AND created_at < (${to}::date + interval '1 day')
        AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
        AND (${isRootScope}::boolean OR source = 'pos')
    `) as Array<{ v: string }>;
    return Number(r[0]!.v);
  }
  async function customers(from: string, to: string): Promise<number> {
    const r = (await sql`
      SELECT COUNT(DISTINCT customer_phone)::int AS v
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
        AND status IN ('paid','fulfilled')
        AND created_at >= ${from}::date AND created_at < (${to}::date + interval '1 day')
        AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
        AND (${isRootScope}::boolean OR source = 'pos')
    `) as Array<{ v: number }>;
    return Number(r[0]!.v);
  }
  const withDelta = (id: string, label: string, unit: string, cur: number, prior: number | null) =>
    ({ id, label, unit, value: cur, delta: prior == null ? null : cur - prior, deltaPct: prior == null ? null : pctDelta(cur, prior) });

  if (buckets.has('business')) {
    const cur = await revenue(q.from, q.to);
    const prior = cmp ? await revenue(cmp.from, cmp.to) : null;
    kpis.push(withDelta('revenue', 'Revenue', 'cents', cur, prior));
  }
  if (buckets.has('customers')) {
    const cur = await customers(q.from, q.to);
    const prior = cmp ? await customers(cmp.from, cmp.to) : null;
    kpis.push(withDelta('customers', 'Customers', 'count', cur, prior));
  }
  if (buckets.has('employees')) {
    // Current-state headcount snapshot — no window, so no delta.
    const r = (await sql`
      SELECT COUNT(*)::int AS v FROM public.user_nodes
      WHERE client_id = ${clientId}::uuid
        AND (${noNodeFilter}::boolean OR id = ANY(${nodes}::uuid[]))
    `) as Array<{ v: number }>;
    kpis.push({ id: 'staff', label: 'Team members', value: Number(r[0]!.v), unit: 'count', delta: null, deltaPct: null });
  }
  if (buckets.has('products')) {
    // products keys on client_id (bucket_id only exists on sales). Catalog is
    // tenant-wide, so no subtree filter.
    const r = (await sql`
      SELECT COUNT(*)::int AS v FROM public.products
      WHERE client_id = ${clientId}::uuid AND status = 'active' AND deleted_at IS NULL
    `) as Array<{ v: number }>;
    kpis.push({ id: 'catalog', label: 'Active products', value: Number(r[0]!.v), unit: 'count', delta: null, deltaPct: null });
  }

  return jsonOk({
    scope: { isRootScope, nodeCount: scopeNodes === null ? 0 : scopeNodes.length },
    buckets: [...buckets].sort(),
    kpis,
  });
}
