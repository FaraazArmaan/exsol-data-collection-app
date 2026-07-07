import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

// A campaign's attributed revenue. Attribution is EMAIL-MATCH within a time
// window: a sale/booking counts toward a campaign when the buyer's email is one
// of the campaign's recipients AND the purchase happened in
// [sent_at, sent_at + attribution_window_days). There is no customer_id FK on
// sales/bookings (POS-v2 storefront guests are plain email rows), so email is
// the only stable join key — matched case-insensitively.
//
// Only "realised" revenue counts: sales in ('paid','fulfilled') and bookings in
// ('confirmed','completed'). Pending/cancelled/refunded rows are excluded so the
// dashboard reflects money actually earned, not merely initiated.
export interface CampaignRoi {
  id: string;
  name: string;
  sent_at: string | null;
  window_days: number;
  sends: number;
  attributed_orders: number;
  attributed_bookings: number;
  /** sales revenue attributed to the campaign, in minor units (cents). */
  order_cents: number;
  /** booking revenue attributed to the campaign, in minor units (cents). */
  booking_cents: number;
  /** order_cents + booking_cents — total attributed revenue in minor units. */
  revenue_cents: number;
}

// Neon returns BIGINT sums as strings and count(*)::int as numbers; normalise both.
function num(v: unknown): number {
  return typeof v === 'string' ? Number(v) : (v as number) ?? 0;
}

/**
 * ROI for every SENT campaign of a client, newest first. Set-based: one query,
 * correlated subqueries per campaign gated by the expression indexes from
 * migration 131.
 */
export async function roiForClient(sql: Sql, clientId: string): Promise<CampaignRoi[]> {
  const rows = (await sql`
    SELECT
      mc.id,
      mc.name,
      to_char(mc.sent_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS sent_at,
      mc.attribution_window_days AS window_days,
      (SELECT count(*)::int FROM public.campaign_sends cs WHERE cs.campaign_id = mc.id) AS sends,
      (SELECT count(*)::int FROM public.sales s
         WHERE s.bucket_id = mc.client_id
           AND s.status IN ('paid','fulfilled')
           AND s.created_at >= mc.sent_at
           AND s.created_at < mc.sent_at + make_interval(days => mc.attribution_window_days)
           AND lower(s.customer_email) IN (
             SELECT lower(cs.recipient_email) FROM public.campaign_sends cs
             WHERE cs.campaign_id = mc.id AND cs.recipient_email IS NOT NULL)
      ) AS attributed_orders,
      (SELECT coalesce(sum(s.total_cents),0) FROM public.sales s
         WHERE s.bucket_id = mc.client_id
           AND s.status IN ('paid','fulfilled')
           AND s.created_at >= mc.sent_at
           AND s.created_at < mc.sent_at + make_interval(days => mc.attribution_window_days)
           AND lower(s.customer_email) IN (
             SELECT lower(cs.recipient_email) FROM public.campaign_sends cs
             WHERE cs.campaign_id = mc.id AND cs.recipient_email IS NOT NULL)
      ) AS order_cents,
      (SELECT count(*)::int FROM public.bookings b
         WHERE b.bucket_id = mc.client_id
           AND b.status IN ('confirmed','completed')
           AND b.created_at >= mc.sent_at
           AND b.created_at < mc.sent_at + make_interval(days => mc.attribution_window_days)
           AND lower(b.customer_email) IN (
             SELECT lower(cs.recipient_email) FROM public.campaign_sends cs
             WHERE cs.campaign_id = mc.id AND cs.recipient_email IS NOT NULL)
      ) AS attributed_bookings,
      (SELECT coalesce(sum(b.price_cents),0) FROM public.bookings b
         WHERE b.bucket_id = mc.client_id
           AND b.status IN ('confirmed','completed')
           AND b.created_at >= mc.sent_at
           AND b.created_at < mc.sent_at + make_interval(days => mc.attribution_window_days)
           AND lower(b.customer_email) IN (
             SELECT lower(cs.recipient_email) FROM public.campaign_sends cs
             WHERE cs.campaign_id = mc.id AND cs.recipient_email IS NOT NULL)
      ) AS booking_cents
    FROM public.marketing_campaigns mc
    WHERE mc.client_id = ${clientId}::uuid AND mc.status = 'sent'
    ORDER BY mc.sent_at DESC NULLS LAST
  `) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const order_cents = num(r.order_cents);
    const booking_cents = num(r.booking_cents);
    return {
      id: r.id as string,
      name: r.name as string,
      sent_at: (r.sent_at as string) ?? null,
      window_days: num(r.window_days),
      sends: num(r.sends),
      attributed_orders: num(r.attributed_orders),
      attributed_bookings: num(r.attributed_bookings),
      order_cents,
      booking_cents,
      revenue_cents: order_cents + booking_cents,
    };
  });
}

export interface RoiTotals {
  campaigns: number;
  sends: number;
  attributed_orders: number;
  attributed_bookings: number;
  revenue_cents: number;
}

export function roiTotals(rows: CampaignRoi[]): RoiTotals {
  return rows.reduce<RoiTotals>(
    (acc, r) => ({
      campaigns: acc.campaigns + 1,
      sends: acc.sends + r.sends,
      attributed_orders: acc.attributed_orders + r.attributed_orders,
      attributed_bookings: acc.attributed_bookings + r.attributed_bookings,
      revenue_cents: acc.revenue_cents + r.revenue_cents,
    }),
    { campaigns: 0, sends: 0, attributed_orders: 0, attributed_bookings: 0, revenue_cents: 0 },
  );
}
