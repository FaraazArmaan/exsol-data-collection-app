import { describe, it, expect } from 'vitest';
import roiHandler from '../../netlify/functions/marketing-roi';
import {
  seedClientWithMarketing, enableMarketing, grantMarketingPerms, demoteToL2,
  seedSale, seedBooking, marketingRequest, sqlClient,
} from './_helpers';

const sql = sqlClient();

// Insert a SENT campaign with a controlled sent_at + one recipient email.
async function seedSentCampaign(clientId: string, recipientEmail: string, sentAt: string, windowDays = 14): Promise<string> {
  const c = (await sql`
    INSERT INTO public.marketing_campaigns (client_id, name, subject, body_html, audience, status, sent_at, attribution_window_days)
    VALUES (${clientId}::uuid, ${'ROI ' + Math.random().toString(36).slice(2, 8)}, 'S', '<p>b</p>', 'all', 'sent', ${sentAt}::timestamptz, ${windowDays})
    RETURNING id`) as Array<{ id: string }>;
  const id = c[0]!.id;
  await sql`INSERT INTO public.campaign_sends (client_id, campaign_id, recipient_email, status)
            VALUES (${clientId}::uuid, ${id}::uuid, ${recipientEmail}, 'logged')`;
  return id;
}

describe('GET /api/marketing/roi', () => {
  it('attributes only realised sales/bookings by email within the window', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const tag = Math.random().toString(36).slice(2, 8);
    const buyer = `roi-${tag}@x.com`;
    const sentAt = '2026-05-01T00:00:00Z';
    const campaignId = await seedSentCampaign(ctx.clientId, buyer, sentAt, 14);

    // Attributed: matching email, within window, realised.
    await seedSale(ctx.clientId, { email: buyer, totalCents: 50_000, createdAt: '2026-05-03T00:00:00Z', status: 'paid' });
    await seedBooking(ctx.clientId, ctx.ownerNodeId, { email: buyer, priceCents: 20_000, createdAt: '2026-05-04T00:00:00Z', status: 'completed' });
    // NOT attributed: after window (day 20 > 14).
    await seedSale(ctx.clientId, { email: buyer, totalCents: 99_000, createdAt: '2026-05-21T00:00:00Z', status: 'paid' });
    // NOT attributed: different email.
    await seedSale(ctx.clientId, { email: `other-${tag}@x.com`, totalCents: 77_000, createdAt: '2026-05-03T00:00:00Z', status: 'paid' });
    // NOT attributed: matching + in-window but cancelled (unrealised).
    await seedSale(ctx.clientId, { email: buyer, totalCents: 88_000, createdAt: '2026-05-03T00:00:00Z', status: 'cancelled' });

    const res = await roiHandler(marketingRequest(ctx, 'GET', '/api/marketing/roi'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.campaigns.find((c: { id: string }) => c.id === campaignId);
    expect(row).toBeTruthy();
    expect(row.attributed_orders).toBe(1);
    expect(row.attributed_bookings).toBe(1);
    expect(row.order_cents).toBe(50_000);
    expect(row.booking_cents).toBe(20_000);
    expect(row.revenue_cents).toBe(70_000);
    expect(body.totals.revenue_cents).toBeGreaterThanOrEqual(70_000);
  });

  it('case-insensitive email match', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const tag = Math.random().toString(36).slice(2, 8);
    const campaignId = await seedSentCampaign(ctx.clientId, `Case-${tag}@X.com`, '2026-05-01T00:00:00Z', 14);
    await seedSale(ctx.clientId, { email: `case-${tag}@x.com`, totalCents: 30_000, createdAt: '2026-05-02T00:00:00Z', status: 'fulfilled' });

    const res = await roiHandler(marketingRequest(ctx, 'GET', '/api/marketing/roi'));
    const body = await res.json();
    const row = body.campaigns.find((c: { id: string }) => c.id === campaignId);
    expect(row.attributed_orders).toBe(1);
    expect(row.order_cents).toBe(30_000);
  });

  it('412 when marketing not enabled', async () => {
    const ctx = await seedClientWithMarketing();
    const res = await roiHandler(marketingRequest(ctx, 'GET', '/api/marketing/roi'));
    expect(res.status).toBe(412);
  });

  it('403 for L2 without customers.view; 200 once granted', async () => {
    const owner = await seedClientWithMarketing();
    await enableMarketing(owner.clientId);
    const l2 = await demoteToL2(owner);
    const denied = await roiHandler(marketingRequest(l2, 'GET', '/api/marketing/roi'));
    expect(denied.status).toBe(403);

    await grantMarketingPerms(owner.clientId, 2, ['marketing.customers.view']);
    const ok = await roiHandler(marketingRequest(l2, 'GET', '/api/marketing/roi'));
    expect(ok.status).toBe(200);
  });
});
