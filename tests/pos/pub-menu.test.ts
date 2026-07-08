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

  it('sets a short public Cache-Control', async () => {
    const { slug } = await seedStorefrontClient();
    const res = await handler(pubReq(slug));
    expect(res.headers.get('Cache-Control')).toContain('max-age=30');
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
