// POST /api/booking-public/razorpay-webhook — Razorpay payment webhook.
// Verifies the X-Razorpay-Signature against RAZORPAY_WEBHOOK_SECRET, then on a
// captured payment flips the referenced booking pending → confirmed and records the
// paid amount. The booking id travels in the payment's `notes.booking_id` (set on
// order-create at deploy time). Idempotent: only flips rows still in `pending`.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { verifyWebhookSignature } from './_booking-razorpay';

export const config = { path: '/api/booking-public/razorpay-webhook', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return jsonError(500, 'webhook_not_configured');

  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  if (!verifyWebhookSignature(raw, signature, secret)) return jsonError(401, 'invalid_signature');

  let event: any;
  try { event = JSON.parse(raw); } catch { return jsonError(400, 'invalid_json'); }

  if (event?.event === 'payment.captured') {
    const entity = event?.payload?.payment?.entity ?? {};
    const bookingId = entity?.notes?.booking_id;
    const amount = Number(entity?.amount ?? 0); // paise/cents
    if (bookingId) {
      await db()`
        UPDATE public.bookings
           SET status = 'confirmed'::booking_status, deposit_paid_cents = ${amount}, updated_at = now()
         WHERE id = ${bookingId}::uuid AND status = 'pending'
      `;
    }
  }
  return jsonOk({ received: true });
}
