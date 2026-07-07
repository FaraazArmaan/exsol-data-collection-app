// tests/orders/authz.test.ts
import { describe, it, expect } from 'vitest';
import dashboardHandler from '../../netlify/functions/orders-dashboard';
import { seedClientWithProductsEnabled, seedSubordinateUser, makeBucketUserRequest } from '../pos/_helpers';
import { seedOrdersClient } from './_helpers';

const getDashboard = (ctx: Awaited<ReturnType<typeof seedOrdersClient>>) =>
  dashboardHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/dashboard'));

describe('orders authz', () => {
  it('412 when the orders module is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled(); // products+pos only
    const res = await dashboardHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/dashboard'));
    expect(res.status).toBe(412);
    expect((await res.json()).error.code).toBe('orders_module_not_enabled');
  });

  it('200 for an L1 Owner (all-on bypass) when enabled', async () => {
    const ctx = await seedOrdersClient();
    const res = await getDashboard(ctx);
    expect(res.status).toBe(200);
  });

  it('403 for an L2 user lacking orders.business.view', async () => {
    const base = await seedOrdersClient();
    const sub = await seedSubordinateUser(base, 2, []); // no keys
    const res = await dashboardHandler(makeBucketUserRequest(sub, 'GET', '/api/orders/dashboard'));
    expect(res.status).toBe(403);
  });
});
