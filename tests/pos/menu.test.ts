import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/pos-menu';
import {
  seedClientWithProductsEnabled,
  seedProducts,
  disableProductsForClient,
  grantPerms,
  makeBucketUserRequest,
} from './_helpers';

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

  it('returns 412 when products module not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await disableProductsForClient(ctx.clientId);
    await grantPerms(ctx.clientId, 1, ['pos.menu.view']);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
    expect(res.status).toBe(412);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('products_module_required');
  });

  it('returns 403 without pos.menu.view permission', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []); // explicit empty perms — no L1 bypass.

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
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
});
