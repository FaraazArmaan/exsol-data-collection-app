import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('@netlify/blobs', () => ({
  getStore: () => ({ get: async () => null, setJSON: async () => undefined }),
}));

import { neon } from '@neondatabase/serverless';
import publicCreate from '../../netlify/functions/pub-sale-create';
import posCreate from '../../netlify/functions/pos-sale-create';
import webhook from '../../netlify/functions/payments-razorpay-webhook';
import { encryptPaymentSecret } from '../../netlify/functions/_payments-secrets';
import {
  grantPerms, makeBucketUserRequest, seedClientWithProductsEnabled, seedProducts, seedStorefrontClient,
} from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);
const webhookSecret = 'sale-webhook-test-secret';
const originalFetch = global.fetch;
const originalKey = process.env.PAYMENTS_ENCRYPTION_KEY;
const prefix = Math.random().toString(36).slice(2, 10);
let orderNo = 0;

function event(orderId: string, eventId: string, paymentId: string, amount: number) {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: 'INR' } } } });
  return new Request('http://localhost/api/payments/razorpay-webhook', {
    method: 'POST', body,
    headers: {
      'x-razorpay-event-id': eventId,
      'x-razorpay-signature': createHmac('sha256', webhookSecret).update(body).digest('hex'),
    },
  });
}

async function connect(clientId: string) {
  await sql`
    INSERT INTO public.payment_provider_connections
      (client_id, provider, mode, key_id, api_secret_enc, webhook_secret_enc, enabled)
    VALUES (${clientId}::uuid, 'razorpay', 'test', 'rzp_test_sale_checkout',
      ${encryptPaymentSecret('sale-api-secret')}, ${encryptPaymentSecret(webhookSecret)}, true)
  `;
}

beforeAll(() => {
  process.env.PAYMENTS_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64');
  global.fetch = vi.fn(async (input, init) => {
    if (String(input) === 'https://api.razorpay.com/v1/orders') {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: `order_sale_${prefix}_${++orderNo}`, amount: body.amount, currency: body.currency }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.PAYMENTS_ENCRYPTION_KEY;
  else process.env.PAYMENTS_ENCRYPTION_KEY = originalKey;
});

describe('Razorpay Test-mode sale checkout', () => {
  it('creates one storefront order and captures it once without using payment_ref for the provider ID', async () => {
    const { clientId, slug } = await seedStorefrontClient();
    const [productId] = await seedProducts(clientId, [{ name: 'Checkout product', sale_price_cents: 725 }]);
    await connect(clientId);
    const body = {
      slug, channel: 'online', idempotencyKey: `idem-sale-${prefix}`, honeypot: '',
      customer: { name: 'Storefront buyer', phone: `98${Math.random().toString().slice(2, 12)}` },
      lines: [{ productId, qty: 2 }],
    };
    const create = await publicCreate(new Request('http://localhost/api/public/sales', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '10.77.0.1' }, body: JSON.stringify(body),
    }));
    expect(create.status).toBe(201);
    const sale = await create.json() as { id: string; payment_intent: { order_id: string; amount_cents: number } };
    expect(sale.payment_intent.amount_cents).toBe(1450);

    const eventId = `evt_sale_${prefix}`;
    const paymentId = `pay_sale_${prefix}`;
    expect((await webhook(event(sale.payment_intent.order_id, eventId, paymentId, 1450))).status).toBe(200);
    expect(await (await webhook(event(sale.payment_intent.order_id, eventId, paymentId, 1450))).json()).toMatchObject({ duplicate: true });

    const rows = await sql`
      SELECT s.status, s.payment_ref, s.paid_at,
        (SELECT count(*)::int FROM public.payment_transactions WHERE provider_transaction_id = ${paymentId}) AS transactions,
        (SELECT count(*)::int FROM public.payment_allocations a JOIN public.payment_requests r ON r.id = a.request_id WHERE r.source_type = 'sale' AND r.source_id = s.id) AS allocations
      FROM public.sales s WHERE s.id = ${sale.id}::uuid
    ` as Array<{ status: string; payment_ref: string; paid_at: string | null; transactions: number; allocations: number }>;
    expect(rows[0]).toMatchObject({ status: 'paid', transactions: 1, allocations: 1 });
    expect(rows[0]!.paid_at).not.toBeNull();
    expect(rows[0]!.payment_ref).toBe(`idem:${body.idempotencyKey}`);
  });

  it('returns a checkout intent for an authenticated POS online sale', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const [productId] = await seedProducts(ctx.clientId, [{ name: 'POS checkout product', sale_price_cents: 600 }]);
    await grantPerms(ctx.clientId, 1, ['pos.sale.create']);
    await connect(ctx.clientId);
    const response = await posCreate(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'online', idempotencyKey: `idem-pos-${prefix}`,
      customer: { name: 'POS buyer', phone: `97${Math.random().toString().slice(2, 12)}` },
      lines: [{ productId, qty: 1 }],
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: 'pending_payment', payment_intent: { provider: 'razorpay', amount_cents: 600 } });
  });
});
