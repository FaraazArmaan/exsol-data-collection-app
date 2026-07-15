import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import webhook from '../../netlify/functions/booking-razorpay-webhook';
import { verifyRazorpayWebhook } from '../../netlify/functions/_payments-razorpay';

describe('Razorpay webhook migration', () => {
  it('keeps HMAC verification timing-safe in the Payments provider seam', () => {
    const body = '{"a":1}';
    const secret = 'whsec_test_booking';
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyRazorpayWebhook(body, signature, secret)).toBe(true);
    expect(verifyRazorpayWebhook(body, 'deadbeef', secret)).toBe(false);
  });

  it('fails closed at the retired Booking webhook URL', async () => {
    const response = await webhook(new Request('http://localhost/api/booking-public/razorpay-webhook', { method: 'POST' }));
    expect(response.status).toBe(410);
    expect((await response.json()).error.code).toBe('legacy_payment_webhook_removed');
  });
});
