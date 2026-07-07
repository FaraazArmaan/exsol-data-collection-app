import { describe, it, expect, vi } from 'vitest';

// Public coupon endpoints hit checkLimit → Netlify Blobs; mock the store.
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
import posCoupons from '../../netlify/functions/pos-coupons';
import validateHandler from '../../netlify/functions/pub-coupon-validate';
import saleHandler from '../../netlify/functions/pub-sale-create';
import {
  seedStorefrontClient, seedClientWithProductsEnabled, seedProducts, makeBucketUserRequest,
} from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ipCounter = 40000;
function publicReq(path: string, body: unknown): Request {
  const ip = `10.9.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip },
    body: JSON.stringify(body),
  });
}

function rndCode() { return 'SAVE' + Math.random().toString(36).slice(2, 8).toUpperCase(); }

async function insertCoupon(clientId: string, over: Record<string, unknown> = {}): Promise<{ id: string; code: string }> {
  const c = {
    code: rndCode(), discount_type: 'percent', discount_value: 10, min_order_cents: 0,
    max_redemptions: null as number | null, per_customer_limit: null as number | null, active: true, ...over,
  };
  const rows = (await sql`
    INSERT INTO public.coupons
      (client_id, code, discount_type, discount_value, min_order_cents, max_redemptions, per_customer_limit, active)
    VALUES (${clientId}, ${c.code}, ${c.discount_type}, ${c.discount_value}, ${c.min_order_cents},
            ${c.max_redemptions}, ${c.per_customer_limit}, ${c.active})
    RETURNING id, code
  `) as Array<{ id: string; code: string }>;
  return rows[0]!;
}

function saleBody(slug: string, productId: string, over: Record<string, unknown> = {}) {
  return {
    slug, channel: 'pickup', idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
    honeypot: '', customer: { name: 'Guest', phone: '9990001111' },
    lines: [{ productId, qty: 2 }], ...over,
  };
}

describe('coupons — staff management', () => {
  it('L1 owner creates and lists a coupon', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const code = rndCode();
    const create = await posCoupons(makeBucketUserRequest(ctx, 'POST', '/api/pos/coupons', {
      code, discountType: 'percent', discountValue: 15, maxRedemptions: 100,
    }));
    expect(create.status).toBe(201);

    const list = await posCoupons(makeBucketUserRequest(ctx, 'GET', '/api/pos/coupons'));
    const out = (await list.json()) as { coupons: Array<{ code: string; discountValue: number }> };
    expect(out.coupons.some((c) => c.code === code && c.discountValue === 15)).toBe(true);
  });

  it('rejects a duplicate code (case-insensitive) with 409', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const code = rndCode();
    await posCoupons(makeBucketUserRequest(ctx, 'POST', '/api/pos/coupons', { code, discountType: 'fixed', discountValue: 500 }));
    const dup = await posCoupons(makeBucketUserRequest(ctx, 'POST', '/api/pos/coupons', { code: code.toLowerCase(), discountType: 'fixed', discountValue: 500 }));
    expect(dup.status).toBe(409);
  });
});

describe('coupons — storefront validate + apply', () => {
  it('previews a percentage discount', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const { code } = await insertCoupon(clientId, { discount_type: 'percent', discount_value: 10 });
    const res = await validateHandler(publicReq('/api/public/coupon-validate', { slug, code, subtotalCents: 60000 }));
    const out = (await res.json()) as { valid: boolean; discountCents: number };
    expect(out.valid).toBe(true);
    expect(out.discountCents).toBe(6000);
  });

  it('applies a coupon at checkout: discount_cents set, total reduced, redemption recorded', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [pid] = await seedProducts(clientId, [{ name: 'Latte', sale_price_cents: 30000, status: 'active' }]);
    const { id: couponId, code } = await insertCoupon(clientId, { discount_type: 'fixed', discount_value: 5000 });

    const res = await saleHandler(publicReq('/api/public/sales', saleBody(slug, pid!, { couponCode: code })));
    expect(res.status).toBe(201);
    const out = (await res.json()) as { id: string; totalCents: number; subtotalCents: number };
    expect(out.subtotalCents).toBe(60000);
    expect(out.totalCents).toBe(55000); // 60000 − 5000

    const sale = (await sql`SELECT discount_cents FROM public.sales WHERE id = ${out.id}`) as Array<{ discount_cents: number }>;
    expect(Number(sale[0]!.discount_cents)).toBe(5000);
    const red = (await sql`SELECT discount_cents FROM public.coupon_redemptions WHERE coupon_id = ${couponId}`) as Array<{ discount_cents: number }>;
    expect(red).toHaveLength(1);
    const c = (await sql`SELECT redeemed_count FROM public.coupons WHERE id = ${couponId}`) as Array<{ redeemed_count: number }>;
    expect(Number(c[0]!.redeemed_count)).toBe(1);
  });

  it('rejects an exhausted coupon (422) and does not create the sale', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [pid] = await seedProducts(clientId, [{ name: 'Cap', sale_price_cents: 10000, status: 'active' }]);
    const { code } = await insertCoupon(clientId, { max_redemptions: 1, discount_type: 'percent', discount_value: 10 });

    const first = await saleHandler(publicReq('/api/public/sales', saleBody(slug, pid!, { couponCode: code })));
    expect(first.status).toBe(201);
    const second = await saleHandler(publicReq('/api/public/sales', saleBody(slug, pid!, { couponCode: code })));
    expect(second.status).toBe(422);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('coupon_exhausted');
  });

  it('rejects an inactive coupon (422)', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [pid] = await seedProducts(clientId, [{ name: 'Off', sale_price_cents: 10000, status: 'active' }]);
    const { code } = await insertCoupon(clientId, { active: false });
    const res = await saleHandler(publicReq('/api/public/sales', saleBody(slug, pid!, { couponCode: code })));
    expect(res.status).toBe(422);
  });
});
