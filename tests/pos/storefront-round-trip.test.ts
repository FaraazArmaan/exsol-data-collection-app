// End-to-end storefront round-trip (spec §8.3), through the real handlers
// against the dev DB: public menu → public create → public receipt → staff
// marks paid (v1 FSM) → public receipt reflects the new status. This is the
// integration smoke for the whole v2 stack (everything but browser rendering,
// which is visually verified separately).

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
import pubMenu from '../../netlify/functions/pub-menu';
import pubCreate from '../../netlify/functions/pub-sale-create';
import pubDetail from '../../netlify/functions/pub-sale-detail';
import staffState from '../../netlify/functions/pos-sale-state';
import { seedClientWithProductsEnabled, seedProducts, grantPerms, makeBucketUserRequest } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ip = 7000;
function pubGet(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: { 'x-nf-client-connection-ip': `10.9.${(ip >> 8) & 255}.${ip++ & 255}` } });
}
function pubPost(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': `10.9.${(ip >> 8) & 255}.${ip++ & 255}` },
    body: JSON.stringify(body),
  });
}

describe('storefront round-trip', () => {
  it('guest browses → orders → staff marks paid → receipt reflects it', async () => {
    // A client that is storefront-enabled AND has an L1 staff Owner.
    const ctx = await seedClientWithProductsEnabled();
    const slugRows = (await sql`UPDATE public.clients SET storefront_enabled = true WHERE id = ${ctx.clientId} RETURNING slug`) as Array<{ slug: string }>;
    const slug = slugRows[0]!.slug;
    await grantPerms(ctx.clientId, 1, ['pos.history.view', 'pos.history.viewAll', 'pos.sale.markPaid']);
    const [pid] = await seedProducts(ctx.clientId, [{ name: 'Round Trip Latte', sale_price_cents: 30000, status: 'active' }]);

    // 1. Guest sees the menu.
    const menuRes = await pubMenu(pubGet(`/api/public/menu/${slug}`));
    expect(menuRes.status).toBe(200);
    const menu = await menuRes.json() as { products: Array<{ id: string; name: string }> };
    expect(menu.products.map((p) => p.name)).toContain('Round Trip Latte');

    // 2. Guest places a pickup order.
    const createRes = await pubCreate(pubPost('/api/public/sales', {
      slug, channel: 'pickup', idempotencyKey: `rt-${Math.random().toString(36).slice(2, 12)}`,
      honeypot: '', customer: { name: 'Guest RT', phone: '9001230000' }, lines: [{ productId: pid, qty: 2 }],
    }));
    expect(createRes.status).toBe(201);
    const sale = await createRes.json() as { id: string; status: string; totalCents: number };
    expect(sale.status).toBe('pending_payment');
    expect(sale.totalCents).toBe(60000);

    // 3. Guest receipt — still pending.
    const r1 = await pubDetail(pubGet(`/api/public/sales/${sale.id}`));
    expect(r1.status).toBe(200);
    expect((await r1.json() as { status: string }).status).toBe('pending_payment');

    // 4. Staff marks it paid via the v1 FSM (pickup → no auto-fulfill, stays 'paid').
    const stateRes = await staffState(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sale.id}/state`, {
      action: 'markPaid', paymentMethod: 'cash',
    }));
    expect(stateRes.status).toBe(200);

    // 5. Guest receipt reflects the new status on the next poll.
    const r2 = await pubDetail(pubGet(`/api/public/sales/${sale.id}`));
    expect((await r2.json() as { status: string; timeline: { paidAt: string | null } }).status).toBe('paid');
  });
});
