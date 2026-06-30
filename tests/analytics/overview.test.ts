import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/analytics-overview';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;
beforeAll(async () => {
  ctx = await seedClientWithProductsEnabled();
  await grantPerms(ctx.clientId, 1, []); // L1 owner — bypasses
});

const W = 'from=2026-03-01&to=2026-03-01';

describe('GET /api/analytics-overview', () => {
  it('owner gets all four headline buckets', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/analytics-overview?${W}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect([...body.buckets].sort()).toEqual(['business', 'customers', 'employees', 'products']);
    expect(body.kpis.length).toBe(4);
  });

  it('a sub with only business sees only the business headline', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, ['analytics.business.view']);
    const res = await handler(makeBucketUserRequest(sub, 'GET', `/api/analytics-overview?${W}`));
    const body = await res.json();
    expect(body.buckets).toEqual(['business']);
    expect(body.kpis.every((k: any) => k.id === 'revenue')).toBe(true);
  });

  it('a sub with no analytics keys is 403', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', `/api/analytics-overview?${W}`));
    expect(res.status).toBe(403);
  });
});
