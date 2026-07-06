import { describe, it, expect } from 'vitest';
import sendHandler from '../../netlify/functions/marketing-campaign-send';
import createHandler from '../../netlify/functions/marketing-campaign-create';
import { seedClientWithMarketing, enableMarketing, seedCrmCustomer, marketingRequest, sqlClient } from './_helpers';

const sql = sqlClient();

describe('POST /api/marketing/send', () => {
  it('fans out to emailable audience, logs sends, flips to sent; re-send 409', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    await seedCrmCustomer(ctx.clientId, { email: `s1-${Math.random().toString(36).slice(2)}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: `s2-${Math.random().toString(36).slice(2)}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: null }); // excluded
    const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns',
      { name: 'Blast', subject: 'Hello', body_html: '<p>Deal</p>', audience: 'all' }));
    const id = (await c.json()).campaign.id;

    const res = await sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(2); // only emailable
    expect(body.byStatus).toMatchObject({ logged: 2 });

    const sends = (await sql`SELECT status FROM public.campaign_sends WHERE campaign_id = ${id}`) as { status: string }[];
    expect(sends).toHaveLength(2);
    expect(sends.every((s) => s.status === 'logged')).toBe(true); // no RESEND_API_KEY in tests

    const camp = (await sql`SELECT status FROM public.marketing_campaigns WHERE id = ${id}`) as { status: string }[];
    expect(camp[0]!.status).toBe('sent');

    const again = await sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: id }));
    expect(again.status).toBe(409);
  });

  it('concurrent sends: exactly one wins (200), the other loses (409), sends count equals audience size', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const tag = Math.random().toString(36).slice(2);
    await seedCrmCustomer(ctx.clientId, { email: `race-a-${tag}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: `race-b-${tag}@x.com` });
    const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns',
      { name: `RaceBlast-${tag}`, subject: 'Race', body_html: '<p>Race</p>', audience: 'all' }));
    const id = (await c.json()).campaign.id;

    const [r1, r2] = await Promise.all([
      sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: id })),
      sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: id })),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const sends = (await sql`SELECT count(*)::int AS n FROM public.campaign_sends WHERE campaign_id = ${id}::uuid`) as { n: number }[];
    expect(sends[0]!.n).toBe(2); // audience size, NOT double (4)
  });

  it('404 for unknown campaign', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const res = await sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: '00000000-0000-0000-0000-000000000000' }));
    expect(res.status).toBe(404);
  });
});
