// GET /api/orders/sla — Per-sale stage timeline breach report.
//
// Builds a per-sale stage timeline by UNION-ing two sources:
//   1. Derived sale-status events — mapped from sales timestamps:
//        (created_at → 'pending_payment'), (paid_at → 'paid'),
//        (fulfilled_at → 'fulfilled'), (cancelled_at → 'cancelled'),
//        (refunded_at → 'refunded')  [only non-NULL timestamps]
//   2. Logged orders-specific events — rows in orders_stage_events.
//
// Applies LEAD window per sale (ordered by entered_at) to compute
// duration_minutes for each stage.  Joins against orders_sla_targets;
// a row is a breach when duration_minutes > max_minutes.
//
// Returns { targets, breaches, breach_count }.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders } from './_orders-authz';

export const config = { path: '/api/orders/sla', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const a = await requireOrders(req, ['orders.business.view']);
  if (!a.ok) return a.res;
  const { clientId } = a.ctx;

  const sql = db();

  const targets = (await sql`
    SELECT stage::text, max_minutes
    FROM public.orders_sla_targets
    WHERE client_id = ${clientId}::uuid
    ORDER BY stage
  `) as Array<{ stage: string; max_minutes: number }>;

  const breachRows = (await sql`
    WITH
    derived AS (
      SELECT id AS sale_id, created_at AS entered_at, 'pending_payment'::order_stage AS stage
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
      UNION ALL
      SELECT id, paid_at, 'paid'::order_stage
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid AND paid_at IS NOT NULL
      UNION ALL
      SELECT id, fulfilled_at, 'fulfilled'::order_stage
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid AND fulfilled_at IS NOT NULL
      UNION ALL
      SELECT id, cancelled_at, 'cancelled'::order_stage
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid AND cancelled_at IS NOT NULL
      UNION ALL
      SELECT id, refunded_at, 'refunded'::order_stage
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid AND refunded_at IS NOT NULL
    ),
    logged AS (
      SELECT sale_id, stage, entered_at
      FROM public.orders_stage_events
      WHERE client_id = ${clientId}::uuid
    ),
    timeline AS (
      SELECT sale_id, stage, entered_at FROM derived
      UNION ALL
      SELECT sale_id, stage, entered_at FROM logged
    ),
    windowed AS (
      SELECT
        sale_id,
        stage,
        entered_at,
        LEAD(entered_at) OVER (PARTITION BY sale_id ORDER BY entered_at) AS next_at
      FROM timeline
    ),
    breach_cte AS (
      SELECT
        w.sale_id,
        w.stage,
        EXTRACT(EPOCH FROM (COALESCE(w.next_at, now()) - w.entered_at)) / 60 AS duration_minutes,
        t.max_minutes
      FROM windowed w
      JOIN public.orders_sla_targets t
        ON t.client_id = ${clientId}::uuid AND t.stage = w.stage
      WHERE EXTRACT(EPOCH FROM (COALESCE(w.next_at, now()) - w.entered_at)) / 60 > t.max_minutes
    )
    SELECT b.sale_id, s.order_no, b.stage::text, b.duration_minutes, b.max_minutes
    FROM breach_cte b
    JOIN public.sales s ON s.id = b.sale_id
    ORDER BY b.duration_minutes DESC
  `) as Array<{
    sale_id: string;
    order_no: number;
    stage: string;
    duration_minutes: number;
    max_minutes: number;
  }>;

  return jsonOk({
    targets: targets.map((t) => ({ stage: t.stage, max_minutes: Number(t.max_minutes) })),
    breaches: breachRows.map((r) => ({
      sale_id: r.sale_id,
      order_no: Number(r.order_no),
      stage: r.stage,
      minutes: Number(r.duration_minutes),
      max_minutes: Number(r.max_minutes),
    })),
    breach_count: breachRows.length,
  });
}
