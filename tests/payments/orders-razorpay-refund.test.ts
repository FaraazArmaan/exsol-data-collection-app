import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import refunds from '../../netlify/functions/orders-refunds';
import advanceRefund from '../../netlify/functions/orders-refund-advance';
import webhook from '../../netlify/functions/payments-razorpay-webhook';
import { encryptPaymentSecret } from '../../netlify/functions/_payments-secrets';
import { makeBucketUserRequest, seedOrdersClient, seedSale } from '../orders/_helpers';

const sql = neon(process.env.DATABASE_URL!);
const webhookSecret = 'orders-refund-webhook-test-secret';
const originalFetch = global.fetch;
const originalKey = process.env.PAYMENTS_ENCRYPTION_KEY;
const prefix = Math.random().toString(36).slice(2, 10);
let paymentNo = 0;
let refundNo = 0;

function refundEvent(event: string, eventId: string, refundId: string, paymentId: string, amount: number, ordersRefundId: string, saleId: string) {
  const body = JSON.stringify({
    event,
    payload: { refund: { entity: {
      id: refundId, payment_id: paymentId, amount, currency: 'INR',
      status: event === 'refund.processed' ? 'processed' : 'failed',
      notes: { orders_refund_id: ordersRefundId, sale_id: saleId },
    } } },
  });
  return new Request('http://localhost/api/payments/razorpay-webhook', {
    method: 'POST', body,
    headers: {
      'x-razorpay-event-id': eventId,
      'x-razorpay-signature': createHmac('sha256', webhookSecret).update(body).digest('hex'),
    },
  });
}

async function capturedSale(total: number) {
  const ctx = await seedOrdersClient();
  const { saleId } = await seedSale(ctx, { status: 'paid', channel: 'online', total });
  const paymentId = `pay_refund_${prefix}_${++paymentNo}`;
  await sql`
    INSERT INTO public.payment_provider_connections
      (client_id, provider, mode, key_id, api_secret_enc, webhook_secret_enc, enabled)
    VALUES (${ctx.clientId}::uuid, 'razorpay', 'test', 'rzp_test_refund',
      ${encryptPaymentSecret('refund-api-secret')}, ${encryptPaymentSecret(webhookSecret)}, true)
  `;
  const request = (await sql`
    INSERT INTO public.payment_requests (client_id, source_type, source_id, purpose, amount_minor)
    VALUES (${ctx.clientId}::uuid, 'sale', ${saleId}::uuid, 'sale_total', ${total})
    RETURNING id
  `) as Array<{ id: string }>;
  const transaction = (await sql`
    INSERT INTO public.payment_transactions
      (client_id, kind, status, amount_minor, currency, provider, provider_transaction_id)
    VALUES (${ctx.clientId}::uuid, 'provider_captured', 'succeeded', ${total}, 'INR', 'razorpay', ${paymentId})
    RETURNING id
  `) as Array<{ id: string }>;
  await sql`
    INSERT INTO public.payment_allocations (client_id, transaction_id, request_id, amount_minor)
    VALUES (${ctx.clientId}::uuid, ${transaction[0]!.id}::uuid, ${request[0]!.id}::uuid, ${total})
  `;
  return { ctx, saleId, paymentId, captureTransactionId: transaction[0]!.id };
}

