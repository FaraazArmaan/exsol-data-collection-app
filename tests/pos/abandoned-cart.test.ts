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

// Never send real email from tests — stub the low-level deliver seam.
vi.mock('../../netlify/functions/_shared/resend', () => ({
  deliver: async () => ({ ok: true, delivered: false }),
}));

import { neon } from '@neondatabase/serverless';
import saveHandler from '../../netlify/functions/pub-cart-save';
import saleHandler from '../../netlify/functions/pub-sale-create';
import { sweepAbandonedCarts } from '../../netlify/functions/abandoned-cart-cron';
import { seedStorefrontClient, seedProducts } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ipCounter = 70000;
function publicPost(path: string, body: unknown): Request {
  const ip = `10.3.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip },
    body: JSON.stringify(body),
  });
}

describe('abandoned cart', () => {
  it('persists a cart on save, then flips to converted when the sale completes', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [pid] = await seedProducts(clientId, [{ name: 'Trim', sale_price_cents: 20000 }]);
    const sessionKey = `sess-${Math.random().toString(36).slice(2, 12)}`;

    const save = await saveHandler(publicPost('/api/public/cart', {
      slug, sessionKey, channel: 'pickup',
      customer: { name: 'Meera', email: 'meera@example.com' },
      lines: [{ productId: pid, qty: 2 }],
    }));
    expect(save.status).toBe(200);
    const row = (await sql`SELECT status, subtotal_cents FROM public.abandoned_carts WHERE client_id = ${clientId} AND session_key = ${sessionKey}`) as Array<{ status: string; subtotal_cents: number }>;
    expect(row[0]!.status).toBe('active');
    expect(Number(row[0]!.subtotal_cents)).toBe(40000);

    // Complete the sale with the SAME session key (= idempotencyKey).
    const sale = await saleHandler(publicPost('/api/public/sales', {
      slug, channel: 'pickup', idempotencyKey: sessionKey, honeypot: '',
      customer: { name: 'Meera', phone: '9998887777', email: 'meera@example.com' },
      lines: [{ productId: pid, qty: 2 }],
    }));
    expect(sale.status).toBe(201);
    const after = (await sql`SELECT status FROM public.abandoned_carts WHERE client_id = ${clientId} AND session_key = ${sessionKey}`) as Array<{ status: string }>;
    expect(after[0]!.status).toBe('converted');
  });

  it('cron reminds a cold active cart and skips recent + converted ones', async () => {
    const { clientId } = await seedStorefrontClient();
    const lines = JSON.stringify([{ productId: 'x', name: 'Combo', qty: 1, unitPriceCents: 30000 }]);

    // Cold active (1h idle) → should be reminded.
    const cold = (await sql`
      INSERT INTO public.abandoned_carts (client_id, session_key, customer_email, lines, subtotal_cents, status, updated_at)
      VALUES (${clientId}, ${'cold-' + Math.random().toString(36).slice(2, 8)}, 'cold@example.com', ${lines}::jsonb, 30000, 'active', now() - interval '1 hour')
      RETURNING id
    `) as Array<{ id: string }>;
    // Fresh active → should be skipped.
    const fresh = (await sql`
      INSERT INTO public.abandoned_carts (client_id, session_key, customer_email, lines, subtotal_cents, status, updated_at)
      VALUES (${clientId}, ${'fresh-' + Math.random().toString(36).slice(2, 8)}, 'fresh@example.com', ${lines}::jsonb, 30000, 'active', now())
      RETURNING id
    `) as Array<{ id: string }>;

    await sweepAbandonedCarts(sql, { staleMinutes: 30 });

    const coldRow = (await sql`SELECT status, reminded_at FROM public.abandoned_carts WHERE id = ${cold[0]!.id}`) as Array<{ status: string; reminded_at: string | null }>;
    expect(coldRow[0]!.status).toBe('reminded');
    expect(coldRow[0]!.reminded_at).not.toBeNull();

    const freshRow = (await sql`SELECT status FROM public.abandoned_carts WHERE id = ${fresh[0]!.id}`) as Array<{ status: string }>;
    expect(freshRow[0]!.status).toBe('active');
  });
});
