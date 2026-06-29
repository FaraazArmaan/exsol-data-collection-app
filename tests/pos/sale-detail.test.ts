import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/pos-sale-detail';
import createHandler from '../../netlify/functions/pos-sale-create';
import {
  seedClientWithProductsEnabled,
  seedProducts,
  grantPerms,
  makeBucketUserRequest,
  seedSubordinateUser,
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
    // A non-Owner (L2) in the SAME client, granted pos.history.view but NOT
    // viewAll. They never created our sale (the L1 ctx did), so they must get
    // 404, not 403 — hiding even the existence of the sale. (An Owner would
    // see it via the L1 all-on bypass, which is why this uses a subordinate.)
    const other = await seedSubordinateUser(ctx, 2, ['pos.history.view']);
    const res = await handler(makeBucketUserRequest(other, 'GET', `/api/pos/sales/${saleId}`));
    expect(res.status).toBe(404);
  });

  it('returns lines in position order', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/pos/sales/${saleId}`));
    const body = await res.json();
    const positions = body.lines.map((l: any) => l.position);
    expect(positions).toEqual([...positions].sort((a: number, b: number) => a - b));
  });

  it('returns 403 without pos.history.view (non-Owner)', async () => {
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', `/api/pos/sales/${saleId}`));
    expect(res.status).toBe(403);
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
