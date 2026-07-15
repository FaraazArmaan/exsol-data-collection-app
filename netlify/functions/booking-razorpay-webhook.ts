// Retained solely to fail closed for an old unpublished integration URL.
// Payments owns the tenant-scoped webhook inbox at /api/payments/razorpay-webhook.
import { jsonError } from './_shared/http';

export const config = { path: '/api/booking-public/razorpay-webhook', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  return jsonError(410, 'legacy_payment_webhook_removed');
}
