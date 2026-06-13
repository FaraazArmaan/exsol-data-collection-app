import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/pos/sales-list';
import createHandler from '../../netlify/functions/pos/sale-create';
import {
  seedClientWithProductsEnabled,
  seedProducts,
  grantPerms,
  makeBucketUserRequest,
} from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;
let productId: string;

beforeAll(async () => {
  ctx = await seedClientWithProductsEnabled();
  const ids = await seedProducts(ctx.clientId, [
    { name: 'X', sale_price_cents: 100, pos_visible: true, status: 'active' },
  ]);
  productId = ids[0]!;
  await grantPerms(ctx.clientId, 1, [
    'pos.sale.create',
    'pos.history.view',
    'pos.history.viewAll',
  ]);
  for (let i = 0; i < 3; i++) {
    const res = await createHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
        channel: 'instore',
        idempotencyKey: crypto.randomUUID(),
        customer: { name: 'A', phone: '1' },
        lines: [{ productId, qty: 1 }],
      }),
    );
    if (res.status !== 201) {
      const txt = await res.text();
      throw new Error(`seed sale ${i} failed: ${res.status} ${txt}`);
    }
  }
});

describe('GET /api/pos/sales', () => {
  it('returns sales with summary block (default = today, all statuses)', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sales.length).toBeGreaterThanOrEqual(3);
    expect(body.summary).toMatchObject({
      count: expect.any(Number),
      pendingCount: expect.any(Number),
    });
  });

  it('filters by status CSV', async () => {
    const res = await handler(
      makeBucketUserRequest(ctx, 'GET', '/api/pos/sales?status=pending_payment'),
    );
    const body = await res.json();
    expect(body.sales.every((s: any) => s.status === 'pending_payment')).toBe(true);
  });

  it('search by phone digits (q=1 should match phone "1")', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales?q=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sales.length).toBeGreaterThanOrEqual(3);
  });

  it('filters by channel', async () => {
    const res = await handler(
      makeBucketUserRequest(ctx, 'GET', '/api/pos/sales?channel=pickup'),
    );
    const body = await res.json();
    expect(body.sales.length).toBe(0);
  });

  it('honors limit', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales?limit=2'));
    const body = await res.json();
    expect(body.sales.length).toBe(2);
  });

  it('summary.count reflects full filter set, not just the page', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales?limit=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sales.length).toBe(1);
    expect(body.summary.count).toBeGreaterThanOrEqual(3);
  });

  it('without viewAll, server forces cashier = current user', async () => {
    await grantPerms(ctx.clientId, 1, ['pos.history.view']);
    const fakeOtherUser = '00000000-0000-0000-0000-000000000999';
    const res = await handler(
      makeBucketUserRequest(ctx, 'GET', `/api/pos/sales?cashier=${fakeOtherUser}`),
    );
    const body = await res.json();
    expect(body.sales.every((s: any) => s.created_by_user_node === ctx.userNodeId)).toBe(
      true,
    );
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.history.view',
      'pos.history.viewAll',
    ]);
  });

  it('returns 403 without pos.history.view', async () => {
    await grantPerms(ctx.clientId, 1, []);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales'));
    expect(res.status).toBe(403);
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.history.view',
      'pos.history.viewAll',
    ]);
  });
});
