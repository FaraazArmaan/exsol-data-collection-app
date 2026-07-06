import { describe, it, expect, beforeAll } from 'vitest';
import { resolveAnalyticsAccess } from '../../netlify/functions/_analytics-authz';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';
import { enableAnalytics } from './_analytics-helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;

beforeAll(async () => {
  ctx = await seedClientWithProductsEnabled();
  await enableAnalytics(ctx);
  await grantPerms(ctx.clientId, 1, []); // L1 owner — bypasses matrix anyway
});

describe('resolveAnalyticsAccess', () => {
  it('L1 owner is root scope with all four buckets', async () => {
    const r = await resolveAnalyticsAccess(makeBucketUserRequest(ctx, 'GET', '/api/analytics-sales'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.access.isRootScope).toBe(true);
    expect(r.access.scopeNodes).toBeNull();
    expect(r.access.buckets.has('business')).toBe(true);
    expect(r.access.buckets.size).toBe(4);
  });

  // Each distinct-permission L2 case uses its OWN client: subordinates are
  // level 2 (direct children of the L1 owner — the user_nodes trigger requires
  // child.level === parent.level + 1), and seedSubordinateUser writes the single
  // client_levels row for that level, so sharing a client would overwrite perms.
  it('L2 with only analytics.business.view is subtree-scoped and lacks other buckets', async () => {
    const base = await seedClientWithProductsEnabled();
    await enableAnalytics(base);
    const sub = await seedSubordinateUser(base, 2, ['analytics.business.view']);
    const r = await resolveAnalyticsAccess(
      makeBucketUserRequest(sub, 'GET', '/api/analytics-sales'), 'business');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.access.isRootScope).toBe(false);
    expect(r.access.scopeNodes).toContain(sub.userNodeId);
    expect(r.access.buckets.has('business')).toBe(true);
    expect(r.access.buckets.has('customers')).toBe(false);
  });

  it('L2 with customers (not business) still resolves when no specific bucket is required', async () => {
    const base = await seedClientWithProductsEnabled();
    await enableAnalytics(base);
    const sub = await seedSubordinateUser(base, 2, ['analytics.customers.view']);
    const r = await resolveAnalyticsAccess(makeBucketUserRequest(sub, 'GET', '/api/analytics-overview'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.access.buckets.has('customers')).toBe(true);
    expect(r.access.buckets.has('business')).toBe(false);
  });

  it('L2 lacking the required bucket is forbidden', async () => {
    const base = await seedClientWithProductsEnabled();
    await enableAnalytics(base);
    const sub = await seedSubordinateUser(base, 2, []); // no analytics keys
    const r = await resolveAnalyticsAccess(
      makeBucketUserRequest(sub, 'GET', '/api/analytics-sales'), 'business');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.res.status).toBe(403);
  });

  it('a client without the analytics product enabled → 412 (enable-gate before owner bypass)', async () => {
    // L1 Owner, full perms — but the client has NOT enabled the analytics product.
    const other = await seedClientWithProductsEnabled();
    await grantPerms(other.clientId, 1, []);
    const r = await resolveAnalyticsAccess(makeBucketUserRequest(other, 'GET', '/api/analytics-sales'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.res.status).toBe(412);
  });

  it('no session → 401', async () => {
    const r = await resolveAnalyticsAccess(new Request('https://x.test/api/analytics-sales'), 'business');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.res.status).toBe(401);
  });
});
