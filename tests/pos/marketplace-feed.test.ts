import { describe, it, expect } from 'vitest';
import feedHandler from '../../netlify/functions/pos-marketplace-feed';
import { seedClientWithProductsEnabled, seedProducts, makeBucketUserRequest } from './_helpers';

// requirePos-gated (no public rate-limit / blobs) → no @netlify/blobs mock needed.

describe('marketplace feed export', () => {
  it('exports an Amazon feed of storefront-visible products', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await seedProducts(ctx.clientId, [{ name: 'Pomade Deluxe', sale_price_cents: 45000 }]);

    const res = await feedHandler(makeBucketUserRequest(ctx, 'GET', '/api/pos/marketplace-feed?platform=amazon'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/tab-separated-values');
    expect(res.headers.get('Content-Disposition')).toContain('amazon');
    const body = await res.text();
    expect(body.split('\n')[0]).toContain('sku'); // header row
    expect(body).toContain('Pomade Deluxe');
  });

  it('rejects an unsupported marketplace (400)', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const res = await feedHandler(makeBucketUserRequest(ctx, 'GET', '/api/pos/marketplace-feed?platform=ebay'));
    expect(res.status).toBe(400);
  });

  it('404s when there are no storefront-visible products', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await seedProducts(ctx.clientId, [{ name: 'Hidden', sale_price_cents: 1000, pos_visible: true }]);
    // Hide it from the storefront.
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL!);
    await sql`UPDATE public.products SET storefront_visible = false WHERE client_id = ${ctx.clientId}`;
    const res = await feedHandler(makeBucketUserRequest(ctx, 'GET', '/api/pos/marketplace-feed?platform=meta'));
    expect(res.status).toBe(404);
  });
});
