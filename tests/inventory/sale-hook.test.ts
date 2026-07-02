import { describe, it, expect } from 'vitest';
import createHandler from '../../netlify/functions/pos-sale-create';
import stateHandler from '../../netlify/functions/pos-sale-state';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';
import {
  seedInventoryClient, seedStock, setTrackingFlag, readStock, readMovements,
} from './_helpers';

// Create an instore sale for `qty` of `productId`, then markPaid — which for an
// instore sale auto-fulfills, firing the inventory decrement hook.
async function saleFulfilled(
  ctx: Awaited<ReturnType<typeof seedInventoryClient>>,
  productId: string,
  qty: number,
): Promise<string> {
  const created = await createHandler(
    makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'instore',
      idempotencyKey: crypto.randomUUID(),
      customer: { name: 'A', phone: '1' },
      lines: [{ productId, qty }],
    }),
  );
  const sid = (await created.json()).id as string;
  const res = await stateHandler(
    makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
      action: 'markPaid', paymentMethod: 'cash',
    }),
  );
  expect(res.status).toBe(200);
  expect((await res.json()).status).toBe('fulfilled');
  return sid;
}

describe('POS sale completion → inventory decrement hook', () => {
  it('decrements stock and writes a sale movement when tracking is ON', async () => {
    const ctx = await seedInventoryClient();
    await setTrackingFlag(ctx, true);
    const p = (await seedProducts(ctx.clientId, [{ name: 'Tracked', sale_price_cents: 100 }]))[0]!;
    await seedStock(ctx, p, 10);

    const sid = await saleFulfilled(ctx, p, 3);

    expect((await readStock(ctx, p))?.qty_on_hand).toBe(7);
    const mv = await readMovements(ctx, p);
    expect(mv[0]!.type).toBe('sale');
    expect(mv[0]!.qty_delta).toBe(-3);
    expect(mv[0]!.ref).toBe(`sale:${sid}`);
  });

  it('leaves stock untouched when tracking is OFF (legacy tenants unaffected)', async () => {
    const ctx = await seedInventoryClient();
    await setTrackingFlag(ctx, false);
    const p = (await seedProducts(ctx.clientId, [{ name: 'Untracked', sale_price_cents: 100 }]))[0]!;
    await seedStock(ctx, p, 10);

    await saleFulfilled(ctx, p, 4);

    expect((await readStock(ctx, p))?.qty_on_hand).toBe(10);
    expect((await readMovements(ctx, p)).length).toBe(0);
  });
});
