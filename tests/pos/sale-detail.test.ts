import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/pos/sale-detail';
import createHandler from '../../netlify/functions/pos/sale-create';
import {
  seedClientWithProductsEnabled,
  seedProducts,
  grantPerms,
  makeBucketUserRequest,
  seedSecondUserInClient,
} from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;
let saleId: string;

beforeAll(async () => {
  ctx = await seedClientWithProductsEnabled();
  const [pid] = await seedProducts(ctx.clientId, [
    { name: 'X', sale_price_cents: 100, pos_visible: true, status: 'active' },
  ]);
  await grantPerms(ctx.clientId, 1, [
    'pos.sale.create',
    'pos.history.view',
    'pos.history.viewAll',
  ]);
  const r = await createHandler(
    makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'instore',
      idempotencyKey: crypto.randomUUID(),
      customer: { name: 'A', phone: '1' },
      lines: [{ productId: pid, qty: 2 }],
    }),
  );
  if (r.status !== 201) {
    const txt = await r.text();
    throw new Error(`seed sale failed: ${r.status} ${txt}`);
  }
  saleId = (await r.json()).id;
});

describe('GET /api/pos/sales/:id', () => {
  it('returns sale + lines + audit (with viewAll)', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/pos/sales/${saleId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(saleId);
    expect(body.lines.length).toBeGreaterThan(0);
    expect(Number(body.lines[0].qty)).toBe(2);
    expect(Array.isArray(body.audit)).toBe(true);
    expect(body.audit.length).toBeGreaterThan(0);
    expect(body.audit[0].op).toBe('pos.sale.created');
  });

  it('returns 404 for cross-client sale (leak prevention)', async () => {
    const other = await seedClientWithProductsEnabled();
    await grantPerms(other.clientId, 1, ['pos.history.view', 'pos.history.viewAll']);
    const res = await handler(makeBucketUserRequest(other, 'GET', `/api/pos/sales/${saleId}`));
    expect(res.status).toBe(404);
  });

  it('returns 404 for other user without viewAll (leak prevention)', async () => {
    // Second user in SAME client, granted pos.history.view but NOT viewAll.
    // They never created our sale (ctx.userNodeId did), so they must get 404,
    // not 403 — hiding even the existence of the sale.
    const other = await seedSecondUserInClient(ctx);
    // grantPerms targets level_number, which both users share, so this scopes
    // the L1 permission set to view-without-viewAll.
    await grantPerms(ctx.clientId, 1, ['pos.history.view']);
    const res = await handler(makeBucketUserRequest(other, 'GET', `/api/pos/sales/${saleId}`));
    expect(res.status).toBe(404);
    // Restore so the rest of the suite (and later tests) still works.
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.history.view',
      'pos.history.viewAll',
    ]);
  });

  it('returns lines in position order', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/pos/sales/${saleId}`));
    const body = await res.json();
    const positions = body.lines.map((l: any) => l.position);
    expect(positions).toEqual([...positions].sort((a: number, b: number) => a - b));
  });

  it('returns 403 without pos.history.view', async () => {
    await grantPerms(ctx.clientId, 1, []);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/pos/sales/${saleId}`));
    expect(res.status).toBe(403);
    await grantPerms(ctx.clientId, 1, [
      'pos.sale.create',
      'pos.history.view',
      'pos.history.viewAll',
    ]);
  });

  it('returns 404 for unknown sale id', async () => {
    const fake = '00000000-0000-0000-0000-000000000000';
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/pos/sales/${fake}`));
    expect(res.status).toBe(404);
  });

  it('returns 404 for malformed sale id (avoids SQL UUID parse error)', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales/not-a-uuid'));
    expect(res.status).toBe(404);
  });
});
