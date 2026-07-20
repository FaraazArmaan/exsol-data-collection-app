import { describe, it, expect, vi } from 'vitest';

// pub-catalog rate-limits via Netlify Blobs — mock it (hoisted above imports).
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
import catalogHandler from '../../netlify/functions/pub-catalog';
import { seedClientWithProductsEnabled, seedProducts } from '../pos/_helpers';
import { enableCatalog, slugOf, publicGet } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

interface CatProduct { id: string; name: string }

describe('pub-catalog', () => {
  it('404 when the catalog product is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled(); // no catalog
    const slug = await slugOf(ctx);
    expect((await catalogHandler(publicGet(`/api/public/catalog/${slug}`))).status).toBe(404);
  });

  it('404 for an unknown slug', async () => {
    expect((await catalogHandler(publicGet('/api/public/catalog/no-such-slug-xyz'))).status).toBe(404);
  });

  it('200 with products + contact CTA when catalog is enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableCatalog(ctx);
    await seedProducts(ctx.clientId, [{ name: 'Catalog Product', status: 'active' }]);
    await sql`UPDATE public.clients SET contact_phone = '+91 90000 00001', contact_email = 'shop@example.test' WHERE id = ${ctx.clientId}`;
    const slug = await slugOf(ctx);

    const res = await catalogHandler(publicGet(`/api/public/catalog/${slug}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant.contactPhone).toBe('+91 90000 00001');
    expect(body.tenant.contactEmail).toBe('shop@example.test');
    expect((body.products as CatProduct[]).some((p) => p.name === 'Catalog Product')).toBe(true);
  });

  it('includes an active product even when it is hidden from the storefront', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableCatalog(ctx);
    const [productId] = await seedProducts(ctx.clientId, [
      { name: 'Catalog-only visibility', status: 'active' },
    ]);
    await sql`UPDATE public.products SET storefront_visible = false WHERE id = ${productId}`;
    const slug = await slugOf(ctx);

    const res = await catalogHandler(publicGet(`/api/public/catalog/${slug}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: CatProduct[] };
    expect(body.products.some((product) => product.id === productId)).toBe(true);
  });
});
