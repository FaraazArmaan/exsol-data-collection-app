import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import createBooking from '../../netlify/functions/booking-public-create';
import webhook from '../../netlify/functions/payments-razorpay-webhook';
import { encryptPaymentSecret } from '../../netlify/functions/_payments-secrets';
import {
  enableBooking, makeService, publicRequest, publishBooking, seedClientWithBooking,
  seedCustomerRole, seedResource, setBookingSettings, sqlClient,
} from '../booking/_helpers';

const sql = sqlClient();
const webhookSecret = 'webhook-test-secret';
const originalFetch = global.fetch;
const originalKey = process.env.PAYMENTS_ENCRYPTION_KEY;
let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
let serviceId: string;
let orderNumber = 0;
const orderPrefix = Math.random().toString(36).slice(2, 10);

function webhookRequest(payload: object, eventId: string): Request {
  const body = JSON.stringify(payload);
  return new Request('http://localhost/api/payments/razorpay-webhook', {
    method: 'POST',
    headers: {
      'x-razorpay-event-id': eventId,
      'x-razorpay-signature': createHmac('sha256', webhookSecret).update(body).digest('hex'),
    },
    body,
  });
}

async function createDeposit(start: string, phone: string) {
  return createBooking(publicRequest(ctx.slug, 'POST', '/create', {
    service_id: serviceId, resource_id: 'any', start,
    customer: { name: 'Razorpay Test Customer', phone },
  }));
}

beforeAll(async () => {
  process.env.PAYMENTS_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  await seedCustomerRole(ctx.clientId);
  const resourceId = await seedResource(ctx.clientId, 'Razorpay test staff');
  serviceId = await makeService(ctx.clientId, {
    name: 'Razorpay deposit service', price_cents: 1200, payment_mode: 'deposit', deposit_cents: 400,
    eligible_resource_ids: [resourceId],
  });
  await setBookingSettings(ctx.clientId, { mon: [{ open: '09:00', close: '15:00' }] });
  await publishBooking(ctx.clientId);
  await sql`
    INSERT INTO public.payment_provider_connections
      (client_id, provider, mode, key_id, api_secret_enc, webhook_secret_enc, enabled)
    VALUES (
      ${ctx.clientId}::uuid, 'razorpay', 'test', 'rzp_test_checkout',
      ${encryptPaymentSecret('api-test-secret')}, ${encryptPaymentSecret(webhookSecret)}, true
    )
  `;
  global.fetch = vi.fn(async (input, init) => {
    if (String(input) === 'https://api.razorpay.com/v1/orders') {
      return new Response(JSON.stringify({
        id: `order_test_${orderPrefix}_${++orderNumber}`, amount: 400, currency: 'INR',
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

describe('Booking Razorpay Test-mode checkout', () => {
  it('creates a server-priced order and processes a duplicate signed capture exactly once', async () => {
    const created = await createDeposit('2026-08-24T03:30:00.000Z', `91${Math.random().toString().slice(2, 12)}`);
    expect(created.status).toBe(201);
    const booking = await created.json();
    expect(booking).toMatchObject({ status: 'pending', payment_intent: { provider: 'razorpay', amount_cents: 400, currency: 'INR' } });

    const payload = { event: 'payment.captured', payload: { payment: { entity: { id: `pay_test_${orderPrefix}_1`, order_id: booking.payment_intent.order_id, amount: 400, currency: 'INR' } } } };
    const eventId = `evt_test_${orderPrefix}_1`;
    expect((await webhook(webhookRequest(payload, eventId))).status).toBe(200);
    const duplicate = await webhook(webhookRequest(payload, eventId));
    expect(await duplicate.json()).toMatchObject({ duplicate: true });

    const rows = await sql`
      SELECT v.status, v.payment_status, v.deposit_paid_cents,
             (SELECT count(*)::int FROM public.payment_transactions WHERE client_id = ${ctx.clientId}::uuid AND provider_transaction_id = ${payload.payload.payment.entity.id}) AS transactions,
             (SELECT count(*)::int FROM public.payment_allocations a JOIN public.payment_requests r ON r.id = a.request_id WHERE r.source_id = ${booking.visit_id}::uuid) AS allocations,
             (SELECT status FROM public.payment_webhook_events WHERE provider_event_id = ${eventId}) AS webhook_status
      FROM public.booking_visits v WHERE v.id = ${booking.visit_id}::uuid
    ` as Array<{ status: string; payment_status: string; deposit_paid_cents: string; transactions: number; allocations: string; webhook_status: string }>;
    expect(rows[0]).toMatchObject({ status: 'confirmed', payment_status: 'partly_paid', deposit_paid_cents: '400', transactions: 1, allocations: 1, webhook_status: 'processed' });
  });

  it('quarantines a signed capture with the wrong amount without confirming the visit', async () => {
    const created = await createDeposit('2026-08-24T05:00:00.000Z', `92${Math.random().toString().slice(2, 12)}`);
    const booking = await created.json();
    const payload = { event: 'payment.captured', payload: { payment: { entity: { id: `pay_test_${orderPrefix}_wrong`, order_id: booking.payment_intent.order_id, amount: 401, currency: 'INR' } } } };
    expect((await webhook(webhookRequest(payload, `evt_test_${orderPrefix}_wrong`))).status).toBe(200);
    const rows = await sql`
      SELECT v.status, a.status AS attempt_status, e.status AS event_status, e.reason
      FROM public.booking_visits v
      JOIN public.payment_requests r ON r.source_id = v.id
      JOIN public.payment_attempts a ON a.request_id = r.id
      JOIN public.payment_webhook_events e ON e.attempt_id = a.id
      WHERE v.id = ${booking.visit_id}::uuid
    ` as Array<{ status: string; attempt_status: string; event_status: string; reason: string }>;
    expect(rows[0]).toEqual({ status: 'pending', attempt_status: 'quarantined', event_status: 'quarantined', reason: 'amount_or_currency_mismatch' });
  });

  it('quarantines a late signed capture instead of reopening a cancelled hold', async () => {
    const created = await createDeposit('2026-08-24T06:30:00.000Z', `93${Math.random().toString().slice(2, 12)}`);
    const booking = await created.json();
    await sql`UPDATE public.booking_visits SET status = 'cancelled'::booking_status WHERE id = ${booking.visit_id}::uuid`;
    const payload = { event: 'payment.captured', payload: { payment: { entity: { id: `pay_test_${orderPrefix}_late`, order_id: booking.payment_intent.order_id, amount: 400, currency: 'INR' } } } };
    expect((await webhook(webhookRequest(payload, `evt_test_${orderPrefix}_late`))).status).toBe(200);
    const rows = await sql`
      SELECT v.status, a.status AS attempt_status, e.status AS event_status, e.reason
      FROM public.booking_visits v
      JOIN public.payment_requests r ON r.source_id = v.id
      JOIN public.payment_attempts a ON a.request_id = r.id
      JOIN public.payment_webhook_events e ON e.attempt_id = a.id
      WHERE v.id = ${booking.visit_id}::uuid
    ` as Array<{ status: string; attempt_status: string; event_status: string; reason: string }>;
    expect(rows[0]).toEqual({ status: 'cancelled', attempt_status: 'quarantined', event_status: 'quarantined', reason: 'booking_hold_expired' });
  });
});
