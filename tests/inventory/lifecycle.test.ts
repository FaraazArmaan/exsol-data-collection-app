import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import lifecycleHandler from '../../netlify/functions/inventory-lifecycle';
import listHandler from '../../netlify/functions/inventory-list';
import { seedInventoryClient, seedStock } from './_helpers';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);
type Ctx = Awaited<ReturnType<typeof seedInventoryClient>>;
const setState = (ctx: Ctx, body: unknown) =>
  lifecycleHandler(makeBucketUserRequest(ctx, 'POST', '/api/inventory/lifecycle', body));

describe('inventory lifecycle', () => {
  it('400 for an invalid state', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await seedStock(ctx, p, 5, 2);
    expect((await setState(ctx, { product_id: p, state: 'zombie' })).status).toBe(400);
  });

  it('404 for a foreign product', async () => {
    const ctx = await seedInventoryClient();
    const other = await seedInventoryClient();
    const foreign = (await seedProducts(other.clientId, [{ name: 'F' }]))[0]!;
    expect((await setState(ctx, { product_id: foreign, state: 'seasonal' })).status).toBe(404);
  });

  it('sets state, list reflects it, and the filter narrows', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await seedStock(ctx, p, 5, 2);

    expect((await setState(ctx, { product_id: p, state: 'seasonal' })).status).toBe(200);

    const all = await (await listHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/list'))).json();
    expect(all.items[0].lifecycle_state).toBe('seasonal');

    const seasonal = await (await listHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/list?state=seasonal'))).json();
    expect(seasonal.items.length).toBe(1);
    const active = await (await listHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/list?state=active'))).json();
    expect(active.items.length).toBe(0);
  });

  it('discontinuing hides the product from the storefront', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    await seedStock(ctx, p, 5, 2);
    const res = await setState(ctx, { product_id: p, state: 'discontinued' });
    expect(res.status).toBe(200);
    expect((await res.json()).storefront_hidden).toBe(true);
    const vis = (await sql`SELECT storefront_visible FROM public.products WHERE id = ${p}`) as Array<{ storefront_visible: boolean }>;
    expect(vis[0]!.storefront_visible).toBe(false);
  });
});
