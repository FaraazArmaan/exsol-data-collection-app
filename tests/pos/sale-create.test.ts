import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/pos-sale-create';
import {
  seedClientWithProductsEnabled,
  seedProducts,
  grantPerms,
  makeBucketUserRequest,
  seedSubordinateUser,
} from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;
let capId: string;
let pastaId: string;

beforeAll(async () => {
  ctx = await seedClientWithProductsEnabled();
  const ids = await seedProducts(ctx.clientId, [
    { name: 'Cappuccino', sale_price_cents: 22000, pos_visible: true, status: 'active' },
    { name: 'Pasta', sale_price_cents: 52000, pos_visible: true, status: 'active' },
  ]);
  [capId, pastaId] = ids as [string, string];
  await grantPerms(ctx.clientId, 1, ['pos.sale.create']);
});

function validBody() {
  return {
    channel: 'instore' as const,
    idempotencyKey: crypto.randomUUID(),
    customer: { name: 'Riya', phone: '9876543210' },
    lines: [
      { productId: capId, qty: 2 },
      { productId: pastaId, qty: 1 },
    ],
  };
}

describe('POST /api/pos/sales', () => {
  it('creates pending_payment sale with server-snapshot prices', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', validBody()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending_payment');
    expect(Number(body.subtotal_cents)).toBe(2 * 22000 + 52000);
    expect(Number(body.order_no)).toBeGreaterThanOrEqual(1);
    expect(body.lines).toHaveLength(2);
    expect(Number(body.lines[0].unit_price_cents)).toBe(22000);
  });

  it('rejects empty lines with 400', async () => {
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', { ...validBody(), lines: [] }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects unknown product with 400', async () => {
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
        ...validBody(),
        lines: [{ productId: '00000000-0000-0000-0000-000000000000', qty: 1 }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for cross-bucket product (leak prevention)', async () => {
    const other = await seedClientWithProductsEnabled();
    const [otherProduct] = await seedProducts(other.clientId, [
      { name: 'Other', sale_price_cents: 100, pos_visible: true, status: 'active' },
    ]);
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
        ...validBody(),
        lines: [{ productId: otherProduct, qty: 1 }],
      }),
    );
    expect(res.status).toBe(404);
  });

  it('rejects pos_visible=false product with 400', async () => {
    const [hidden] = await seedProducts(ctx.clientId, [
      { name: 'Hidden', sale_price_cents: 100, pos_visible: false, status: 'active' },
    ]);
    const res = await handler(
      makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
        ...validBody(),
        lines: [{ productId: hidden, qty: 1 }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('idempotent: same key returns same sale', async () => {
    const body = validBody();
    const r1 = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', body));
    const r2 = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', body));
    const a = await r1.json();
    const b = await r2.json();
    expect(a.id).toBe(b.id);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
  });

  it('falls back to price_cents when sale_price_cents NULL', async () => {
    const [bare] = await seedProducts(ctx.clientId, [
      { name: 'Bare', price_cents: 17500, pos_visible: true, status: 'active' },
    ]);
    const body = { ...validBody(), lines: [{ productId: bare, qty: 1 }] };
    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', body));
    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(Number(sale.lines[0].unit_price_cents)).toBe(17500);
  });

  it('allocates order_no monotonically per client (5 parallel)', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', validBody())),
      ),
    );
    const bodies = await Promise.all(results.map((r) => r.json()));
    const nos = bodies.map((b: any) => Number(b.order_no));
    expect(new Set(nos).size).toBe(nos.length); // all distinct
  });

  it('returns 403 without pos.sale.create (non-Owner)', async () => {
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await handler(
      makeBucketUserRequest(sub, 'POST', '/api/pos/sales', validBody()),
    );
    expect(res.status).toBe(403);
  });
});
