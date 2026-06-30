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
import detail from '../../netlify/functions/pub-sale-detail';
import create from '../../netlify/functions/pub-sale-create';
import { seedStorefrontClient, seedProducts, seedClientWithProductsEnabled } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ipCounter = 5000;
function ip() { return `10.2.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`; }
function getReq(id: string): Request {
  return new Request(`http://localhost/api/public/sales/${id}`, {
    headers: { 'x-nf-client-connection-ip': ip() },
  });
}

async function makeStorefrontSale(): Promise<{ id: string; clientId: string; slug: string }> {
  const { clientId, slug } = await seedStorefrontClient();
  const [pid] = await seedProducts(clientId, [{ name: 'Receipt Item', sale_price_cents: 12000, status: 'active' }]);
  const res = await create(new Request('http://localhost/api/public/sales', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip() },
    body: JSON.stringify({
      slug, channel: 'pickup', idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
      honeypot: '', customer: { name: 'Guest', phone: '9001234567' }, lines: [{ productId: pid, qty: 1 }],
    }),
  }));
  const id = (await res.json() as { id: string }).id;
  return { id, clientId, slug };
}

describe('GET /api/public/sales/:saleUuid', () => {
  it('returns the whitelisted receipt (lines + timeline), no internal columns', async () => {
    const { id, clientId } = await makeStorefrontSale();
    const res = await detail(getReq(id));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(id);
    expect(typeof body.orderNo).toBe('number');
    expect(body.lines[0].productNameSnap).toBe('Receipt Item');
    expect(body.timeline.placedAt).toBeTruthy();
    const keys = JSON.stringify(body);
    expect(keys).not.toContain('bucket_id');
    expect(keys).not.toContain('created_by_user_node');
    expect(keys).not.toContain('payment_ref');
    expect(keys).not.toContain(clientId);
  });

  it('404 for a v1 in-store (source=pos) sale UUID — leak guard', async () => {
    const { clientId, userNodeId } = await seedClientWithProductsEnabled();
    const rows = (await sql`
      INSERT INTO public.sales (bucket_id, order_no, status, channel, source,
        customer_name, customer_phone, subtotal_cents, total_cents, created_by_user_node)
      VALUES (${clientId}, 1, 'pending_payment', 'instore', 'pos',
        'In Store', '1112223334', 100, 100, ${userNodeId})
      RETURNING id
    `) as Array<{ id: string }>;
    const res = await detail(getReq(rows[0]!.id));
    expect(res.status).toBe(404);
  });

  it('404 for a malformed uuid', async () => {
    const res = await detail(getReq('not-a-uuid'));
    expect(res.status).toBe(404);
  });

  it('still 200 after the tenant disables the storefront (bearer-token kindness)', async () => {
    const { id, clientId } = await makeStorefrontSale();
    await sql`UPDATE public.clients SET storefront_enabled = false WHERE id = ${clientId}`;
    const res = await detail(getReq(id));
    expect(res.status).toBe(200);
  });
});
