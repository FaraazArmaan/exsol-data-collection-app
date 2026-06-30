import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../../netlify/functions/_booking-razorpay';
import webhook from '../../netlify/functions/booking-razorpay-webhook';
import { sqlClient, seedClientWithBooking, seedResource, makeService } from './_helpers';

const SECRET = 'whsec_test_booking';
const sql = sqlClient();
let clientId: string, resId: string, svc: string, nodeId: string;

beforeAll(async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  const ctx = await seedClientWithBooking();
  clientId = ctx.clientId; nodeId = ctx.ownerNodeId;
  resId = await seedResource(clientId, 'Sarah');
  svc = await makeService(clientId, { duration_min: 60, payment_mode: 'deposit', deposit_cents: 10000 });
});

function signed(bookingId: string, amount: number) {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { amount, notes: { booking_id: bookingId } } } } });
  const signature = createHmac('sha256', SECRET).update(body).digest('hex');
  return new Request('http://localhost/api/booking-public/razorpay-webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature }, body,
  });
}

describe('verifyWebhookSignature', () => {
  it('accepts a correct HMAC, rejects a wrong one', () => {
    const body = '{"a":1}';
    const good = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyWebhookSignature(body, good, SECRET)).toBe(true);
    expect(verifyWebhookSignature(body, 'deadbeef', SECRET)).toBe(false);
  });
});

describe('POST razorpay-webhook', () => {
  it('captured payment flips the pending booking → confirmed + records amount', async () => {
    const r = (await sql`INSERT INTO public.bookings (bucket_id, service_id, resource_id, user_node_id, time_range, status, customer_name)
      VALUES (${clientId}, ${svc}, ${resId}, ${nodeId}, '[2033-01-01T09:00:00Z,2033-01-01T10:00:00Z)', 'pending', 'Riya') RETURNING id`) as any[];
    const id = r[0].id;
    const res = await webhook(signed(id, 10000));
    expect(res.status).toBe(200);
    const after = (await sql`SELECT status, deposit_paid_cents FROM public.bookings WHERE id = ${id}::uuid`) as any[];
    expect(after[0].status).toBe('confirmed');
    expect(Number(after[0].deposit_paid_cents)).toBe(10000);
  });

  it('rejects an invalid signature → 401', async () => {
    const bad = new Request('http://localhost/api/booking-public/razorpay-webhook', {
      method: 'POST', headers: { 'x-razorpay-signature': 'nope' }, body: '{"event":"payment.captured"}',
    });
    expect((await webhook(bad)).status).toBe(401);
  });
});
