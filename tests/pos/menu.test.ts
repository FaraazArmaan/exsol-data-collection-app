import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import handler from '../../netlify/functions/pos-menu';
import {
  seedClientWithProductsEnabled,
  seedProducts,
  disableProductsForClient,
  grantPerms,
  makeBucketUserRequest,
  seedSubordinateUser,
} from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

describe('GET /api/pos/menu', () => {
  it('returns products filtered by pos_visible=true and status=active', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await seedProducts(ctx.clientId, [
      { name: 'Cappuccino', sale_price_cents: 22000, pos_visible: true, status: 'active' },
      { name: 'Backstage', sale_price_cents: 5000, pos_visible: false, status: 'active' },
      { name: 'Draft Item', sale_price_cents: 9000, pos_visible: true, status: 'draft' },
    ]);
    await grantPerms(ctx.clientId, 1, ['pos.menu.view']);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<{ name: string; salePriceCents: number }> };
    expect(body.products.map((p) => p.name)).toEqual(['Cappuccino']);
    expect(body.products[0]!.salePriceCents).toBe(22000);
  });

  it('returns only POS-sellable variants with their effective prices', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const [productId] = await seedProducts(ctx.clientId, [{ name: 'Variant tee', price_cents: 2000 }]);
    await sql`
      INSERT INTO public.product_variants (client_id, product_id, title, option_values, price_cents, status, availability, pos_visible)
      VALUES
        (${ctx.clientId}::uuid, ${productId}::uuid, 'Small', '{"size":"S"}'::jsonb, 2000, 'active', 'in_stock', true),
        (${ctx.clientId}::uuid, ${productId}::uuid, 'Large preorder', '{"size":"L"}'::jsonb, 2500, 'active', 'preorder', true),
        (${ctx.clientId}::uuid, ${productId}::uuid, 'Sold out', '{"size":"XL"}'::jsonb, 3000, 'active', 'out_of_stock', true),
        (${ctx.clientId}::uuid, ${productId}::uuid, 'Hidden', '{"size":"XS"}'::jsonb, 1800, 'active', 'in_stock', false)
    `;
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
    expect(res.status).toBe(200);
    const body = await res.json() as { products: Array<{ id: string; variants?: Array<{ title: string; salePriceCents: number }> }> };
    const variants = body.products.find((product) => product.id === productId)?.variants;
    expect(variants).toHaveLength(2);
    expect(variants).toMatchObject([
      { title: 'Large preorder', salePriceCents: 2500 },
      { title: 'Small', salePriceCents: 2000 },
    ]);
  });

  it('returns 412 when products module not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await disableProductsForClient(ctx.clientId);
    await grantPerms(ctx.clientId, 1, ['pos.menu.view']);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
    expect(res.status).toBe(412);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('products_module_required');
  });

  it('returns 403 without pos.menu.view permission (non-Owner)', async () => {
    // L1 Owners are all-on (bypass); the genuine "lacks permission" actor is a
    // subordinate level with an empty matrix.
    const ctx = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(ctx, 2, []);

    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/pos/menu'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; details?: { required: string } } };
    expect(body.error.code).toBe('missing_permission');
    expect(body.error.details?.required).toBe('pos.menu.view');
  });

  it('returns 401 without a session cookie', async () => {
    const res = await handler(
      new Request('http://localhost/api/pos/menu', { method: 'GET' }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 405 for non-GET methods', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, ['pos.menu.view']);
    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/menu'));
    expect(res.status).toBe(405);
  });

  it('falls back to price_cents when sale_price_cents is NULL', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await seedProducts(ctx.clientId, [
      { name: 'BaseOnly', price_cents: 12345, pos_visible: true, status: 'active' },
    ]);
    await grantPerms(ctx.clientId, 1, ['pos.menu.view']);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<{ salePriceCents: number }> };
    expect(body.products[0]!.salePriceCents).toBe(12345);
  });

  it('uses price_cents when the configured sale window has not started', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const [productId] = await seedProducts(ctx.clientId, [
      { name: 'Future sale', price_cents: 20000, sale_price_cents: 15000 },
    ]);
    await sql`
      UPDATE public.products
      SET sale_starts_at = '2099-01-01T00:00:00.000Z'::timestamptz,
          sale_ends_at = '2099-01-31T23:59:59.000Z'::timestamptz
      WHERE id = ${productId}
    `;

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
    const body = (await res.json()) as { products: Array<{ id: string; salePriceCents: number }> };
    expect(body.products.find((product) => product.id === productId)?.salePriceCents).toBe(20000);
  });
});
