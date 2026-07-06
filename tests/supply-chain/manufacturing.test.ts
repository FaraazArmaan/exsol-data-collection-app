import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-manufacturing';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';
import { seedManufacturingData } from './_helpers';

describe('GET /api/supply-chain-manufacturing', () => {
  it('returns only in_progress orders with the BOM output product', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    await seedManufacturingData(ctx.clientId); // 1 in_progress (qty 30) + 1 planned

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-manufacturing'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.orders.length).toBe(1);
    expect(body.orders[0].qty).toBe(30);
    expect(typeof body.orders[0].product).toBe('string');
    expect(body.orders[0].product.startsWith('Made')).toBe(true);
    expect(body.kpis.inProgressCount).toBe(1);
    expect(body.kpis.unitsInProduction).toBe(30);
  });

  it('is 403 for a sub without the key', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/supply-chain-manufacturing'));
    expect(res.status).toBe(403);
  });
});
