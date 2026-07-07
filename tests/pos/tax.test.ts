import { describe, it, expect, vi } from 'vitest';

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
import taxHandler from '../../netlify/functions/pos-tax';
import configHandler from '../../netlify/functions/pub-storefront-config';
import saleHandler from '../../netlify/functions/pub-sale-create';
import { seedClientWithProductsEnabled, seedProducts, makeBucketUserRequest, type PosTestCtx } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ipCounter = 80000;
function pubReq(path: string, method: string, body?: unknown): Request {
  const ip = `10.2.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
async function seedFull(): Promise<PosTestCtx & { slug: string }> {
  const ctx = await seedClientWithProductsEnabled();
  const rows = (await sql`UPDATE public.clients SET storefront_enabled = true WHERE id = ${ctx.clientId} RETURNING slug`) as Array<{ slug: string }>;
  return { ...ctx, slug: rows[0]!.slug };
}
function saleBody(slug: string, pid: string) {
  return {
    slug, channel: 'pickup', idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
    honeypot: '', customer: { name: 'Guest', phone: '9990001111' }, lines: [{ productId: pid, qty: 1 }],
  };
}

describe('storefront tax', () => {
  it('staff sets tax; storefront config reflects it; checkout adds exclusive tax', async () => {
    const ctx = await seedFull();
    const put = await taxHandler(makeBucketUserRequest(ctx, 'PUT', '/api/pos/tax', { enabled: true, rateBps: 1800, label: 'GST', inclusive: false }));
    expect(put.status).toBe(200);

    const cfg = await configHandler(pubReq(`/api/public/config/${ctx.slug}`, 'GET'));
    const cj = (await cfg.json()) as { tax: { enabled: boolean; rateBps: number; label: string } };
    expect(cj.tax).toMatchObject({ enabled: true, rateBps: 1800, label: 'GST' });

    const [pid] = await seedProducts(ctx.clientId, [{ name: 'Cut', sale_price_cents: 10000 }]);
    const sale = await saleHandler(pubReq('/api/public/sales', 'POST', saleBody(ctx.slug, pid!)));
    const sj = (await sale.json()) as { subtotalCents: number; taxCents: number; totalCents: number };
    expect(sj.subtotalCents).toBe(10000);
    expect(sj.taxCents).toBe(1800);
    expect(sj.totalCents).toBe(11800);
  });

  it('inclusive tax leaves the stored total unchanged (breakdown is display-only)', async () => {
    const ctx = await seedFull();
    await taxHandler(makeBucketUserRequest(ctx, 'PUT', '/api/pos/tax', { enabled: true, rateBps: 1800, label: 'GST', inclusive: true }));
    const [pid] = await seedProducts(ctx.clientId, [{ name: 'IncCut', sale_price_cents: 11800 }]);
    const sale = await saleHandler(pubReq('/api/public/sales', 'POST', saleBody(ctx.slug, pid!)));
    const sj = (await sale.json()) as { subtotalCents: number; taxCents: number; totalCents: number };
    expect(sj.subtotalCents).toBe(11800);
    // Additive tax_cents is 0 (schema: total = subtotal − discount + tax); the
    // extracted GST portion is shown only on the storefront, not stored.
    expect(sj.taxCents).toBe(0);
    expect(sj.totalCents).toBe(11800);
  });

  it('no tax when disabled', async () => {
    const ctx = await seedFull();
    const [pid] = await seedProducts(ctx.clientId, [{ name: 'Free', sale_price_cents: 5000 }]);
    const sale = await saleHandler(pubReq('/api/public/sales', 'POST', saleBody(ctx.slug, pid!)));
    const sj = (await sale.json()) as { taxCents: number; totalCents: number };
    expect(sj.taxCents).toBe(0);
    expect(sj.totalCents).toBe(5000);
  });
});
