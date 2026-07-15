import { z } from 'zod';
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requirePayments } from './_payments-authz';

export const config = { path: '/api/payments/cash-receipts', method: 'POST' };

const CashReceipt = z.object({
  visit_id: z.string().uuid(),
  amount_minor: z.number().int().positive(),
  reference: z.string().trim().max(160).optional(),
});

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const auth = await requirePayments(req, ['payments.customers.create']);
  if (!auth.ok) return auth.res;
  let body: z.infer<typeof CashReceipt>;
  try { body = CashReceipt.parse(await req.json()); } catch { return jsonError(400, 'invalid_body'); }

  const rows = await db()`
    WITH visit AS (
      SELECT id, status, payment_status, price_cents, deposit_paid_cents
      FROM public.booking_visits
      WHERE id = ${body.visit_id}::uuid AND bucket_id = ${auth.ctx.clientId}::uuid
      FOR UPDATE
    ), request AS (
      INSERT INTO public.payment_requests (
        client_id, source_type, source_id, purpose, amount_minor, source_snapshot
      )
      SELECT ${auth.ctx.clientId}::uuid, 'booking_visit', id, 'balance',
             price_cents - deposit_paid_cents,
             jsonb_build_object('price_minor', price_cents, 'paid_minor_at_request', deposit_paid_cents)
      FROM visit
      WHERE price_cents > deposit_paid_cents
      ON CONFLICT (client_id, source_type, source_id, purpose)
      DO UPDATE SET updated_at = public.payment_requests.updated_at
      RETURNING id, amount_minor
    ), balance AS (
      SELECT r.id, r.amount_minor - COALESCE(SUM(a.amount_minor), 0)::bigint AS outstanding_minor
      FROM request r LEFT JOIN public.payment_allocations a ON a.request_id = r.id
      GROUP BY r.id, r.amount_minor
    ), receipt AS (
      INSERT INTO public.payment_transactions (
        client_id, kind, status, amount_minor, currency, reference, actor_user_node
      )
      SELECT ${auth.ctx.clientId}::uuid, 'cash_received', 'succeeded', ${body.amount_minor}, 'INR',
             ${body.reference ?? null}, ${auth.ctx.userNodeId}::uuid
      FROM balance WHERE outstanding_minor >= ${body.amount_minor}
      RETURNING id
    ), allocation AS (
      INSERT INTO public.payment_allocations (client_id, transaction_id, request_id, amount_minor)
      SELECT ${auth.ctx.clientId}::uuid, receipt.id, balance.id, ${body.amount_minor}
      FROM receipt CROSS JOIN balance
      RETURNING id
    ), updated AS (
      UPDATE public.booking_visits v
      SET deposit_paid_cents = v.deposit_paid_cents + ${body.amount_minor},
          payment_status = CASE WHEN v.deposit_paid_cents + ${body.amount_minor} >= v.price_cents THEN 'paid'::booking_payment_status ELSE 'partly_paid'::booking_payment_status END,
          status = CASE WHEN v.status = 'pending' AND v.deposit_paid_cents + ${body.amount_minor} >= v.price_cents THEN 'confirmed'::booking_status ELSE v.status END,
          updated_at = now()
      WHERE v.id = ${body.visit_id}::uuid AND EXISTS (SELECT 1 FROM allocation)
      RETURNING v.id, v.status, v.payment_status, v.deposit_paid_cents
    ), mirror AS (
      UPDATE public.bookings b SET status = updated.status, deposit_paid_cents = updated.deposit_paid_cents, updated_at = now()
      FROM updated WHERE b.visit_id = updated.id
    ), reservation AS (
      UPDATE public.booking_line_reservations r SET status = updated.status
      FROM updated WHERE r.visit_id = updated.id
    )
    INSERT INTO public.booking_events (visit_id, bucket_id, actor_user_node, source, event_type, new_state, reference)
    SELECT id, ${auth.ctx.clientId}::uuid, ${auth.ctx.userNodeId}::uuid, 'payment', 'cash_received',
           jsonb_build_object('appointment_status', status, 'payment_status', payment_status, 'paid_cents', deposit_paid_cents),
           ${body.reference ?? null}
    FROM updated
    RETURNING visit_id, (new_state->>'appointment_status') AS status,
              (new_state->>'payment_status') AS payment_status, (new_state->>'paid_cents')::bigint AS paid_minor
  ` as Array<{ visit_id: string; status: string; payment_status: string; paid_minor: string }>;
  if (!rows[0]) return jsonError(409, 'invalid_cash_receipt');
  return jsonOk({ ...rows[0], paid_minor: Number(rows[0].paid_minor) });
}
