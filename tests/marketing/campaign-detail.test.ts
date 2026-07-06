import { describe, it, expect } from 'vitest';
import detailHandler from '../../netlify/functions/marketing-campaign-detail';
import createHandler from '../../netlify/functions/marketing-campaign-create';
import { seedClientWithMarketing, enableMarketing, marketingRequest } from './_helpers';

describe('GET /api/marketing/campaigns/:id', () => {
  it('returns the campaign with an (empty) sends array', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns',
      { name: 'N', subject: 'S', body_html: '<p>x</p>', audience: 'all' }));
    const id = (await c.json()).campaign.id;
    const res = await detailHandler(marketingRequest(ctx, 'GET', `/api/marketing/campaigns/${id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.campaign.id).toBe(id);
    expect(Array.isArray(body.sends)).toBe(true);
  });
  it('404 for unknown id', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const res = await detailHandler(marketingRequest(ctx, 'GET', '/api/marketing/campaigns/00000000-0000-0000-0000-000000000000'));
    expect(res.status).toBe(404);
  });
});
