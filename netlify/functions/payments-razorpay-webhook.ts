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
  source_type: 'booking_visit' | 'sale';
  source_id: string;
  webhook_secret_enc: string;
}

interface RefundCaptureRow {
  id: string;
  client_id: string;
  webhook_secret_enc: string;
}

interface RefundLedgerRow {
  id: string;
  orders_refund_id: string;
  sale_id: string;
  amount_minor: string;
  currency: string;
  status: string;
  provider_transaction_id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const raw = await req.text();
  const eventId = req.headers.get('x-razorpay-event-id');
  if (!eventId) return jsonError(400, 'missing_event_id');
  let event: any;
  try { event = JSON.parse(raw); } catch { return jsonError(400, 'invalid_json'); }
  if (typeof event?.event === 'string' && event.event.startsWith('refund.')) {
    return handleRefundWebhook(raw, eventId, req.headers.get('x-razorpay-signature') ?? '', event);
  }
  const entity = event?.payload?.payment?.entity;
  const orderId = typeof entity?.order_id === 'string' ? entity.order_id : null;
  if (!orderId) return jsonOk({ received: true });

  const sql = db();
  const attempts = (await sql`
    SELECT a.id, a.client_id, a.request_id, a.status, a.amount_minor, a.currency, a.expires_at,
           pr.source_type, pr.source_id, pc.webhook_secret_enc
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

  const settlesBooking = attempt.source_type === 'booking_visit';
  const settled = (await sql`
    WITH visit AS (
      SELECT id, status
      FROM public.booking_visits
      WHERE id = ${attempt.source_id}::uuid AND bucket_id = ${attempt.client_id}::uuid
      FOR UPDATE
    ), sale AS (
      SELECT id, status
      FROM public.sales
      WHERE id = ${attempt.source_id}::uuid AND bucket_id = ${attempt.client_id}::uuid
      FOR UPDATE
    ), claim AS (
      UPDATE public.payment_attempts a
      SET status = CASE WHEN (
            (${settlesBooking}::boolean AND (SELECT status FROM visit) = 'pending')
            OR (NOT ${settlesBooking}::boolean AND (SELECT status FROM sale) = 'pending_payment')
          ) AND (a.expires_at IS NULL OR a.expires_at > now()) THEN 'captured' ELSE 'quarantined' END,
          provider_payment_id = ${paymentId},
          failure_reason = CASE WHEN (
            (${settlesBooking}::boolean AND (SELECT status FROM visit) = 'pending')
            OR (NOT ${settlesBooking}::boolean AND (SELECT status FROM sale) = 'pending_payment')
          ) AND (a.expires_at IS NULL OR a.expires_at > now()) THEN NULL ELSE ${settlesBooking ? 'booking_hold_expired' : 'sale_payment_expired'} END
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
      WHERE ${settlesBooking}::boolean AND v.id = ${attempt.source_id}::uuid AND EXISTS (SELECT 1 FROM allocation)
      RETURNING v.id, v.status, v.payment_status, v.deposit_paid_cents
    ), sale_update AS (
      UPDATE public.sales s
      SET status = 'paid'::sale_status, paid_at = now(), payment_method = 'razorpay'
      WHERE NOT ${settlesBooking}::boolean AND s.id = ${attempt.source_id}::uuid
        AND s.status = 'pending_payment'::sale_status AND EXISTS (SELECT 1 FROM allocation)
      RETURNING s.id
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
        reason = ${status === 'quarantined' ? (settlesBooking ? 'booking_hold_expired' : 'sale_payment_expired') : status ? null : 'duplicate_capture'},
        processed_at = now()
    WHERE id = ${inbox[0].id}::uuid
  `;
  return jsonOk({ received: true });
}

async function handleRefundWebhook(raw: string, eventId: string, signature: string, event: any): Promise<Response> {
  const entity = event?.payload?.refund?.entity;
  const refundId = typeof entity?.id === 'string' ? entity.id : null;
  const paymentId = typeof entity?.payment_id === 'string' ? entity.payment_id : null;
  if (!refundId || !paymentId) return jsonOk({ received: true });

  const sql = db();
  const captures = (await sql`
    SELECT t.id, t.client_id, pc.webhook_secret_enc
    FROM public.payment_transactions t
    JOIN public.payment_provider_connections pc
      ON pc.client_id = t.client_id AND pc.provider = 'razorpay' AND pc.mode = 'test' AND pc.enabled = true
    WHERE t.kind = 'provider_captured' AND t.status = 'succeeded'
      AND t.provider = 'razorpay' AND t.provider_transaction_id = ${paymentId}
    LIMIT 1
  `) as RefundCaptureRow[];
  const capture = captures[0];
  if (!capture) return jsonOk({ received: true });

  let webhookSecret: string;
  try { webhookSecret = decryptPaymentSecret(capture.webhook_secret_enc); }
  catch (error) {
    if (error instanceof PaymentsEncryptionUnavailable) return jsonError(503, 'payments_encryption_unavailable');
    throw error;
  }
  if (!verifyRazorpayWebhook(raw, signature, webhookSecret)) return jsonError(401, 'invalid_signature');

  const inbox = (await sql`
    INSERT INTO public.payment_webhook_events
      (client_id, provider, provider_event_id, event_type, payload, status)
    VALUES (
      ${capture.client_id}::uuid, 'razorpay', ${eventId},
      ${typeof event.event === 'string' ? event.event : 'unknown'}, ${JSON.stringify(event)}::jsonb, 'ignored'
    )
    ON CONFLICT (provider, provider_event_id) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;
  if (!inbox[0]) return jsonOk({ received: true, duplicate: true });

  const noteRefundId = typeof entity?.notes?.orders_refund_id === 'string' && UUID_RE.test(entity.notes.orders_refund_id)
    ? entity.notes.orders_refund_id
    : null;
  const ledgers = (await sql`
    SELECT t.id, t.orders_refund_id, r.sale_id, t.amount_minor, t.currency, t.status, t.provider_transaction_id
    FROM public.payment_transactions t
    JOIN public.orders_refunds r ON r.id = t.orders_refund_id
    WHERE t.client_id = ${capture.client_id}::uuid
      AND t.kind = 'provider_refunded'
      AND t.provider = 'razorpay'
      AND t.refund_of_transaction_id = ${capture.id}::uuid
      AND (t.provider_transaction_id = ${refundId} OR (t.provider_transaction_id IS NULL AND t.orders_refund_id = ${noteRefundId}::uuid))
    LIMIT 1
  `) as RefundLedgerRow[];
  const ledger = ledgers[0];
  if (!ledger) {
    await sql`UPDATE public.payment_webhook_events SET processed_at = now() WHERE id = ${inbox[0].id}::uuid`;
    return jsonOk({ received: true });
  }

  const amount = Number(entity?.amount);
  const currency = typeof entity?.currency === 'string' ? entity.currency : '';
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount !== Number(ledger.amount_minor) || currency !== ledger.currency) {
    await sql`
      UPDATE public.payment_webhook_events
      SET status = 'quarantined', reason = 'amount_or_currency_mismatch', processed_at = now()
      WHERE id = ${inbox[0].id}::uuid
    `;
    return jsonOk({ received: true });
  }

  if (event.event === 'refund.created') {
    await sql`
      UPDATE public.payment_transactions
      SET provider_transaction_id = ${refundId}
      WHERE id = ${ledger.id}::uuid AND status = 'pending' AND provider_transaction_id IS NULL
    `;
    await sql`UPDATE public.payment_webhook_events SET status = 'processed', processed_at = now() WHERE id = ${inbox[0].id}::uuid`;
    return jsonOk({ received: true });
  }

  if (event.event === 'refund.failed') {
    await sql.transaction([
      sql`
        WITH failed AS (
          UPDATE public.payment_transactions
          SET status = 'failed', provider_transaction_id = ${refundId}
          WHERE id = ${ledger.id}::uuid AND status = 'pending'
          RETURNING orders_refund_id
        )
        UPDATE public.orders_refunds r
        SET state = 'requested'::refund_state
        FROM failed
        WHERE r.id = failed.orders_refund_id AND r.state = 'approved'::refund_state
      `,
      sql`
        UPDATE public.payment_webhook_events
        SET status = 'processed', processed_at = now()
        WHERE id = ${inbox[0].id}::uuid
      `,
    ]);
    return jsonOk({ received: true });
  }

  if (event.event !== 'refund.processed' || entity?.status !== 'processed') {
    await sql`UPDATE public.payment_webhook_events SET processed_at = now() WHERE id = ${inbox[0].id}::uuid`;
    return jsonOk({ received: true });
  }

  const settled = (await sql`
    WITH transaction_row AS (
      UPDATE public.payment_transactions
      SET status = 'succeeded', provider_transaction_id = ${refundId}, occurred_at = now()
      WHERE id = ${ledger.id}::uuid AND status = 'pending'
      RETURNING orders_refund_id
    ), refund AS (
      UPDATE public.orders_refunds r
      SET state = 'completed'::refund_state, completed_at = now()
      FROM transaction_row t
      WHERE r.id = t.orders_refund_id AND r.state = 'approved'::refund_state
      RETURNING r.sale_id, r.client_id, r.amount_cents
    ), completed_total AS (
      SELECT changed.sale_id, changed.client_id,
             COALESCE((
               SELECT SUM(r.amount_cents)::bigint
               FROM public.orders_refunds r
               WHERE r.sale_id = changed.sale_id AND r.client_id = changed.client_id AND r.state = 'completed'::refund_state
             ), 0::bigint) + changed.amount_cents AS amount_cents
      FROM refund changed
    ), sale AS (
      UPDATE public.sales s
      SET status = 'refunded'::sale_status, refunded_at = now()
      FROM completed_total total
      WHERE s.id = total.sale_id
        AND s.bucket_id = total.client_id
        AND total.amount_cents = s.total_cents
        AND s.status IN ('paid'::sale_status, 'fulfilled'::sale_status)
      RETURNING s.id
    )
    SELECT (SELECT count(*)::int FROM transaction_row) AS transaction_count,
           (SELECT count(*)::int FROM sale) AS sale_refunded
  `) as Array<{ transaction_count: number; sale_refunded: number }>;
  await sql`
    UPDATE public.payment_webhook_events
    SET status = ${settled[0]?.transaction_count ? 'processed' : 'ignored'},
        reason = ${settled[0]?.transaction_count ? null : 'duplicate_refund'},
        processed_at = now()
    WHERE id = ${inbox[0].id}::uuid
  `;
  return jsonOk({ received: true });
}
