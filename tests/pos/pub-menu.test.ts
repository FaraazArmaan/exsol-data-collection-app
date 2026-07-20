import { describe, it, expect, vi, beforeEach } from 'vitest';

// Netlify Blobs is unavailable in tests; back getStore with an in-memory Map so
// the rate limiter counts for real (per [Blob mock propagation], every test
// file exercising a storefront handler must mock getStore).
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
import handler from '../../netlify/functions/pub-menu';
import { seedStorefrontClient, seedProducts } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ipCounter = 0;
function pubReq(slug: string, ip?: string): Request {
  // Distinct IP per call by default so the rate limiter doesn't bleed between tests.
  const clientIp = ip ?? `10.0.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  return new Request(`http://localhost/api/public/menu/${slug}`, {
    headers: { 'x-nf-client-connection-ip': clientIp },
  });
}

describe('GET /api/public/menu/:slug', () => {
  it('returns tenant name + storefront_visible active products, hides others', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [visibleId, hiddenId, draftId] = await seedProducts(clientId, [
      { name: 'Latte', sale_price_cents: 25000, status: 'active' },
      { name: 'SecretSauce', sale_price_cents: 5000, status: 'active' },
      { name: 'Draft Item', sale_price_cents: 9000, status: 'draft' },
    ]);
    await sql`UPDATE public.products SET storefront_visible = false WHERE id = ${hiddenId}`;
    void visibleId; void draftId;

    const res = await handler(pubReq(slug));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenant: { name: string };
      products: Array<{ name: string }>;
    };
    expect(body.tenant.name).toBe('Storefront Test');
    expect(body.products.map((p) => p.name)).toEqual(['Latte']);
    // internal client id must NOT leak
    expect(JSON.stringify(body)).not.toContain(clientId);
  });

  it('returns only storefront-sellable variants', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [productId] = await seedProducts(clientId, [{ name: 'Variant mug', price_cents: 1200, status: 'active' }]);
    await sql`
      INSERT INTO public.product_variants (client_id, product_id, title, option_values, price_cents, status, availability, storefront_visible)
      VALUES
        (${clientId}::uuid, ${productId}::uuid, 'Large', '{"size":"L"}'::jsonb, 1600, 'active', 'in_stock', true),
        (${clientId}::uuid, ${productId}::uuid, 'Preorder', '{"size":"XL"}'::jsonb, 1700, 'active', 'preorder', true),
        (${clientId}::uuid, ${productId}::uuid, 'Sold out', '{"size":"S"}'::jsonb, 1100, 'active', 'out_of_stock', true)
    `;
    const res = await handler(pubReq(slug));
    expect(res.status).toBe(200);
    const body = await res.json() as { products: Array<{ id: string; variants?: Array<{ title: string; salePriceCents: number }> }> };
    const variants = body.products.find((product) => product.id === productId)?.variants;
    expect(variants).toHaveLength(2);
    expect(variants).toMatchObject([
      { title: 'Large', salePriceCents: 1600 },
      { title: 'Preorder', salePriceCents: 1700 },
    ]);
  });

  it('sets a short public Cache-Control', async () => {
    const { slug } = await seedStorefrontClient();
    const res = await handler(pubReq(slug));
    expect(res.headers.get('Cache-Control')).toContain('max-age=30');
  });

  it('uses price_cents when the configured sale window has ended', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [productId] = await seedProducts(clientId, [
      { name: 'Past sale', price_cents: 20000, sale_price_cents: 15000, status: 'active' },
    ]);
    await sql`
      UPDATE public.products
      SET sale_starts_at = '2000-01-01T00:00:00.000Z'::timestamptz,
          sale_ends_at = '2000-01-31T23:59:59.000Z'::timestamptz
      WHERE id = ${productId}
    `;

    const res = await handler(pubReq(slug));
    const body = (await res.json()) as { products: Array<{ id: string; salePriceCents: number }> };
    expect(body.products.find((product) => product.id === productId)?.salePriceCents).toBe(20000);
  });

  it('404 storefront_unavailable for an unknown slug', async () => {
    const res = await handler(pubReq('no-such-shop'));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('storefront_unavailable');
  });

  it('404 when storefront is disabled', async () => {
    const { slug } = await seedStorefrontClient({ storefrontEnabled: false });
    const res = await handler(pubReq(slug));
    expect(res.status).toBe(404);
  });

  it('404 when the required products are not enabled', async () => {
    // Enable neither, so resolveStorefront's products+pos guard 404s. We avoid
    // a products-without-pos row entirely: that would transiently violate
    // migration 042's global invariant and flake its parallel test file.
    const { slug } = await seedStorefrontClient({ enableProducts: false, enablePos: false });
    const res = await handler(pubReq(slug));
    expect(res.status).toBe(404);
  });

  // 61 sequential handler calls = 61+ DB round-trips; the default 20s timeout
  // needs <330ms/query and flakes whenever the shared Neon dev branch is slow
  // (recurred 3x on 2026-07-08). Latency-tolerant timeout; assertion unchanged.
  it('429 when the per-IP limit is exceeded (limiter wired into the handler)', { timeout: 120_000 }, async () => {
    const { slug } = await seedStorefrontClient();
    // Freeze time so all calls share one minute bucket regardless of DB latency.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_750_000_000_000);
    try {
      const ip = '203.0.113.7';
      let last = 200;
      for (let i = 0; i < 61; i++) last = (await handler(pubReq(slug, ip))).status;
      expect(last).toBe(429);
    } finally {
      now.mockRestore();
    }
  });
});
