import { describe, it, expect } from 'vitest';
import adjustHandler from '../../netlify/functions/inventory-adjust';
import { seedProducts, seedClientWithProductsEnabled, makeBucketUserRequest } from '../pos/_helpers';
import { seedInventoryClient, seedStock, readStock, readMovements } from './_helpers';

const adjust = (ctx: Awaited<ReturnType<typeof seedInventoryClient>>, body: unknown) =>
  adjustHandler(makeBucketUserRequest(ctx, 'POST', '/api/inventory/adjust', body));

describe('POST /api/inventory/adjust', () => {
  it('400 reason_required when reason is missing', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await seedStock(ctx, p, 10);
    const res = await adjust(ctx, { product_id: p, qty_delta: 5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('reason_required');
  });

  it('400 qty_delta_required when the delta is zero', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const res = await adjust(ctx, { product_id: p, qty_delta: 0, reason: 'x' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('qty_delta_required');
  });

  it('404 for a product owned by a different client', async () => {
    const ctx = await seedInventoryClient();
    const other = await seedClientWithProductsEnabled();
    const foreign = (await seedProducts(other.clientId, [{ name: 'Foreign' }]))[0]!;
    const res = await adjust(ctx, { product_id: foreign, qty_delta: 5, reason: 'x' });
    expect(res.status).toBe(404);
  });

  it('applies a positive delta and writes an adjustment movement', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await seedStock(ctx, p, 10);
    const res = await adjust(ctx, { product_id: p, qty_delta: 7, reason: 'restock' });
    expect(res.status).toBe(200);
    expect((await res.json()).qty_on_hand).toBe(17);
    expect((await readStock(ctx, p))?.qty_on_hand).toBe(17);
    const mv = await readMovements(ctx, p);
    expect(mv[0]!.qty_delta).toBe(7);
    expect(mv[0]!.type).toBe('adjustment');
    expect(mv[0]!.ref).toBe('restock');
  });

  it('clamps at zero on an over-large negative delta', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await seedStock(ctx, p, 3);
    const res = await adjust(ctx, { product_id: p, qty_delta: -10, reason: 'shrinkage' });
    expect(res.status).toBe(200);
    expect((await res.json()).qty_on_hand).toBe(0);
  });

  it('upserts a stock row for a product that has none yet', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const res = await adjust(ctx, { product_id: p, qty_delta: 12, reason: 'opening' });
    expect(res.status).toBe(200);
    expect((await res.json()).qty_on_hand).toBe(12);
  });
});
