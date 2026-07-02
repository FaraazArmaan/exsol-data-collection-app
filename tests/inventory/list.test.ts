import { describe, it, expect } from 'vitest';
import listHandler from '../../netlify/functions/inventory-list';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';
import { seedInventoryClient, seedStock } from './_helpers';

interface ListItem {
  product_id: string;
  name: string;
  qty_on_hand: number;
  low: boolean;
}

describe('GET /api/inventory/list', () => {
  it('returns stock rows with a low flag and supports search', async () => {
    const ctx = await seedInventoryClient();
    const prods = await seedProducts(ctx.clientId, [
      { name: 'Alpha Shampoo' },
      { name: 'Beta Wax' },
    ]);
    const pA = prods[0]!;
    const pB = prods[1]!;
    await seedStock(ctx, pA, 2, 5); // low: 2 <= 5
    await seedStock(ctx, pB, 40, 5); // ok

    const res = await listHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/list'));
    expect(res.status).toBe(200);
    const items = (await res.json()).items as ListItem[];
    const byId = Object.fromEntries(items.map((i) => [i.product_id, i]));
    expect(byId[pA]!.low).toBe(true);
    expect(byId[pA]!.qty_on_hand).toBe(2);
    expect(byId[pB]!.low).toBe(false);

    const res2 = await listHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/list?q=Alpha'));
    const items2 = (await res2.json()).items as ListItem[];
    expect(items2.length).toBe(1);
    expect(items2[0]!.product_id).toBe(pA);
  });

  it('returns an empty list (not an error) when no stock rows exist', async () => {
    const ctx = await seedInventoryClient();
    const res = await listHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/list'));
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });
});
