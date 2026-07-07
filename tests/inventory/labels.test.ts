import { describe, it, expect } from 'vitest';
import labelsHandler from '../../netlify/functions/inventory-labels';
import { seedInventoryClient, seedStock } from './_helpers';
import { seedProducts, makeBucketUserRequest, seedClientWithProductsEnabled } from '../pos/_helpers';

type Ctx = Awaited<ReturnType<typeof seedInventoryClient>>;
const get = (ctx: Ctx, path: string) => labelsHandler(makeBucketUserRequest(ctx, 'GET', path));

async function pdfMagic(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return String.fromCharCode(buf[0]!, buf[1]!, buf[2]!, buf[3]!);
}

describe('GET /api/inventory/labels', () => {
  it('412 when inventory is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    expect((await get(ctx, '/api/inventory/labels?kind=product')).status).toBe(412);
  });

  it('returns a product-label PDF', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'Widget' }]))[0]!;
    await seedStock(ctx, p, 10, 5);
    const res = await get(ctx, '/api/inventory/labels?kind=product');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(await pdfMagic(res)).toBe('%PDF');
  });

  it('produces a valid PDF even with no products (empty state)', async () => {
    const ctx = await seedInventoryClient();
    const res = await get(ctx, '/api/inventory/labels?kind=product');
    expect(res.status).toBe(200);
    expect(await pdfMagic(res)).toBe('%PDF');
  });

  it('400 for shelf labels without a location_id', async () => {
    const ctx = await seedInventoryClient();
    expect((await get(ctx, '/api/inventory/labels?kind=shelf')).status).toBe(400);
  });

  it('404 for shelf labels with an unknown location', async () => {
    const ctx = await seedInventoryClient();
    const res = await get(ctx, '/api/inventory/labels?kind=shelf&location_id=00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});
