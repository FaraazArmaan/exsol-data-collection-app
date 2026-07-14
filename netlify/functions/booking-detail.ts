// GET/PATCH /api/booking/detail/:id — vendor read + state transitions.
// PATCH runs the Phase-1 FSM (byVendor: true → cutoff bypassed). complete/noShow
// guard on slot END (now > start+duration); cancel guards on slot start. unblock
// hard-deletes a blocked row (per spec). Bucket-scoped → cross-tenant id is 404.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import {
  applyTransition,
  type BookingAction,
  type BookingStatus,
} from '../../src/modules/booking/lib/fsm';
import { validateReservation } from './_booking-reservation';
import {
  checkInVisit,
  recordVisitCashPayment,
  rescheduleVisit,
  setVisitStatus,
} from './_booking-visits';

export const config = { path: '/api/booking/detail/:id', method: ['GET', 'PATCH'] };

function idFrom(req: Request): string {
  return new URL(req.url).pathname.split('/').pop() ?? '';
}
const FSM_HTTP: Record<string, number> = {
  missing_perm: 403,
  illegal_transition: 409,
  too_early: 409,
  too_late_to_cancel: 409,
};

export default async function handler(req: Request): Promise<Response> {
  const read = req.method === 'GET';
  const a = await requireBooking(req, [read ? 'booking.customers.view' : 'booking.customers.edit']);
  if (!a.ok) return a.res;
  const sql = db();
  const id = idFrom(req);

  const rows = (await sql`
    SELECT b.id, b.visit_id, b.service_id, b.resource_id, b.user_node_id,
           lower(b.time_range) AS start_at, upper(b.time_range) AS end_at, b.status,
           b.customer_name, b.customer_phone, b.customer_email, b.price_cents,
           b.cancellation_reason, b.cancelled_at, v.payment_status, v.deposit_paid_cents
    FROM public.bookings b
    LEFT JOIN public.booking_visits v ON v.id = b.visit_id
    WHERE b.id = ${id}::uuid AND b.bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  const booking = rows[0];

  if (req.method === 'GET') {
    const events = booking.visit_id
      ? await sql`
          SELECT id, source, event_type, previous_state, new_state, reason, reference, created_at
          FROM public.booking_events
          WHERE visit_id = ${booking.visit_id}::uuid
          ORDER BY created_at DESC
        `
      : [];
    return jsonOk({ ...booking, events });
  }

  // PATCH
  let body: {
    action?: string;
    reason?: string;
    start?: string;
    resource_id?: string;
    amount_cents?: number;
    reference?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }

  // Staff can explicitly override availability, but never service eligibility or live conflicts.
  if (body.action === 'reschedule') {
    if (!['pending', 'confirmed'].includes(booking.status))
      return jsonError(409, 'illegal_transition');
    if (!body.start) return jsonError(400, 'start_required');
    const result = booking.visit_id
      ? await rescheduleVisit({
          visitId: booking.visit_id,
          clientId: a.ctx.clientId,
          resourceId: body.resource_id ?? booking.resource_id,
          start: body.start,
          allowAvailabilityOverride: true,
          eventSource: 'vendor',
          actorUserNodeId: a.ctx.userNodeId,
        })
      : await validateReservation({
          clientId: a.ctx.clientId,
          serviceId: booking.service_id,
          resourceId: body.resource_id ?? booking.resource_id,
          start: body.start,
          excludeBookingId: booking.id,
          allowAvailabilityOverride: true,
        });
    if (!result.ok) {
      const status =
        result.code === 'invalid_start'
          ? 400
          : result.code === 'service_not_found' || result.code === 'resource_not_found'
            ? 404
            : 409;
      return jsonError(status, result.code);
    }
    if (booking.visit_id) {
      return jsonOk({
        id,
        start_at: result.startIso,
        end_at: result.endIso,
        status: booking.status,
        resource_id: body.resource_id ?? booking.resource_id,
      });
    }
    try {
      const moved = (await sql`
        UPDATE public.bookings
           SET time_range = tstzrange(${result.startIso}::timestamptz, ${result.endIso}::timestamptz),
               resource_id = ${body.resource_id ?? booking.resource_id}::uuid, updated_at = now()
         WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
         RETURNING id, lower(time_range) AS start_at, upper(time_range) AS end_at, status, resource_id
      `) as any[];
      return jsonOk(moved[0]);
    } catch (err: any) {
      if ((err?.code ?? err?.cause?.code) === '23P01') return jsonError(409, 'slot_taken');
      throw err;
    }
  }

  if (body.action === 'record_cash_payment') {
    if (!booking.visit_id) return jsonError(409, 'visit_required');
    const payment = await recordVisitCashPayment({
      visitId: booking.visit_id,
      clientId: a.ctx.clientId,
      actorUserNodeId: a.ctx.userNodeId,
      amountCents: body.amount_cents,
      reference: body.reference ?? null,
    });
    if (!payment) return jsonError(409, 'invalid_cash_payment');
    return jsonOk({ id, status: payment.status, payment_status: payment.paymentStatus });
  }
  if (body.action === 'check_in') {
    if (!booking.visit_id) return jsonError(409, 'visit_required');
    if (
      !(await checkInVisit({
        visitId: booking.visit_id,
        clientId: a.ctx.clientId,
        actorUserNodeId: a.ctx.userNodeId,
      }))
    )
      return jsonError(409, 'check_in_not_allowed');
    return jsonOk({ id, status: booking.status, checked_in: true });
  }
  const action = body.action as BookingAction;
  if (!['cancel', 'complete', 'noShow', 'unblock', 'pay'].includes(action))
    return jsonError(400, 'invalid_action');

  const isEnd = action === 'complete' || action === 'noShow';
  const t = applyTransition({
    from: booking.status as BookingStatus,
    action,
    perms: a.ctx.perms,
    now: new Date(),
    startsAt: new Date(isEnd ? booking.end_at : booking.start_at),
    cancelCutoffMin: 0, // vendor bypasses cutoff
    byVendor: true,
  });
  if (!t.ok) return jsonError(FSM_HTTP[t.code] ?? 409, t.code);

  if (action === 'unblock') {
    await sql`DELETE FROM public.bookings WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid`;
    return jsonOk({ id, deleted: true });
  }
  if (booking.visit_id && ['cancelled', 'completed', 'no_show'].includes(t.to)) {
    await setVisitStatus({
      visitId: booking.visit_id,
      clientId: a.ctx.clientId,
      status: t.to as 'cancelled' | 'completed' | 'no_show',
      reason: action === 'cancel' ? (body.reason ?? null) : null,
      eventSource: 'vendor',
      actorUserNodeId: a.ctx.userNodeId,
    });
    return jsonOk({ id, status: t.to });
  }
  if (booking.visit_id && action === 'pay') {
    const payment = await recordVisitCashPayment({
      visitId: booking.visit_id,
      clientId: a.ctx.clientId,
      actorUserNodeId: a.ctx.userNodeId,
      amountCents: body.amount_cents,
      reference: body.reference ?? null,
    });
    if (!payment) return jsonError(409, 'invalid_cash_payment');
    return jsonOk({ id, status: payment.status, payment_status: payment.paymentStatus });
  }
  const updated = (await sql`
    UPDATE public.bookings SET
      status = ${t.to}::booking_status,
      cancelled_at = ${action === 'cancel' ? new Date().toISOString() : null}::timestamptz,
      cancellation_reason = ${action === 'cancel' ? (body.reason ?? null) : null},
      updated_at = now()
    WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
    RETURNING id, status, cancelled_at, cancellation_reason
  `) as any[];
  return jsonOk(updated[0]);
}
