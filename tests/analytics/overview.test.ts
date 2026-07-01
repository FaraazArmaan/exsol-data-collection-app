import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/analytics-overview';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';
import { seedPaidSales } from './_analytics-helpers';

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

  it('windowed headlines carry a delta vs the comparison window', async () => {
    const D = '2026-02-20';
    const ctx = await seedPaidSales({ when: [`${D}T10:00:00Z`, `${D}T11:00:00Z`], channel: ['instore', 'instore'], priceCents: 1000 });
    const res = await handler(makeBucketUserRequest(ctx, 'GET',
      `/api/analytics-overview?from=${D}&to=${D}&compare=prior_period`));
    const body = await res.json();
    const revenue = body.kpis.find((k: any) => k.id === 'revenue');
    expect(revenue.value).toBe(2000);
    expect(revenue.delta).toBe(2000);   // prior day had no sales → +2000
    expect(revenue.deltaPct).toBeNull(); // no baseline
    // Snapshot headlines (team/catalog) have no delta.
    expect(body.kpis.find((k: any) => k.id === 'catalog').delta).toBeNull();
  });
});
