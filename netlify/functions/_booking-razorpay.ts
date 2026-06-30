// Razorpay helpers. Signature verification is offline-deterministic (HMAC-SHA256),
// so it's fully unit-testable without the live API. The order-create call (which needs
// RAZORPAY_KEY_ID/SECRET + network) is wired at deploy time — not exercised in tests.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify a Razorpay webhook: HMAC-SHA256(rawBody, webhookSecret) hex === signature. */
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
