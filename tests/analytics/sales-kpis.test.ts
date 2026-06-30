import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/analytics-sales';
import { seedPaidSales } from './_analytics-helpers';
import { seedSubordinateUser, makeBucketUserRequest } from '../pos/_helpers';

// Fixed historical window so re-runs on the shared dev DB never collide with
// "today" data from other suites.
const FROM = '2026-03-02';
const TO = '2026-03-02';

let ctx: Awaited<ReturnType<typeof seedPaidSales>>;

beforeAll(async () => {
  ctx = await seedPaidSales({
    when: [`${FROM}T10:00:00Z`, `${FROM}T15:00:00Z`],
    channel: ['instore', 'instore'],
    priceCents: 1000,
  });
});

describe('GET /api/analytics-sales KPIs', () => {
  it('owner sees revenue + sales + AOV for the window', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/analytics-sales?from=${FROM}&to=${TO}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const k = (id: string) => body.kpis.find((x: any) => x.id === id);
    expect(k('revenue').value).toBe(2000);
    expect(k('sales').value).toBe(2);
    expect(k('aov').value).toBe(1000);
    expect(body.scope.isRootScope).toBe(true);
  });

  it('computes a delta vs the prior period', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET',
      `/api/analytics-sales?from=${FROM}&to=${TO}&compare=prior_period`));
    const body = await res.json();
    const rev = body.kpis.find((x: any) => x.id === 'revenue');
    // prior day (2026-03-01) had no sales → delta = +2000, deltaPct null (no baseline)
    expect(rev.delta).toBe(2000);
    expect(rev.deltaPct).toBeNull();
  });

  it('subordinate with no sales of their own sees zero revenue (subtree scoping)', async () => {
    const sub = await seedSubordinateUser(ctx, 2, ['analytics.business.view']);
    const res = await handler(makeBucketUserRequest(sub, 'GET', `/api/analytics-sales?from=${FROM}&to=${TO}`));
    const body = await res.json();
    expect(body.kpis.find((x: any) => x.id === 'revenue').value).toBe(0);
    expect(body.scope.isRootScope).toBe(false);
  });

  it('rejects a caller without analytics.business.view', async () => {
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', `/api/analytics-sales?from=${FROM}&to=${TO}`));
    expect(res.status).toBe(403);
  });
});
