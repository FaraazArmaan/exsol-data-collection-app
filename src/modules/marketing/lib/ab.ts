import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

export interface VariantStats {
  variant: string; // 'A' | 'B' | 'all' (non-A/B campaigns land in one 'all' group)
  sends: number;
  unique_opens: number;
  unique_clicks: number;
  open_rate: number;  // 0..1
  click_rate: number; // 0..1
}

/**
 * Per-variant open/click stats for a campaign. Opens/clicks are counted UNIQUELY
 * per send (a pixel can fire many times), then grouped by the send's variant.
 * Non-A/B campaigns collapse to a single 'all' group.
 */
export async function campaignAbStats(sql: Sql, clientId: string, campaignId: string): Promise<VariantStats[]> {
  const rows = (await sql`
    WITH sends AS (
      SELECT coalesce(variant, 'all') AS v, id
      FROM public.campaign_sends
      WHERE campaign_id = ${campaignId}::uuid AND client_id = ${clientId}::uuid
    ),
    opens AS (
      SELECT DISTINCT send_id FROM public.marketing_campaign_events
      WHERE campaign_id = ${campaignId}::uuid AND kind = 'open' AND send_id IS NOT NULL
    ),
    clicks AS (
      SELECT DISTINCT send_id FROM public.marketing_campaign_events
      WHERE campaign_id = ${campaignId}::uuid AND kind = 'click' AND send_id IS NOT NULL
    )
    SELECT
      s.v AS variant,
      count(*)::int AS sends,
      count(*) FILTER (WHERE o.send_id IS NOT NULL)::int AS unique_opens,
      count(*) FILTER (WHERE c.send_id IS NOT NULL)::int AS unique_clicks
    FROM sends s
    LEFT JOIN opens o ON o.send_id = s.id
    LEFT JOIN clicks c ON c.send_id = s.id
    GROUP BY s.v
    ORDER BY s.v
  `) as Array<{ variant: string; sends: number; unique_opens: number; unique_clicks: number }>;

  return rows.map((r) => ({
    variant: r.variant,
    sends: r.sends,
    unique_opens: r.unique_opens,
    unique_clicks: r.unique_clicks,
    open_rate: r.sends > 0 ? r.unique_opens / r.sends : 0,
    click_rate: r.sends > 0 ? r.unique_clicks / r.sends : 0,
  }));
}
