import { describe, it, expect } from 'vitest';
import transferHandler from '../../netlify/functions/warehouse-transfer';
import { makeBucketUserRequest, seedProducts } from '../pos/_helpers';
import {
  seedWarehouseClient, seedLocation, seedStockAt, readStockAt, readTransferMovements, randName,
} from './_helpers';

const transfer = (ctx: Awaited<ReturnType<typeof seedWarehouseClient>>, body: unknown) =>
  transferHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/transfer', body));

describe('POST /api/warehouse/transfer', () => {
  it('golden flow: moves qty between locations and writes two transfer movements', async () => {
    const ctx = await seedWarehouseClient();
    const product = (await seedProducts(ctx.clientId, [{ name: randName('P') }]))[0]!;
    const from = await seedLocation(ctx, randName('From'));
    const to = await seedLocation(ctx, randName('To'));
    await seedStockAt(from, product, 10);

    const res = await transfer(ctx, { product_id: product, from_location_id: from, to_location_id: to, qty: 4 });
    expect(res.status).toBe(200);

    expect(await readStockAt(from, product)).toBe(6);
    expect(await readStockAt(to, product)).toBe(4);

    const mv = await readTransferMovements(ctx, product);
    expect(mv).toHaveLength(2);
    expect(mv.map((m) => m.qty_delta).sort((a, b) => a - b)).toEqual([-4, 4]);
    // net-zero on the product's total on-hand
    expect(mv.reduce((s, m) => s + m.qty_delta, 0)).toBe(0);
  });

  it('creates the destination stock row when it does not exist yet', async () => {
    const ctx = await seedWarehouseClient();
    const product = (await seedProducts(ctx.clientId, [{ name: randName('P') }]))[0]!;
    const from = await seedLocation(ctx, randName('From'));
    const to = await seedLocation(ctx, randName('To'));
    await seedStockAt(from, product, 5);

    expect(await readStockAt(to, product)).toBeNull();
    const res = await transfer(ctx, { product_id: product, from_location_id: from, to_location_id: to, qty: 5 });
    expect(res.status).toBe(200);
    expect(await readStockAt(to, product)).toBe(5);
    expect(await readStockAt(from, product)).toBe(0);
  });

  it('400 insufficient_stock when the source lacks the quantity', async () => {
    const ctx = await seedWarehouseClient();
    const product = (await seedProducts(ctx.clientId, [{ name: randName('P') }]))[0]!;
    const from = await seedLocation(ctx, randName('From'));
    const to = await seedLocation(ctx, randName('To'));
    await seedStockAt(from, product, 2);

    const res = await transfer(ctx, { product_id: product, from_location_id: from, to_location_id: to, qty: 5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('insufficient_stock');
    // unchanged
    expect(await readStockAt(from, product)).toBe(2);
  });

  it('400 same_location when from === to', async () => {
    const ctx = await seedWarehouseClient();
    const product = (await seedProducts(ctx.clientId, [{ name: randName('P') }]))[0]!;
    const loc = await seedLocation(ctx, randName());
    await seedStockAt(loc, product, 5);
    const res = await transfer(ctx, { product_id: product, from_location_id: loc, to_location_id: loc, qty: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('same_location');
  });

  it('400 qty_invalid for a non-positive quantity', async () => {
    const ctx = await seedWarehouseClient();
    const product = (await seedProducts(ctx.clientId, [{ name: randName('P') }]))[0]!;
    const from = await seedLocation(ctx, randName('From'));
    const to = await seedLocation(ctx, randName('To'));
    const res = await transfer(ctx, { product_id: product, from_location_id: from, to_location_id: to, qty: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('qty_invalid');
  });

  it('404 location_not_found when a location belongs to another client', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const product = (await seedProducts(ctx.clientId, [{ name: randName('P') }]))[0]!;
    const from = await seedLocation(ctx, randName('From'));
    const foreignTo = await seedLocation(other, randName('Foreign'));
    await seedStockAt(from, product, 5);
    const res = await transfer(ctx, { product_id: product, from_location_id: from, to_location_id: foreignTo, qty: 1 });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('location_not_found');
  });

  it('404 product_not_found for a foreign-client product', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const foreignProduct = (await seedProducts(other.clientId, [{ name: randName('P') }]))[0]!;
    const from = await seedLocation(ctx, randName('From'));
    const to = await seedLocation(ctx, randName('To'));
    const res = await transfer(ctx, { product_id: foreignProduct, from_location_id: from, to_location_id: to, qty: 1 });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('product_not_found');
  });
});