async function requestRefund(ctx: Awaited<ReturnType<typeof seedOrdersClient>>, saleId: string, amount: number) {
  const response = await refunds(makeBucketUserRequest(ctx, 'POST', '/api/orders/refunds', {
    sale_id: saleId, amount_cents: amount,
  }));
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

beforeAll(() => {
  process.env.PAYMENTS_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
  global.fetch = vi.fn(async (input, init) => {
    const url = String(input);
    if (url.includes('/refund')) {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: `rfnd_refund_${prefix}_${++refundNo}`, amount: body.amount, currency: 'INR', status: 'pending',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.PAYMENTS_ENCRYPTION_KEY;
  else process.env.PAYMENTS_ENCRYPTION_KEY = originalKey;
});

describe('Orders Razorpay refunds', () => {
  it('creates immutable pending evidence and completes only after one signed provider webhook', async () => {
    const { ctx, saleId, paymentId, captureTransactionId } = await capturedSale(5000);
    const refund = await requestRefund(ctx, saleId, 2000);
    const approved = await advanceRefund(makeBucketUserRequest(ctx, 'POST', `/api/orders/refund-advance/${refund.id}`, { to: 'approved' }));
    expect(await approved.json()).toMatchObject({ id: refund.id, state: 'approved', provider_pending: true });
    expect((await advanceRefund(makeBucketUserRequest(ctx, 'POST', `/api/orders/refund-advance/${refund.id}`, { to: 'completed' }))).status).toBe(409);

    const pending = await sql`
      SELECT r.state, t.status, t.refund_of_transaction_id, t.orders_refund_id, t.provider_transaction_id
      FROM public.orders_refunds r
      JOIN public.payment_transactions t ON t.orders_refund_id = r.id
      WHERE r.id = ${refund.id}::uuid
    ` as Array<{ state: string; status: string; refund_of_transaction_id: string; orders_refund_id: string; provider_transaction_id: string }>;
    expect(pending[0]).toMatchObject({ state: 'approved', status: 'pending', refund_of_transaction_id: captureTransactionId, orders_refund_id: refund.id });
    const providerRefundId = pending[0]!.provider_transaction_id;

    const eventId = `evt_refund_${prefix}_partial`;
    expect((await webhook(refundEvent('refund.processed', eventId, providerRefundId, paymentId, 2000, refund.id, saleId))).status).toBe(200);
    expect(await (await webhook(refundEvent('refund.processed', eventId, providerRefundId, paymentId, 2000, refund.id, saleId))).json()).toMatchObject({ duplicate: true });

    const settled = await sql`
      SELECT r.state, r.completed_at, t.status, s.status AS sale_status
      FROM public.orders_refunds r
      JOIN public.payment_transactions t ON t.orders_refund_id = r.id
      JOIN public.sales s ON s.id = r.sale_id
      WHERE r.id = ${refund.id}::uuid
    ` as Array<{ state: string; completed_at: string | null; status: string; sale_status: string }>;
    expect(settled[0]).toMatchObject({ state: 'completed', status: 'succeeded', sale_status: 'paid' });
    expect(settled[0]!.completed_at).not.toBeNull();
  });

  it('marks a fully refunded paid sale refunded only after the provider webhook', async () => {
    const { ctx, saleId, paymentId } = await capturedSale(3000);
    const refund = await requestRefund(ctx, saleId, 3000);
    await advanceRefund(makeBucketUserRequest(ctx, 'POST', `/api/orders/refund-advance/${refund.id}`, { to: 'approved' }));
    const row = await sql`SELECT provider_transaction_id FROM public.payment_transactions WHERE orders_refund_id = ${refund.id}::uuid` as Array<{ provider_transaction_id: string }>;
    await webhook(refundEvent('refund.processed', `evt_refund_${prefix}_full`, row[0]!.provider_transaction_id, paymentId, 3000, refund.id, saleId));
    const sale = await sql`SELECT status FROM public.sales WHERE id = ${saleId}::uuid` as Array<{ status: string }>;
    expect(sale[0]!.status).toBe('refunded');
  });

  it('returns a failed provider refund to requested without changing the sale', async () => {
    const { ctx, saleId, paymentId } = await capturedSale(2500);
    const refund = await requestRefund(ctx, saleId, 1000);
    await advanceRefund(makeBucketUserRequest(ctx, 'POST', `/api/orders/refund-advance/${refund.id}`, { to: 'approved' }));
    const row = await sql`SELECT provider_transaction_id FROM public.payment_transactions WHERE orders_refund_id = ${refund.id}::uuid` as Array<{ provider_transaction_id: string }>;
    await webhook(refundEvent('refund.failed', `evt_refund_${prefix}_failed`, row[0]!.provider_transaction_id, paymentId, 1000, refund.id, saleId));
    const result = await sql`
      SELECT r.state, t.status, s.status AS sale_status
      FROM public.orders_refunds r
      JOIN public.payment_transactions t ON t.orders_refund_id = r.id
      JOIN public.sales s ON s.id = r.sale_id
      WHERE r.id = ${refund.id}::uuid
    ` as Array<{ state: string; status: string; sale_status: string }>;
    expect(result[0]).toMatchObject({ state: 'requested', status: 'failed', sale_status: 'paid' });
  });
});
