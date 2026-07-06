import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/marketing-audience-count';
import { seedClientWithMarketing, enableMarketing, seedCrmCustomer, marketingRequest, demoteToL2 } from './_helpers';

describe('GET /api/marketing/audience-count', () => {
  it('401 unauthenticated', async () => {
    const res = await handler(new Request('http://localhost/api/marketing/audience-count?audience=all'));
    expect(res.status).toBe(401);
  });
  it('412 when marketing not enabled', async () => {
    const ctx = await seedClientWithMarketing();
    const res = await handler(marketingRequest(ctx, 'GET', '/api/marketing/audience-count?audience=all'));
    expect(res.status).toBe(412);
  });
  it('403 for L2 without view perm', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const l2 = await demoteToL2(ctx);
    const res = await handler(marketingRequest(l2, 'GET', '/api/marketing/audience-count?audience=all'));
    expect(res.status).toBe(403);
  });
  it('L1 owner gets the emailable count', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    await seedCrmCustomer(ctx.clientId, { email: `x-${Math.random().toString(36).slice(2)}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: null });
    const res = await handler(marketingRequest(ctx, 'GET', '/api/marketing/audience-count?audience=all'));
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
  });
});
