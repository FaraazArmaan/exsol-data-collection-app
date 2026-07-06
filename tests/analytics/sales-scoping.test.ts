// Guards the load-bearing scope/authz invariants the spec designates as
// load-bearing (spec §5, §10): storefront-at-root exclusion, cross-subtree
// isolation + additivity, and export scoping. The endpoint predicates are
// correct by inspection; these tests stop a future edit from silently
// re-introducing a revenue leak across the org tree.

import { describe, it, expect, beforeAll } from 'vitest';
import salesHandler from '../../netlify/functions/analytics-sales';
import exportHandler from '../../netlify/functions/analytics-sales-export';
import { insertSale, seedOneProduct, enableAnalytics } from './_analytics-helpers';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';

const FROM = '2026-02-10';
const TO = '2026-02-10';
const WHEN = `${FROM}T10:00:00Z`;
const revenueOf = async (res: Response) =>
  (await res.json()).kpis.find((k: any) => k.id === 'revenue').value;

describe('storefront-at-root exclusion', () => {
  let base: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;
  let sub: Awaited<ReturnType<typeof seedSubordinateUser>>;

  beforeAll(async () => {
    base = await seedClientWithProductsEnabled();
    await enableAnalytics(base);
    await grantPerms(base.clientId, 1, ['analytics.business.view']);
    const pid = await seedOneProduct(base.clientId);
    // owner POS sale (1000) + storefront house sale (2000, no creator) + a
    // subordinate's own POS sale (500).
    await insertSale(base.clientId, { nodeId: base.userNodeId, source: 'pos', channel: 'instore', priceCents: 1000, when: WHEN, productId: pid, orderNo: 1 });
    await insertSale(base.clientId, { nodeId: null, source: 'storefront', channel: 'online', priceCents: 2000, when: WHEN, productId: pid, orderNo: 2 });
    sub = await seedSubordinateUser(base, 2, ['analytics.business.view']);
    await insertSale(base.clientId, { nodeId: sub.userNodeId, source: 'pos', channel: 'instore', priceCents: 500, when: WHEN, productId: pid, orderNo: 3 });
  });

  it('owner (root scope) sees POS + storefront house revenue', async () => {
    const rev = await revenueOf(await salesHandler(
      makeBucketUserRequest(base, 'GET', `/api/analytics-sales?from=${FROM}&to=${TO}`)));
    expect(rev).toBe(3500); // 1000 + 2000 + 500
  });

  it('subtree manager sees ONLY their own POS sale — not storefront, not the parent', async () => {
    const rev = await revenueOf(await salesHandler(
      makeBucketUserRequest(sub, 'GET', `/api/analytics-sales?from=${FROM}&to=${TO}`)));
    expect(rev).toBe(500); // excludes the 2000 storefront AND the 1000 parent POS
  });

  it('export under subtree scope excludes storefront and parent rows', async () => {
    const res = await exportHandler(
      makeBucketUserRequest(sub, 'GET', `/api/analytics-sales-export?from=${FROM}&to=${TO}&format=csv`));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('500');     // sub's own revenue present
    expect(text).not.toContain('2000'); // storefront absent
    expect(text).not.toContain('1000'); // parent POS absent
  });
});

describe('cross-subtree isolation + additivity', () => {
  let base: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;
  let mgrA: Awaited<ReturnType<typeof seedSubordinateUser>>;
  let mgrB: Awaited<ReturnType<typeof seedSubordinateUser>>;

  beforeAll(async () => {
    base = await seedClientWithProductsEnabled();
    await enableAnalytics(base);
    await grantPerms(base.clientId, 1, ['analytics.business.view']);
    const pid = await seedOneProduct(base.clientId);
    // Two sibling managers (both L2 → share the L2 perm row, both granted). The
    // owner has no sales of their own, so owner total must equal A + B exactly.
    mgrA = await seedSubordinateUser(base, 2, ['analytics.business.view']);
    mgrB = await seedSubordinateUser(base, 2, ['analytics.business.view']);
    await insertSale(base.clientId, { nodeId: mgrA.userNodeId, source: 'pos', channel: 'instore', priceCents: 700, when: WHEN, productId: pid, orderNo: 1 });
    await insertSale(base.clientId, { nodeId: mgrB.userNodeId, source: 'pos', channel: 'instore', priceCents: 900, when: WHEN, productId: pid, orderNo: 2 });
  });

  it('each manager sees only their own subtree revenue', async () => {
    const a = await revenueOf(await salesHandler(makeBucketUserRequest(mgrA, 'GET', `/api/analytics-sales?from=${FROM}&to=${TO}`)));
    const b = await revenueOf(await salesHandler(makeBucketUserRequest(mgrB, 'GET', `/api/analytics-sales?from=${FROM}&to=${TO}`)));
    expect(a).toBe(700);
    expect(b).toBe(900);
  });

  it('owner total equals the sum of the sibling subtrees (additive)', async () => {
    const owner = await revenueOf(await salesHandler(makeBucketUserRequest(base, 'GET', `/api/analytics-sales?from=${FROM}&to=${TO}`)));
    expect(owner).toBe(1600); // 700 + 900, no double-counting, no orphan revenue
  });
});
