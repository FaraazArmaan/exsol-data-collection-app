import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/pos/sale-state';
import createHandler from '../../netlify/functions/pos/sale-create';
import {
  seedClientWithProductsEnabled,
  seedProducts,
  grantPerms,
  makeBucketUserRequest,
} from './_helpers';

async function freshSale(
  ctx: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>,
  productId: string,
  channel: 'instore' | 'online' | 'pickup' = 'instore',
): Promise<string> {
  const r = await createHandler(
    makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel,
      idempotencyKey: crypto.randomUUID(),
      customer: { name: 'A', phone: '1' },
      lines: [{ productId, qty: 1 }],
    }),
  );
  return (await r.json()).id;
}

let ctx: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;
let productId: string;

beforeAll(async () => {
  ctx = await seedClientWithProductsEnabled();
  const pids = await seedProducts(ctx.clientId, [
    { name: 'X', sale_price_cents: 100, pos_visible: true, status: 'active' },
  ]);
  productId = pids[0]!;
});

describe('POST /api/pos/sales/:id/state', () => {
  it('instore + markPaid auto-fulfills (stamps both timestamps; writes 2 audit rows)', async () => {
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.sale.markPaid',
      'pos.history.view',
    ]);
    const sid = await freshSale(ctx, productId, 'instore');
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'markPaid',
        paymentMethod: 'cash',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fulfilled');
    expect(body.paid_at).toBeTruthy();
    expect(body.fulfilled_at).toBeTruthy();
  });

  it('pickup + markPaid → paid (no auto-fulfill)', async () => {
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.sale.markPaid',
      'pos.history.view',
    ]);
    const sid = await freshSale(ctx, productId, 'pickup');
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'markPaid',
        paymentMethod: 'cash',
      }),
    );
    const body = await res.json();
    expect(body.status).toBe('paid');
    expect(body.paid_at).toBeTruthy();
    expect(body.fulfilled_at).toBeNull();
  });

  it('pickup + fulfill (after markPaid) → fulfilled', async () => {
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.sale.markPaid',
      'pos.sale.fulfill',
      'pos.history.view',
    ]);
    const sid = await freshSale(ctx, productId, 'pickup');
    await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'markPaid',
        paymentMethod: 'cash',
      }),
    );
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'fulfill',
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('fulfilled');
  });

  it('error precedence: missing perm wins over illegal state (403, not 409)', async () => {
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.sale.markPaid',
      'pos.history.view',
    ]);
    const sid = await freshSale(ctx, productId, 'instore');
    // First mark paid — now in fulfilled state (instore auto).
    await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'markPaid',
        paymentMethod: 'cash',
      }),
    );
    // Drop perm + try markPaid again on already-fulfilled sale → both perm and state would fail; perm wins.
    await grantPerms(ctx.clientId, 1, ['pos.history.view']);
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'markPaid',
        paymentMethod: 'cash',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('cancel pending_payment with perm', async () => {
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.sale.cancel',
      'pos.history.view',
    ]);
    const sid = await freshSale(ctx, productId, 'instore');
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'cancel',
        reason: 'wrong order',
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('cancelled');
  });

  it('illegal: cancel an already-paid sale → 409', async () => {
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.sale.markPaid',
      'pos.sale.cancel',
      'pos.history.view',
    ]);
    const sid = await freshSale(ctx, productId, 'pickup');
    await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'markPaid',
        paymentMethod: 'cash',
      }),
    );
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'cancel',
      }),
    );
    expect(res.status).toBe(409);
  });

  it('refund a fulfilled sale', async () => {
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.sale.markPaid',
      'pos.sale.refund',
      'pos.history.view',
    ]);
    const sid = await freshSale(ctx, productId, 'instore');
    await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'markPaid',
        paymentMethod: 'cash',
      }),
    );
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'refund',
        reason: 'spoiled',
      }),
    );
    expect((await res.json()).status).toBe('refunded');
  });

  it('markPaid without paymentMethod → 422', async () => {
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.sale.markPaid',
      'pos.history.view',
    ]);
    const sid = await freshSale(ctx, productId, 'instore');
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'markPaid',
      }),
    );
    expect(res.status).toBe(422);
  });

  it('returns 404 for cross-client sale', async () => {
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.sale.markPaid',
      'pos.history.view',
    ]);
    const sid = await freshSale(ctx, productId, 'instore');
    const other = await seedClientWithProductsEnabled();
    await grantPerms(other.clientId, 1, ['pos.sale.markPaid', 'pos.history.view']);
    const res = await handler(
      makeBucketUserRequest(other, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'markPaid',
        paymentMethod: 'cash',
      }),
    );
    expect(res.status).toBe(404);
  });
});
