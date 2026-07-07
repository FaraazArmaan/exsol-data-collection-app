import { describe, it, expect } from 'vitest';
import dashboardHandler from '../../netlify/functions/inventory-dashboard';
import { seedInventoryClient, seedStock, seedPurchaseCost } from './_helpers';
import { seedProducts, makeBucketUserRequest, seedClientWithProductsEnabled } from '../pos/_helpers';

describe('GET /api/inventory/dashboard', () => {
  it('401 when unauthenticated', async () => {
    const res = await dashboardHandler(new Request('http://localhost/api/inventory/dashboard'));
    expect(res.status).toBe(401);
  });

  it('412 when inventory is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const res = await dashboardHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/dashboard'));
    expect(res.status).toBe(412);
  });

  it('returns KPIs + low-stock list for an owner', async () => {
    const ctx = await seedInventoryClient();
    const prods = await seedProducts(ctx.clientId, [{ name: 'Alpha' }, { name: 'Beta' }]);
    const p1 = prods[0]!;
    const p2 = prods[1]!;
    await seedStock(ctx, p1, 2, 5); // low
    await seedStock(ctx, p2, 40, 5); // ok

    const res = await dashboardHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/dashboard'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kpis.total_skus).toBe(2);
    expect(body.kpis.total_units).toBe(42);
    expect(body.kpis.low_stock_count).toBe(1);
    expect(body.lowStock.length).toBe(1);
    expect(body.lowStock[0].product_id).toBe(p1);
  });

  it('computes stock value from moving-average purchase cost', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'Costed' }]))[0]!;
    await seedStock(ctx, p, 10, 5);
    await seedPurchaseCost(ctx, p, 10, 500); // 10 units purchased @ 500 minor each
    const res = await dashboardHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/dashboard'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kpis.stock_value_minor).toBe(5000); // 10 on hand × 500 avg cost
    expect(body.topValue.length).toBe(1);
    expect(body.topValue[0].value_minor).toBe(5000);
    expect(body.topValue[0].unit_cost_minor).toBe(500);
  });

  it('returns an empty dashboard (not an error) for a client with no stock', async () => {
    const ctx = await seedInventoryClient();
    const res = await dashboardHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/dashboard'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kpis.total_skus).toBe(0);
    expect(body.lowStock).toEqual([]);
    expect(body.recentMovements).toEqual([]);
  });
});
