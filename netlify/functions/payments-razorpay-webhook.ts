import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { decryptPaymentSecret, PaymentsEncryptionUnavailable } from './_payments-secrets';
import { verifyRazorpayWebhook } from './_payments-razorpay';

export const config = { path: '/api/payments/razorpay-webhook', method: 'POST' };

interface AttemptRow {
  id: string;
  client_id: string;
  request_id: string;
  status: string;
  amount_minor: number;
  currency: string;
  expires_at: string | null;
  source_id: string;
  webhook_secret_enc: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const raw = await req.text();
  const eventId = req.headers.get('x-razorpay-event-id');
  if (!eventId) return jsonError(400, 'missing_event_id');
  let event: any;
  try { event = JSON.parse(raw); } catch { return jsonError(400, 'invalid_json'); }
  const entity = event?.payload?.payment?.entity;
  const orderId = typeof entity?.order_id === 'string' ? entity.order_id : null;
  if (!orderId) return jsonOk({ received: true });

  const sql = db();
  const attempts = (await sql`
    SELECT a.id, a.client_id, a.request_id, a.status, a.amount_minor, a.currency, a.expires_at,
           pr.source_id, pc.webhook_secret_enc
    FROM public.payment_attempts a
    JOIN public.payment_requests pr ON pr.id = a.request_id
    JOIN public.payment_provider_connections pc
      ON pc.client_id = a.client_id AND pc.provider = 'razorpay' AND pc.mode = 'test' AND pc.enabled = true
    WHERE a.provider = 'razorpay' AND a.provider_order_id = ${orderId}
    LIMIT 1
  `) as AttemptRow[];
  const attempt = attempts[0];
  if (!attempt) return jsonOk({ received: true });

  let webhookSecret: string;
  try { webhookSecret = decryptPaymentSecret(attempt.webhook_secret_enc); }
  catch (error) {
    if (error instanceof PaymentsEncryptionUnavailable) return jsonError(503, 'payments_encryption_unavailable');
    throw error;
  }
  if (!verifyRazorpayWebhook(raw, req.headers.get('x-razorpay-signature') ?? '', webhookSecret)) {
    return jsonError(401, 'invalid_signature');
  }
  const inbox = (await sql`
    INSERT INTO public.payment_webhook_events
      (client_id, attempt_id, provider, provider_event_id, event_type, payload, status)
    VALUES (
      ${attempt.client_id}::uuid, ${attempt.id}::uuid, 'razorpay', ${eventId},
      ${typeof event.event === 'string' ? event.event : 'unknown'}, ${JSON.stringify(event)}::jsonb, 'ignored'
    )
    ON CONFLICT (provider, provider_event_id) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;
  if (!inbox[0]) return jsonOk({ received: true, duplicate: true });

  if (event.event !== 'payment.captured') {
    await sql`UPDATE public.payment_webhook_events SET processed_at = now() WHERE id = ${inbox[0].id}::uuid`;
    return jsonOk({ received: true });
  }
  const paymentId = typeof entity?.id === 'string' ? entity.id : null;
  const amount = Number(entity?.amount);
  const currency = typeof entity?.currency === 'string' ? entity.currency : '';
  if (!paymentId || !Number.isSafeInteger(amount) || amount <= 0 || amount !== Number(attempt.amount_minor) || currency !== attempt.currency) {
    await sql.transaction([
      sql`
        UPDATE public.payment_attempts
        SET status = 'quarantined', failure_reason = 'amount_or_currency_mismatch'
        WHERE id = ${attempt.id}::uuid AND status = 'created'
      `,
      sql`
        UPDATE public.payment_webhook_events
        SET status = 'quarantined', reason = 'amount_or_currency_mismatch', processed_at = now()
        WHERE id = ${inbox[0].id}::uuid
      `,
    ]);
    return jsonOk({ received: true });
  }

  const settled = (await sql`
    WITH visit AS (
      SELECT id, status
      FROM public.booking_visits
      WHERE id = ${attempt.source_id}::uuid AND bucket_id = ${attempt.client_id}::uuid
      FOR UPDATE
    ), claim AS (
      UPDATE public.payment_attempts a
      SET status = CASE WHEN (SELECT status FROM visit) = 'pending' AND (a.expires_at IS NULL OR a.expires_at > now()) THEN 'captured' ELSE 'quarantined' END,
          provider_payment_id = ${paymentId},
          failure_reason = CASE WHEN (SELECT status FROM visit) = 'pending' AND (a.expires_at IS NULL OR a.expires_at > now()) THEN NULL ELSE 'booking_hold_expired' END
      WHERE a.id = ${attempt.id}::uuid AND a.status = 'created'
      RETURNING a.status
    ), transaction_row AS (
      INSERT INTO public.payment_transactions
        (client_id, kind, status, amount_minor, currency, provider, provider_transaction_id, occurred_at)
      SELECT ${attempt.client_id}::uuid, 'provider_captured', 'succeeded', ${amount}, ${currency}, 'razorpay', ${paymentId}, now()
      FROM claim
      ON CONFLICT (provider, provider_transaction_id) WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL DO NOTHING
      RETURNING id
    ), allocation AS (
      INSERT INTO public.payment_allocations (client_id, transaction_id, request_id, amount_minor)
      SELECT ${attempt.client_id}::uuid, transaction_row.id, ${attempt.request_id}::uuid, ${amount}
      FROM transaction_row CROSS JOIN claim WHERE claim.status = 'captured'
      RETURNING id
    ), request_update AS (
      UPDATE public.payment_requests SET status = 'paid', updated_at = now()
      WHERE id = ${attempt.request_id}::uuid AND EXISTS (SELECT 1 FROM allocation)
    ), updated AS (
      UPDATE public.booking_visits v
      SET status = 'confirmed'::booking_status,
          payment_status = CASE WHEN v.deposit_paid_cents + ${amount} >= v.price_cents THEN 'paid'::booking_payment_status ELSE 'partly_paid'::booking_payment_status END,
          deposit_paid_cents = v.deposit_paid_cents + ${amount}, updated_at = now()
      WHERE v.id = ${attempt.source_id}::uuid AND EXISTS (SELECT 1 FROM allocation)
      RETURNING v.id, v.status, v.payment_status, v.deposit_paid_cents
    ), mirror AS (
      UPDATE public.bookings b SET status = updated.status, deposit_paid_cents = updated.deposit_paid_cents, updated_at = now()
      FROM updated WHERE b.visit_id = updated.id
    ), reservation AS (
      UPDATE public.booking_line_reservations r SET status = updated.status
      FROM updated WHERE r.visit_id = updated.id
    ), booking_event AS (
      INSERT INTO public.booking_events (visit_id, bucket_id, source, event_type, new_state, reference)
      SELECT id, ${attempt.client_id}::uuid, 'payment', 'provider_captured',
             jsonb_build_object('appointment_status', status, 'payment_status', payment_status, 'paid_cents', deposit_paid_cents),
             ${paymentId}
      FROM updated
    )
    SELECT status FROM claim
  `) as Array<{ status: 'captured' | 'quarantined' }>;
  const status = settled[0]?.status;
  await sql`
    UPDATE public.payment_webhook_events
    SET status = ${status === 'quarantined' ? 'quarantined' : 'processed'},
        reason = ${status === 'quarantined' ? 'booking_hold_expired' : status ? null : 'duplicate_capture'},
        processed_at = now()
    WHERE id = ${inbox[0].id}::uuid
  `;
  return jsonOk({ received: true });
}
