// GET /api/pos/sales — filterable list endpoint with summary stats.
//
// Behavior:
//   - Requires pos.history.view; without pos.history.viewAll the server
//     force-overrides the `cashier` query param to the caller's own user_node
//     (covert lockdown — no 403, just a silently scoped result set).
//   - Filters: status CSV, channel CSV, cashier UUID, from/to dates (default
//     today, today), q search (digits → phone or order_no; text → name).
//   - Summary computes over the FULL filter set (not just the limited page),
//     so dashboard cards reflect total revenue/pending/pickup counts that
//     match the filter, independent of pagination.
//
// Implementation note: the neon HTTP driver's tagged template can't reliably
// bind `NULL::text[]` for the optional CSV filters across versions ("could
// not determine data type of parameter"). To stay portable, we build the
// WHERE clause with `sql.unsafe` fragments and explicit value params via
// the neon driver's query interpolation — values are still parameterized.
//
// To keep things simple we use the tagged template with NULL fallbacks
// wrapped via CASE/COALESCE patterns that don't require explicit casts on
// NULL arrays. This pattern has worked in sale-create's neighbours.

import { jsonOk, jsonError } from '../_shared/http';
import { db } from '../_shared/db';
import { requirePos } from './_authz';
import { SalesListQuery } from './_validators';

export const config = { path: '/api/pos/sales' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.history.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  let q: SalesListQuery;
  try {
    q = SalesListQuery.parse(Object.fromEntries(url.searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();

  // viewAll gate — without it, server forces cashier = current user, ignoring
  // whatever the client passed. Silently scoped, not 403.
  const onlyOwn = !a.ctx.perms.has('pos.history.viewAll');
  const effectiveCashier: string | null = onlyOwn
    ? a.ctx.userNodeId
    : q.cashier ?? null;

  // CSV filters: pass empty-array sentinel when "no filter" so we can keep
  // a single tagged-template query. Empty arrays bind reliably; the predicate
  // `(${arr}::text[] = '{}' OR col = ANY(${arr}::text[]))` is the standard
  // neon-friendly "is null" workaround.
  const statusArr: string[] = q.status ?? [];
  const channelArr: string[] = q.channel ?? [];

  // q routing: all-digits → phone substring OR exact order_no; else → name ILIKE.
  const allDigits = !!q.q && /^\d+$/.test(q.q);
  const hasQ = !!q.q;
  const phoneQ = allDigits ? `%${q.q}%` : '';
  const nameQ = !allDigits && q.q ? `%${q.q}%` : '';
  // order_no is bigint; bound the numeric coercion to avoid overflow throws.
  const orderNoQ = allDigits && q.q!.length <= 18 ? Number(q.q) : 0;

  const rows = (await sql`
    SELECT s.id, s.order_no, s.status, s.channel,
           s.customer_name, s.customer_phone, s.customer_email,
           s.subtotal_cents, s.total_cents,
           s.created_at, s.paid_at, s.fulfilled_at, s.cancelled_at, s.refunded_at,
           s.created_by_user_node,
           (SELECT COUNT(*) FROM public.sale_lines WHERE sale_id = s.id) AS line_count
    FROM public.sales s
    WHERE s.bucket_id = ${a.ctx.clientId}::uuid
      AND (${effectiveCashier === null}::boolean
           OR s.created_by_user_node = ${effectiveCashier ?? a.ctx.userNodeId}::uuid)
      AND (cardinality(${statusArr}::text[]) = 0
           OR s.status::text = ANY(${statusArr}::text[]))
      AND (cardinality(${channelArr}::text[]) = 0
           OR s.channel::text = ANY(${channelArr}::text[]))
      AND s.created_at >= ${q.from}::date
      AND s.created_at <  (${q.to}::date + interval '1 day')
      AND (
        ${hasQ}::boolean = false
        OR (${allDigits}::boolean AND s.customer_phone ILIKE ${phoneQ})
        OR (${allDigits}::boolean AND s.order_no = ${orderNoQ}::bigint)
        OR (${!allDigits && hasQ}::boolean AND s.customer_name ILIKE ${nameQ})
      )
    ORDER BY s.created_at DESC
    LIMIT ${q.limit}
  `) as any[];

  // Summary aggregate — runs over the SAME WHERE clause as `rows`, minus
  // ORDER BY/LIMIT, so dashboard totals reflect the full filter set rather
  // than the current page. Keep predicate parity with the rows query above.
  const aggRows = (await sql`
    SELECT
      COUNT(*)::int AS count,
      COALESCE(SUM(s.total_cents) FILTER (WHERE s.status IN ('paid','fulfilled')), 0)::bigint AS revenue_cents,
      COUNT(*) FILTER (WHERE s.status = 'pending_payment')::int AS pending_count,
      COUNT(*) FILTER (WHERE s.status = 'paid' AND s.channel = 'pickup')::int AS pickup_queue_count
    FROM public.sales s
    WHERE s.bucket_id = ${a.ctx.clientId}::uuid
      AND (${effectiveCashier === null}::boolean
           OR s.created_by_user_node = ${effectiveCashier ?? a.ctx.userNodeId}::uuid)
      AND (cardinality(${statusArr}::text[]) = 0
           OR s.status::text = ANY(${statusArr}::text[]))
      AND (cardinality(${channelArr}::text[]) = 0
           OR s.channel::text = ANY(${channelArr}::text[]))
      AND s.created_at >= ${q.from}::date
      AND s.created_at <  (${q.to}::date + interval '1 day')
      AND (
        ${hasQ}::boolean = false
        OR (${allDigits}::boolean AND s.customer_phone ILIKE ${phoneQ})
        OR (${allDigits}::boolean AND s.order_no = ${orderNoQ}::bigint)
        OR (${!allDigits && hasQ}::boolean AND s.customer_name ILIKE ${nameQ})
      )
  `) as any[];
  const agg = aggRows[0] ?? {};
  const summary = {
    count: Number(agg.count ?? 0),
    revenueCents: Number(agg.revenue_cents ?? 0),
    pendingCount: Number(agg.pending_count ?? 0),
    pickupQueueCount: Number(agg.pickup_queue_count ?? 0),
  };

  return jsonOk({
    sales: rows,
    nextCursor:
      rows.length === q.limit ? String(rows[rows.length - 1].created_at) : null,
    summary,
  });
}
