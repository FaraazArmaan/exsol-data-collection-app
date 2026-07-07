// GET /api/orders/dashboard — Order Management KPI dashboard.
//
// Aggregates over public.sales for the caller's client (bucket_id = clientId):
//   • by_status  — count + total cents per sale_status
//   • by_channel — count + total cents per sale_channel
//   • open       — combined pending_payment + paid count + value
//   • avg_fulfil_secs — average seconds from paid_at → fulfilled_at
//   • backorders_active — live count from orders_backorders (Task 3)
//   • sla_breaches — count of stage-duration breaches via timeline CTE (Task 5)
//
// Money columns are BIGINT in Postgres; Neon returns them as strings → Number().
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders } from './_orders-authz';

export const config = { path: '/api/orders/dashboard', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const a = await requireOrders(req, ['orders.business.view']);
  if (!a.ok) return a.res;
  const { clientId } = a.ctx;

  const sql = db();

  const byStatus = (await sql`
    SELECT status, COUNT(*)::int n, COALESCE(SUM(total_cents),0)::bigint cents
    FROM public.sales
    WHERE bucket_id=${clientId}::uuid
    GROUP BY status
  `) as Array<{ status: string; n: number; cents: string }>;

  const byChannel = (await sql`
    SELECT channel, COUNT(*)::int n, COALESCE(SUM(total_cents),0)::bigint cents
    FROM public.sales
    WHERE bucket_id=${clientId}::uuid
    GROUP BY channel
  `) as Array<{ channel: string; n: number; cents: string }>;

  const open = (await sql`
    SELECT COUNT(*)::int n, COALESCE(SUM(total_cents),0)::bigint cents
    FROM public.sales
    WHERE bucket_id=${clientId}::uuid
      AND status IN ('pending_payment','paid')
  `) as Array<{ n: number; cents: string }>;

  const avg = (await sql`
    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (fulfilled_at - paid_at))),0)::int secs
    FROM public.sales
    WHERE bucket_id=${clientId}::uuid
      AND fulfilled_at IS NOT NULL
      AND paid_at IS NOT NULL
  `) as Array<{ secs: number }>;

  const cur = (await sql`
    SELECT base_currency FROM public.clients WHERE id=${clientId}::uuid LIMIT 1
  `) as Array<{ base_currency: string }>;

  const backordersActive = (await sql`
    SELECT COUNT(*)::int n FROM public.orders_backorders
    WHERE client_id=${clientId}::uuid AND status IN ('queued','partially_fulfilled')
  `) as Array<{ n: number }>;

  // sla_breaches — count how many sale-stage durations exceed their target.
  // Uses the same derived+logged timeline approach as orders-sla.ts.
  const slaBreachesRow = (await sql`
    WITH
    derived AS (
      SELECT id AS sale_id, created_at AS entered_at, 'pending_payment'::order_stage AS stage
      FROM public.sales WHERE bucket_id = ${clientId}::uuid
      UNION ALL
      SELECT id, paid_at, 'paid'::order_stage
      FROM public.sales WHERE bucket_id = ${clientId}::uuid AND paid_at IS NOT NULL
      UNION ALL
      SELECT id, fulfilled_at, 'fulfilled'::order_stage
      FROM public.sales WHERE bucket_id = ${clientId}::uuid AND fulfilled_at IS NOT NULL
      UNION ALL
      SELECT id, cancelled_at, 'cancelled'::order_stage
      FROM public.sales WHERE bucket_id = ${clientId}::uuid AND cancelled_at IS NOT NULL
      UNION ALL
      SELECT id, refunded_at, 'refunded'::order_stage
      FROM public.sales WHERE bucket_id = ${clientId}::uuid AND refunded_at IS NOT NULL
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
        sale_id, stage, entered_at,
        LEAD(entered_at) OVER (PARTITION BY sale_id ORDER BY entered_at) AS next_at
      FROM timeline
    )
    SELECT COUNT(*)::int n
    FROM windowed w
    JOIN public.orders_sla_targets t
      ON t.client_id = ${clientId}::uuid AND t.stage = w.stage
    WHERE EXTRACT(EPOCH FROM (COALESCE(w.next_at, now()) - w.entered_at)) / 60 > t.max_minutes
  `) as Array<{ n: number }>;

  return jsonOk({
    base_currency: cur[0]?.base_currency ?? 'USD',
    by_status: byStatus.map((r) => ({ status: r.status, n: r.n, cents: Number(r.cents) })),
    by_channel: byChannel.map((r) => ({ channel: r.channel, n: r.n, cents: Number(r.cents) })),
    open: { n: open[0]?.n ?? 0, cents: Number(open[0]?.cents ?? 0) },
    avg_fulfil_secs: avg[0]?.secs ?? 0,
    backorders_active: backordersActive[0]?.n ?? 0,
    sla_breaches: slaBreachesRow[0]?.n ?? 0,
  });
}
