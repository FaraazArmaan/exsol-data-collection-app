// tests/manufacturing/advance.test.ts
import { describe, it, expect } from 'vitest';
import advanceHandler from '../../netlify/functions/manufacturing-order-advance';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';
import { seedManufacturingClient, seedBom, seedOrder, readOrderStatus } from './_helpers';
import { seedStock, readStock, readMovements } from '../inventory/_helpers';

const advance = (ctx: any, id: string, to: string) =>
  advanceHandler(makeBucketUserRequest(ctx, 'POST', `/api/manufacturing/order-advance/${id}`, { to }));

describe('manufacturing order advance', () => {
  it('golden: planned→in_progress→done consumes components and produces output', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1, c2] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }, { name: 'Comb' }]) as [string, string, string];
    await seedStock(ctx, c1, 100);
    await seedStock(ctx, c2, 100);
    await seedStock(ctx, out, 0);
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 2 }, { productId: c2, qty: 1 }]);
    const orderId = await seedOrder(ctx, bomId, 5); // needs 10 c1, 5 c2

    expect((await advance(ctx, orderId, 'in_progress')).status).toBe(200);
    const done = await advance(ctx, orderId, 'done');
    expect(done.status).toBe(200);

    expect((await readStock(ctx, c1))?.qty_on_hand).toBe(90);
    expect((await readStock(ctx, c2))?.qty_on_hand).toBe(95);
    expect((await readStock(ctx, out))?.qty_on_hand).toBe(5);
    expect(await readOrderStatus(orderId)).toBe('done');

    const outMoves = await readMovements(ctx, out);
    expect(outMoves.some((m) => m.type === 'production' && m.qty_delta === 5)).toBe(true);
    const c1Moves = await readMovements(ctx, c1);
    expect(c1Moves.some((m) => m.type === 'production' && m.qty_delta === -10)).toBe(true);
  });

  it('insufficient stock → 409, nothing written, order stays in_progress', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]) as [string, string];
    await seedStock(ctx, c1, 3); // need 2*5 = 10
    await seedStock(ctx, out, 0);
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 2 }]);
    const orderId = await seedOrder(ctx, bomId, 5, 'in_progress');

    const res = await advance(ctx, orderId, 'done');
    expect(res.status).toBe(409);
    const b = await res.json();
    expect(b.error.code).toBe('insufficient_stock');
    expect(b.error.details.shortfalls[0]).toMatchObject({ product_id: c1, need: 10, have: 3 });
    expect((await readStock(ctx, c1))?.qty_on_hand).toBe(3); // untouched
    expect((await readStock(ctx, out))?.qty_on_hand).toBe(0); // untouched
    expect(await readOrderStatus(orderId)).toBe('in_progress');
  });

  it('409 illegal_transition for planned→done', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]) as [string, string];
    await seedStock(ctx, c1, 100);
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 1 }]);
    const orderId = await seedOrder(ctx, bomId, 1, 'planned');
    const res = await advance(ctx, orderId, 'done');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('illegal_transition');
  });

  it('cancels a planned order', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]) as [string, string];
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 1 }]);
    const orderId = await seedOrder(ctx, bomId, 1, 'planned');
    expect((await advance(ctx, orderId, 'cancelled')).status).toBe(200);
    expect(await readOrderStatus(orderId)).toBe('cancelled');
  });

  it('in_progress→cancelled is legal', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]) as [string, string];
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 1 }]);
    const orderId = await seedOrder(ctx, bomId, 1, 'in_progress');
    const res = await advance(ctx, orderId, 'cancelled');
    expect(res.status).toBe(200);
    expect(await readOrderStatus(orderId)).toBe('cancelled');
  });

  it('done records a movement for the second component', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1, c2] = await seedProducts(ctx.clientId, [{ name: 'Widget' }, { name: 'Bolt' }, { name: 'Nut' }]) as [string, string, string];
    await seedStock(ctx, c1, 100);
    await seedStock(ctx, c2, 100);
    await seedStock(ctx, out, 0);
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 2 }, { productId: c2, qty: 1 }]);
    const orderId = await seedOrder(ctx, bomId, 5, 'in_progress'); // needs 10 c1, 5 c2

    const res = await advance(ctx, orderId, 'done');
    expect(res.status).toBe(200);

    const c1Moves = await readMovements(ctx, c1);
    expect(c1Moves.some((m) => m.type === 'production' && m.qty_delta === -10)).toBe(true);
    const c2Moves = await readMovements(ctx, c2);
    expect(c2Moves.some((m) => m.type === 'production' && m.qty_delta === -5)).toBe(true);
  });

  it('invalid to value → 400 invalid_to', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]) as [string, string];
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 1 }]);
    const orderId = await seedOrder(ctx, bomId, 1, 'planned');
    const res = await advance(ctx, orderId, 'finished');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_to');
  });
});
