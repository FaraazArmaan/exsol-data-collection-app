import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-inventory';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';
import { seedInventoryData, enableSupplyChain } from './_helpers';

describe('GET /api/supply-chain-inventory', () => {
  it('returns low-stock rows, 30-day zero-filled series, and KPIs', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);
    await seedInventoryData(ctx.clientId);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-inventory'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // exactly one product is below reorder (qty 2 <= 10)
    expect(body.lowStock.length).toBe(1);
    expect(body.lowStock[0].qtyOnHand).toBe(2);
    expect(body.lowStock[0].reorderLevel).toBe(10);
    expect(body.lowStock[0].deficit).toBe(8);
    expect(body.kpis.lowStockCount).toBe(1);

    // series is a full 30-day window; volume = sum(abs(qty_delta)) = 5+20+3 = 28
    expect(body.movementSeries.length).toBe(30);
    expect(body.kpis.movementVolume30d).toBe(28);
    const total = body.movementSeries.reduce((a: number, p: any) => a + p.volume, 0);
    expect(total).toBe(28);
  });

  it('is 403 for a sub without the key', async () => {
    const base = await seedClientWithProductsEnabled();
    await enableSupplyChain(base);
    const sub = await seedSubordinateUser(base, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/supply-chain-inventory'));
    expect(res.status).toBe(403);
  });

  it('does not leak another tenant\'s rows', async () => {
    const a = await seedClientWithProductsEnabled();
    await enableSupplyChain(a);
    await grantPerms(a.clientId, 1, []);
    const b = await seedClientWithProductsEnabled();
    await seedInventoryData(b.clientId); // b has low-stock; a must not see it
    const res = await handler(makeBucketUserRequest(a, 'GET', '/api/supply-chain-inventory'));
    const body = await res.json();
    expect(body.lowStock.length).toBe(0);
  });
});
