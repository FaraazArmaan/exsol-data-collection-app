import { describe, it, expect } from 'vitest';
import returnsHandler from '../../netlify/functions/inventory-returns';
import { seedInventoryClient, seedStock, readStock, readMovements } from './_helpers';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';

type Ctx = Awaited<ReturnType<typeof seedInventoryClient>>;
const post = (ctx: Ctx, body: unknown) =>
  returnsHandler(makeBucketUserRequest(ctx, 'POST', '/api/inventory/returns', body));

describe('inventory returns & RMA', () => {
  it('400 when disposition is missing', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    expect((await post(ctx, { product_id: p, qty: 2 })).status).toBe(400);
  });

  it('404 for a product owned by another client', async () => {
    const ctx = await seedInventoryClient();
    const other = await seedInventoryClient();
    const foreign = (await seedProducts(other.clientId, [{ name: 'F' }]))[0]!;
    expect((await post(ctx, { product_id: foreign, qty: 1, disposition: 'restock' })).status).toBe(404);
  });

  it('restock adds to stock and writes a return movement', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await seedStock(ctx, p, 10, 5);
    const res = await post(ctx, { product_id: p, qty: 3, disposition: 'restock', reason: 'changed mind' });
    expect(res.status).toBe(201);
    expect((await readStock(ctx, p))?.qty_on_hand).toBe(13);
    const mv = await readMovements(ctx, p);
    expect(mv[0]!.type).toBe('return');
    expect(mv[0]!.qty_delta).toBe(3);
  });

  it('writeoff records a movement without changing on-hand stock', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await seedStock(ctx, p, 10, 5);
    const res = await post(ctx, { product_id: p, qty: 2, disposition: 'writeoff', reason: 'damaged' });
    expect(res.status).toBe(201);
    expect((await readStock(ctx, p))?.qty_on_hand).toBe(10);
    const mv = await readMovements(ctx, p);
    expect(mv[0]!.type).toBe('writeoff');
    expect(mv[0]!.qty_delta).toBe(0);
  });

  it('lists returns newest-first', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await seedStock(ctx, p, 10, 5);
    await post(ctx, { product_id: p, qty: 1, disposition: 'restock' });
    const res = await returnsHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/returns'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.returns.length).toBe(1);
    expect(body.returns[0].disposition).toBe('restock');
  });
});
