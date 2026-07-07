import { describe, it, expect, vi } from 'vitest';

vi.mock('@netlify/blobs', () => {
  const store = new Map<string, string>();
  return {
    getStore: () => ({
      get: async (k: string) => store.get(k) ?? null,
      setJSON: async (k: string, v: unknown) => { store.set(k, JSON.stringify(v)); },
    }),
  };
});

import { neon } from '@neondatabase/serverless';
import bundlesHandler from '../../netlify/functions/pos-bundles';
import bundleDetail from '../../netlify/functions/pos-bundle-detail';
import menuHandler from '../../netlify/functions/pub-menu';
import saleHandler from '../../netlify/functions/pub-sale-create';
import { seedClientWithProductsEnabled, seedProducts, makeBucketUserRequest, type PosTestCtx } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ipCounter = 60000;
function publicReq(path: string, method: string, body?: unknown): Request {
  const ip = `10.5.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function seedFull(): Promise<PosTestCtx & { slug: string }> {
  const ctx = await seedClientWithProductsEnabled();
  const rows = (await sql`UPDATE public.clients SET storefront_enabled = true WHERE id = ${ctx.clientId} RETURNING slug`) as Array<{ slug: string }>;
  return { ...ctx, slug: rows[0]!.slug };
}

describe('product bundles', () => {
  it('creates a bundle and surfaces it on the storefront menu with components', async () => {
    const ctx = await seedFull();
    const [a, b] = await seedProducts(ctx.clientId, [
      { name: 'Haircut', sale_price_cents: 30000 },
      { name: 'Beard Trim', sale_price_cents: 15000 },
    ]);

    const create = await bundlesHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/bundles', {
      name: 'Cut + Beard', priceCents: 40000, components: [{ productId: a, qty: 1 }, { productId: b, qty: 1 }],
    }));
    expect(create.status).toBe(201);
    const { id: bundleId } = (await create.json()) as { id: string };

    const menu = await menuHandler(publicReq(`/api/public/menu/${ctx.slug}`, 'GET'));
    const mj = (await menu.json()) as { products: Array<{ id: string; isBundle?: boolean; bundleInStock?: boolean; bundleComponents?: { name: string; qty: number }[] }> };
    const tile = mj.products.find((p) => p.id === bundleId);
    expect(tile?.isBundle).toBe(true);
    expect(tile?.bundleInStock).toBe(true);
    expect(tile?.bundleComponents?.map((c) => c.name).sort()).toEqual(['Beard Trim', 'Haircut']);
  });

  it('marks the bundle sold out when a component is out of stock and blocks checkout', async () => {
    const ctx = await seedFull();
    const [a, b] = await seedProducts(ctx.clientId, [
      { name: 'Facial', sale_price_cents: 50000 },
      { name: 'Head Massage', sale_price_cents: 20000 },
    ]);
    await sql`UPDATE public.products SET availability = 'out_of_stock' WHERE id = ${b}`;

    const create = await bundlesHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/bundles', {
      name: 'Spa Combo', priceCents: 60000, components: [{ productId: a, qty: 1 }, { productId: b, qty: 1 }],
    }));
    const { id: bundleId } = (await create.json()) as { id: string };

    const menu = await menuHandler(publicReq(`/api/public/menu/${ctx.slug}`, 'GET'));
    const mj = (await menu.json()) as { products: Array<{ id: string; bundleInStock?: boolean }> };
    expect(mj.products.find((p) => p.id === bundleId)?.bundleInStock).toBe(false);

    const sale = await saleHandler(publicReq('/api/public/sales', 'POST', {
      slug: ctx.slug, channel: 'pickup', idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
      honeypot: '', customer: { name: 'Guest', phone: '9990001111' }, lines: [{ productId: bundleId, qty: 1 }],
    }));
    expect(sale.status).toBe(400);
    expect(((await sale.json()) as { error: { code: string } }).error.code).toBe('bundle_out_of_stock');
  });

  it('rejects a nested bundle as a component (400)', async () => {
    const ctx = await seedFull();
    const [a, b] = await seedProducts(ctx.clientId, [
      { name: 'P1', sale_price_cents: 1000 }, { name: 'P2', sale_price_cents: 1000 },
    ]);
    const first = await bundlesHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/bundles', {
      name: 'Inner', priceCents: 1500, components: [{ productId: a, qty: 1 }],
    }));
    const { id: innerBundle } = (await first.json()) as { id: string };
    const nested = await bundlesHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/bundles', {
      name: 'Outer', priceCents: 2000, components: [{ productId: b, qty: 1 }, { productId: innerBundle, qty: 1 }],
    }));
    expect(nested.status).toBe(400);
    expect(((await nested.json()) as { error: { code: string } }).error.code).toBe('nested_bundle');
  });

  it('deletes a bundle (removed from the storefront)', async () => {
    const ctx = await seedFull();
    const [a] = await seedProducts(ctx.clientId, [{ name: 'Solo', sale_price_cents: 1000 }]);
    const create = await bundlesHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/bundles', {
      name: 'Del', priceCents: 900, components: [{ productId: a, qty: 1 }],
    }));
    const { id } = (await create.json()) as { id: string };
    const del = await bundleDetail(makeBucketUserRequest(ctx, 'DELETE', `/api/pos/bundles/${id}`));
    expect(del.status).toBe(200);
    const menu = await menuHandler(publicReq(`/api/public/menu/${ctx.slug}`, 'GET'));
    const mj = (await menu.json()) as { products: Array<{ id: string }> };
    expect(mj.products.find((p) => p.id === id)).toBeUndefined();
  });
});
