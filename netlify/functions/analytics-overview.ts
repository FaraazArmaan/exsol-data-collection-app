// GET /api/analytics-overview — headline scorecard.
//
// Returns one headline KPI per analytics bucket the caller is entitled to, so
// the dashboard's top strip is a single request. A caller holding only some
// buckets gets only those headlines; holding none → 403.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveAnalyticsAccess } from './_analytics-authz';
import { AnalyticsQuery } from './_analytics-validators';

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
  const kpis: Array<{ id: string; label: string; value: number; unit: string }> = [];

  if (buckets.has('business')) {
    const r = (await sql`
      SELECT COALESCE(SUM(total_cents) FILTER (WHERE status IN ('paid','fulfilled')), 0)::bigint AS v
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
        AND created_at >= ${q.from}::date AND created_at < (${q.to}::date + interval '1 day')
        AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
        AND (${isRootScope}::boolean OR source = 'pos')
    `) as Array<{ v: string }>;
    kpis.push({ id: 'revenue', label: 'Revenue', value: Number(r[0]!.v), unit: 'cents' });
  }
  if (buckets.has('customers')) {
    const r = (await sql`
      SELECT COUNT(DISTINCT customer_phone)::int AS v
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
        AND created_at >= ${q.from}::date AND created_at < (${q.to}::date + interval '1 day')
        AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
        AND (${isRootScope}::boolean OR source = 'pos')
    `) as Array<{ v: number }>;
    kpis.push({ id: 'customers', label: 'Customers', value: Number(r[0]!.v), unit: 'count' });
  }
  if (buckets.has('employees')) {
    const r = (await sql`
      SELECT COUNT(*)::int AS v FROM public.user_nodes
      WHERE client_id = ${clientId}::uuid
        AND (${noNodeFilter}::boolean OR id = ANY(${nodes}::uuid[]))
    `) as Array<{ v: number }>;
    kpis.push({ id: 'staff', label: 'Team members', value: Number(r[0]!.v), unit: 'count' });
  }
  if (buckets.has('products')) {
    // products keys on client_id (bucket_id only exists on sales). Catalog is
    // tenant-wide, so no subtree filter.
    const r = (await sql`
      SELECT COUNT(*)::int AS v FROM public.products
      WHERE client_id = ${clientId}::uuid AND status = 'active' AND deleted_at IS NULL
    `) as Array<{ v: number }>;
    kpis.push({ id: 'catalog', label: 'Active products', value: Number(r[0]!.v), unit: 'count' });
  }

  return jsonOk({
    scope: { isRootScope, nodeCount: scopeNodes === null ? 0 : scopeNodes.length },
    buckets: [...buckets].sort(),
    kpis,
  });
}
