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
import handler from '../../netlify/functions/pub-sale-create';
import { seedStorefrontClient, seedProducts } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ipCounter = 1000;
function postReq(body: unknown, ip?: string): Request {
  const clientIp = ip ?? `10.1.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  return new Request('http://localhost/api/public/sales', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': clientIp },
    body: JSON.stringify(body),
  });
}

function validBody(slug: string, productId: string | undefined, over: Record<string, unknown> = {}) {
  return {
    slug,
    channel: 'pickup',
    idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
    honeypot: '',
    customer: { name: 'Guest One', phone: '9990001111' },
    lines: [{ productId, qty: 2 }],
    ...over,
  };
}

describe('POST /api/public/sales', () => {
  it('creates a storefront sale: source=storefront, no creator node, audit row', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [pid] = await seedProducts(clientId, [{ name: 'Mocha', sale_price_cents: 30000, status: 'active' }]);

    const res = await handler(postReq(validBody(slug, pid)));
    expect(res.status).toBe(201);
    const out = (await res.json()) as { id: string; orderNo: number; status: string; totalCents: number; lines: unknown[] };
    expect(out.status).toBe('pending_payment');
    expect(out.totalCents).toBe(60000); // 2 × server-snapshot 30000
    expect(out.lines).toHaveLength(1);
    // internal columns must not leak
    expect(JSON.stringify(out)).not.toContain(clientId);

    const row = (await sql`SELECT source, created_by_user_node, payment_method FROM public.sales WHERE id = ${out.id}`) as Array<{ source: string; created_by_user_node: string | null; payment_method: string | null }>;
    expect(row[0]!.source).toBe('storefront');
    expect(row[0]!.created_by_user_node).toBeNull();

    const audit = (await sql`SELECT actor_user_node, actor_admin, detail FROM public.audit_log WHERE target_id = ${out.id} AND op = 'pos.sale.created'`) as Array<{ actor_user_node: string | null; actor_admin: string | null; detail: any }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_user_node).toBeNull();
    expect(audit[0]!.actor_admin).toBeNull();
    expect(audit[0]!.detail.source).toBe('storefront');
  });

  it('honeypot filled → 200 fake success, NO db write', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [pid] = await seedProducts(clientId, [{ name: 'Bot Bait', sale_price_cents: 1000, status: 'active' }]);
    const before = (await sql`SELECT count(*)::int AS n FROM public.sales WHERE bucket_id = ${clientId}`) as Array<{ n: number }>;

    const res = await handler(postReq(validBody(slug, pid, { honeypot: 'i-am-a-bot' })));
    expect(res.status).toBe(200);

    const after = (await sql`SELECT count(*)::int AS n FROM public.sales WHERE bucket_id = ${clientId}`) as Array<{ n: number }>;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it('rejects channel=instore at the schema layer (400)', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [pid] = await seedProducts(clientId, [{ name: 'X', sale_price_cents: 1000, status: 'active' }]);
    const res = await handler(postReq(validBody(slug, pid, { channel: 'instore' })));
    expect(res.status).toBe(400);
  });

  it('is idempotent: same key returns the same sale', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [pid] = await seedProducts(clientId, [{ name: 'Idem', sale_price_cents: 5000, status: 'active' }]);
    const body = validBody(slug, pid, { idempotencyKey: 'fixed-key-abcdef' });
    const a = await handler(postReq(body));
    const b = await handler(postReq(body));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect((await a.json() as { id: string }).id).toBe((await b.json() as { id: string }).id);
  });

  it('404 for a disabled / unknown storefront', async () => {
    const { clientId, slug } = await seedStorefrontClient({ storefrontEnabled: false });
    const [pid] = await seedProducts(clientId, [{ name: 'Y', sale_price_cents: 1000, status: 'active' }]);
    const res = await handler(postReq(validBody(slug, pid)));
    expect(res.status).toBe(404);
  });

  it('404 for a cross-tenant product (leak guard)', async () => {
    const { slug } = await seedStorefrontClient();
    const other = await seedStorefrontClient();
    const [otherPid] = await seedProducts(other.clientId, [{ name: 'Theirs', sale_price_cents: 1000, status: 'active' }]);
    const res = await handler(postReq(validBody(slug, otherPid)));
    expect(res.status).toBe(404);
  });

  it('400 for a storefront-hidden product', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [pid] = await seedProducts(clientId, [{ name: 'Hidden', sale_price_cents: 1000, status: 'active' }]);
    await sql`UPDATE public.products SET storefront_visible = false WHERE id = ${pid}`;
    const res = await handler(postReq(validBody(slug, pid)));
    expect(res.status).toBe(400);
  });

  it('400 on out-of-bounds qty', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [pid] = await seedProducts(clientId, [{ name: 'Q', sale_price_cents: 1000, status: 'active' }]);
    const res = await handler(postReq(validBody(slug, pid, { lines: [{ productId: pid, qty: 100 }] })));
    expect(res.status).toBe(400);
  });
});
