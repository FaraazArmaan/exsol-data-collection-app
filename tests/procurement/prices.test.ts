import { describe, it, expect } from 'vitest';
import pricesHandler from '../../netlify/functions/procurement-prices';
import { seedProcurementClient, seedSupplier } from './_helpers';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';

type Ctx = Awaited<ReturnType<typeof seedProcurementClient>>;
const getJson = async (res: Response) => res.json();

describe('procurement price manager', () => {
  it('sets and lists a current price', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const set = await pricesHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/prices', {
      supplier_id: sup, product_id: p, unit_cost_cents: 12345,
    }));
    expect(set.status).toBe(201);
    const cur = await getJson(await pricesHandler(makeBucketUserRequest(ctx, 'GET', `/api/procurement/prices?supplier_id=${sup}`)));
    expect(cur.prices.length).toBe(1);
    expect(Number(cur.prices[0].unit_cost_cents)).toBe(12345);
    expect(cur.prices[0].product_name).toBe('P');
  });

  it('current = latest effective_from (ignoring future); history keeps all', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const set = (cost: number, date: string) =>
      pricesHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/prices', {
        supplier_id: sup, product_id: p, unit_cost_cents: cost, effective_from: date,
      }));
    await set(50000, '2026-01-01');
    await set(70000, '2026-06-01');
    await set(90000, '2099-01-01'); // future — excluded from current

    const cur = await getJson(await pricesHandler(makeBucketUserRequest(ctx, 'GET', `/api/procurement/prices?supplier_id=${sup}`)));
    expect(cur.prices.length).toBe(1);
    expect(Number(cur.prices[0].unit_cost_cents)).toBe(70000);

    const hist = await getJson(await pricesHandler(makeBucketUserRequest(ctx, 'GET', `/api/procurement/prices?supplier_id=${sup}&product_id=${p}`)));
    expect(hist.history.length).toBe(3);
    expect(Number(hist.history[0].unit_cost_cents)).toBe(90000); // newest effective_from first
  });

  it('400 for an invalid cost', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const res = await pricesHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/prices', {
      supplier_id: sup, product_id: p, unit_cost_cents: -5,
    }));
    expect(res.status).toBe(400);
  });

  it('404 setting a price for a foreign supplier', async () => {
    const ctx = await seedProcurementClient();
    const other = await seedProcurementClient();
    const foreignSup = await seedSupplier(other, 'Foreign');
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const res = await pricesHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/prices', {
      supplier_id: foreignSup, product_id: p, unit_cost_cents: 100,
    }));
    expect(res.status).toBe(404);
  });
});
