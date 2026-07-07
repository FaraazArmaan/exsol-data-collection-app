import { describe, it, expect } from 'vitest';
import productsHandler from '../../netlify/functions/warehouse-products';
import { makeBucketUserRequest, seedProducts, seedClientWithProductsEnabled } from '../pos/_helpers';
import { seedWarehouseClient, randName } from './_helpers';

const list = (ctx: Awaited<ReturnType<typeof seedWarehouseClient>>) =>
  productsHandler(makeBucketUserRequest(ctx, 'GET', '/api/warehouse/products'));

describe('GET /api/warehouse/products', () => {
  it('returns the client\'s physical products, scoped', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const [mine] = await seedProducts(ctx.clientId, [{ name: randName('Mine') }]);
    const [foreign] = await seedProducts(other.clientId, [{ name: randName('Foreign') }]);
    const products = (await (await list(ctx)).json()).products as Array<{ product_id: string }>;
    const ids = products.map((p) => p.product_id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(foreign);
  });

  it('412 when warehouse not enabled', async () => {
    const bare = await seedClientWithProductsEnabled();
    const res = await list(bare);
    expect(res.status).toBe(412);
  });
});
