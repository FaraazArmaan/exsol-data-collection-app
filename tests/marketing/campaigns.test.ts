import { describe, it, expect } from 'vitest';
import createHandler from '../../netlify/functions/marketing-campaign-create';
import listHandler from '../../netlify/functions/marketing-campaigns-list';
import { seedClientWithMarketing, enableMarketing, marketingRequest } from './_helpers';

const draft = () => ({ name: `Promo ${Math.random().toString(36).slice(2, 7)}`, subject: 'Hi', body_html: '<p>Deal</p>', audience: 'all' });

describe('marketing campaigns create + list', () => {
  it('creates a draft campaign then lists it', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns', draft()));
    expect(c.status).toBe(200);
    const created = (await c.json()).campaign;
    expect(created.status).toBe('draft');

    const l = await listHandler(marketingRequest(ctx, 'GET', '/api/marketing/campaigns'));
    expect(l.status).toBe(200);
    const ids = (await l.json()).campaigns.map((x: { id: string }) => x.id);
    expect(ids).toContain(created.id);
  });

  it('400 on missing fields', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const res = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns', { name: '', subject: '', body_html: '' }));
    expect(res.status).toBe(400);
  });

  it('401 unauthenticated on list', async () => {
    const res = await listHandler(new Request('http://localhost/api/marketing/campaigns'));
    expect(res.status).toBe(401);
  });
});
