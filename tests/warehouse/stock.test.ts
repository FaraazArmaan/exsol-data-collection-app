import { describe, it, expect } from 'vitest';
import stockHandler from '../../netlify/functions/warehouse-stock';
import { makeBucketUserRequest, seedProducts } from '../pos/_helpers';
import { seedWarehouseClient, seedLocation, seedStockAt, randName } from './_helpers';

const stock = (ctx: Awaited<ReturnType<typeof seedWarehouseClient>>, qs = '') =>
  stockHandler(makeBucketUserRequest(ctx, 'GET', `/api/warehouse/stock${qs}`));

describe('GET /api/warehouse/stock', () => {
  it('returns per-location rows scoped to the client', async () => {
    const ctx = await seedWarehouseClient();
    const product = (await seedProducts(ctx.clientId, [{ name: randName('P') }]))[0]!;
    const loc = await seedLocation(ctx, randName('Main'));
    await seedStockAt(loc, product, 12);

    const res = await stock(ctx);
    expect(res.status).toBe(200);
    const items = (await res.json()).items as Array<{ location_id: string; product_id: string; qty: number }>;
    const row = items.find((i) => i.location_id === loc && i.product_id === product);
    expect(row?.qty).toBe(12);
  });

  it('does not leak another client\'s stock rows', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const foreignProduct = (await seedProducts(other.clientId, [{ name: randName('P') }]))[0]!;
    const foreignLoc = await seedLocation(other, randName('Foreign'));
    await seedStockAt(foreignLoc, foreignProduct, 99);

    const items = (await (await stock(ctx)).json()).items as Array<{ location_id: string }>;
    expect(items.map((i) => i.location_id)).not.toContain(foreignLoc);
  });

  it('filters by location_id when provided', async () => {
    const ctx = await seedWarehouseClient();
    const product = (await seedProducts(ctx.clientId, [{ name: randName('P') }]))[0]!;
    const a = await seedLocation(ctx, randName('A'));
    const b = await seedLocation(ctx, randName('B'));
    await seedStockAt(a, product, 3);
    await seedStockAt(b, product, 7);

    const items = (await (await stock(ctx, `?location_id=${a}`)).json()).items as Array<{ location_id: string }>;
    expect(items.every((i) => i.location_id === a)).toBe(true);
  });
});
