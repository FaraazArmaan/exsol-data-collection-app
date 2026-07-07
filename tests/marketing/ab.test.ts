import { describe, it, expect } from 'vitest';
import createHandler from '../../netlify/functions/marketing-campaign-create';
import sendHandler from '../../netlify/functions/marketing-campaign-send';
import abHandler from '../../netlify/functions/marketing-campaign-ab';
import trackHandler from '../../netlify/functions/marketing-public-track';
import { seedClientWithMarketing, enableMarketing, seedCrmCustomer, grantMarketingPerms, demoteToL2, marketingRequest, sqlClient } from './_helpers';

const sql = sqlClient();

function trackReq(kind: 'open' | 'click', params: Record<string, string>): Request {
  const qs = new URLSearchParams(params).toString();
  return new Request(`http://localhost/api/marketing/track/${kind}?${qs}`, { method: 'GET' });
}

describe('A/B testing + open/click tracking', () => {
  it('splits the audience into A/B, tracks opens per variant, and compares', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const tag = Math.random().toString(36).slice(2);
    for (let i = 0; i < 8; i++) await seedCrmCustomer(ctx.clientId, { email: `ab-${i}-${tag}@x.com` });

    const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns', {
      name: `AB-${tag}`, subject: 'Version A subject', body_html: '<p>Hi</p>', audience: 'all',
      is_ab: true, subject_b: 'Version B subject', ab_split: 50,
    }));
    const created = (await c.json()).campaign;
    expect(created.is_ab).toBe(true);
    const id = created.id;

    const sendRes = await sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: id }));
    const sendBody = await sendRes.json();
    expect(sendBody.byVariant.A + sendBody.byVariant.B).toBe(8);
    expect(sendBody.byVariant.A).toBeGreaterThan(0);
    expect(sendBody.byVariant.B).toBeGreaterThan(0);

    // Every send carries a variant.
    const sends = (await sql`SELECT id, variant FROM public.campaign_sends WHERE campaign_id = ${id}::uuid`) as Array<{ id: string; variant: string }>;
    expect(sends.length).toBe(8);
    expect(sends.every((s) => s.variant === 'A' || s.variant === 'B')).toBe(true);

    // Open the first two sends' pixels (twice each — unique opens must dedupe by send).
    const opened = sends.slice(0, 2);
    for (const s of opened) {
      const r1 = await trackHandler(trackReq('open', { s: s.id }));
      expect(r1.status).toBe(200);
      expect(r1.headers.get('Content-Type')).toBe('image/gif');
      await trackHandler(trackReq('open', { s: s.id })); // duplicate → still one unique open
    }

    const abRes = await abHandler(marketingRequest(ctx, 'GET', `/api/marketing/campaigns/${id}/ab`));
    expect(abRes.status).toBe(200);
    const ab = await abRes.json();
    expect(ab.is_ab).toBe(true);
    const totalSends = ab.variants.reduce((n: number, v: { sends: number }) => n + v.sends, 0);
    const totalOpens = ab.variants.reduce((n: number, v: { unique_opens: number }) => n + v.unique_opens, 0);
    expect(totalSends).toBe(8);
    expect(totalOpens).toBe(2); // deduped, not 4
  });

  it('click tracking 302-redirects and logs; open pixel swallows bad ids', async () => {
    const bad = await trackHandler(trackReq('open', { s: 'not-a-uuid' }));
    expect(bad.status).toBe(200); // still returns the pixel, logs nothing

    const noRedirect = await trackHandler(trackReq('click', { s: '11111111-1111-1111-1111-111111111111', u: 'javascript:alert(1)' }));
    expect(noRedirect.status).toBe(400); // non-http destination rejected

    const redirect = await trackHandler(trackReq('click', { s: '11111111-1111-1111-1111-111111111111', u: 'https://papas-saloon.test/deal' }));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('Location')).toBe('https://papas-saloon.test/deal');
  });

  it('ab endpoint honours view perm (403 for ungranted L2)', async () => {
    const owner = await seedClientWithMarketing();
    await enableMarketing(owner.clientId);
    const c = await createHandler(marketingRequest(owner, 'POST', '/api/marketing/campaigns',
      { name: `perm-${Math.random()}`, subject: 'S', body_html: '<p>x</p>', audience: 'all' }));
    const id = (await c.json()).campaign.id;
    const l2 = await demoteToL2(owner);
    const denied = await abHandler(marketingRequest(l2, 'GET', `/api/marketing/campaigns/${id}/ab`));
    expect(denied.status).toBe(403);
    await grantMarketingPerms(owner.clientId, 2, ['marketing.customers.view']);
    const ok = await abHandler(marketingRequest(l2, 'GET', `/api/marketing/campaigns/${id}/ab`));
    expect(ok.status).toBe(200);
  });
});
