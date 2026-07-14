// GET/POST /api/booking-public/manage/:token — anonymous magic-link manage flow.
// The manage_token alone resolves the booking + its bucket (tenant-agnostic URL).
// GET returns the booking + whether it's still cancellable; POST {action:'cancel'}
// cancels iff now < starts_at - cancel_cutoff_min (customer path; FSM byVendor=false).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { applyTransition, PERM, type BookingStatus } from '../../src/modules/booking/lib/fsm';
import { validateReservation } from './_booking-reservation';
import { rescheduleVisit, setVisitStatus } from './_booking-visits';

export const config = { path: '/api/booking-public/manage/:token', method: ['GET', 'POST'] };

function tokenFrom(req: Request): string {
  return new URL(req.url).pathname.split('/').pop() ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  const token = tokenFrom(req);
  const sql = db();
  const rows = (await sql`
    SELECT b.id, b.visit_id, b.bucket_id, b.status, b.service_id, b.resource_id,
           lower(b.time_range) AS start_at, upper(b.time_range) AS end_at,
           b.customer_name, b.price_cents,
           COALESCE((v.policy_snapshot->>'cancel_cutoff_min')::integer, s.cancel_cutoff_min, 0) AS cancel_cutoff_min,
           COALESCE((v.policy_snapshot->>'reschedule_cutoff_min')::integer, s.cancel_cutoff_min, 0) AS reschedule_cutoff_min,
           COALESCE((v.policy_snapshot->>'max_customer_reschedules')::integer, 3) AS max_customer_reschedules,
           COALESCE(v.reschedule_count, 0) AS reschedule_count,
           svc.name AS service_name, svc.duration_min, cl.slug
    FROM public.bookings b
    LEFT JOIN public.booking_visits v ON v.id = b.visit_id
    LEFT JOIN public.booking_settings s ON s.bucket_id = b.bucket_id
    LEFT JOIN public.booking_services svc ON svc.id = b.service_id
    LEFT JOIN public.clients cl ON cl.id = b.bucket_id
    WHERE b.manage_token = ${token} LIMIT 1
  `) as any[];
  if (!rows[0]) return jsonError(404, 'booking_not_found');
  const b = rows[0];
  const startAt = new Date(b.start_at);
  const cancellableCutoff = new Date(startAt.getTime() - Number(b.cancel_cutoff_min) * 60_000);
  const rescheduleCutoff = new Date(startAt.getTime() - Number(b.reschedule_cutoff_min) * 60_000);
  const active = b.status === 'pending' || b.status === 'confirmed';
  const cancellable = active && new Date() < cancellableCutoff;
  const reschedulable =
    active &&
    new Date() < rescheduleCutoff &&
    Number(b.reschedule_count) < Number(b.max_customer_reschedules);

  if (req.method === 'GET') {
    const services = b.visit_id
      ? ((await sql`
          SELECT s.id, s.name, l.duration_min, l.price_cents,
                 s.payment_mode::text AS payment_mode, s.deposit_cents
          FROM public.booking_appointment_lines l
          JOIN public.booking_services s ON s.id = l.service_id
          WHERE l.visit_id = ${b.visit_id}::uuid
          ORDER BY l.sequence_number
        `) as any[])
      : [
          {
            id: b.service_id,
            name: b.service_name,
            duration_min: b.duration_min,
            price_cents: b.price_cents,
            payment_mode: 'pay_at_venue',
            deposit_cents: null,
          },
        ];
    return jsonOk({
      id: b.id,
      status: b.status,
      start_at: b.start_at,
      end_at: b.end_at,
      customer_name: b.customer_name,
      price_cents: b.price_cents,
      cancellable,
      reschedulable,
      service_id: b.service_id,
      service_name: b.service_name,
      duration_min: b.duration_min,
      slug: b.slug,
      services,
      reschedule_count: Number(b.reschedule_count),
      policy: {
        cancel_cutoff_min: Number(b.cancel_cutoff_min),
        reschedule_cutoff_min: Number(b.reschedule_cutoff_min),
        max_customer_reschedules: Number(b.max_customer_reschedules),
      },
    });
  }
  if (req.method === 'POST') {
    let body: { action?: string; start?: string };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_body');
    }

    if (body.action === 'reschedule') {
      if (Number(b.reschedule_count) >= Number(b.max_customer_reschedules))
        return jsonError(409, 'reschedule_limit_reached');
      if (!active || new Date() >= rescheduleCutoff)
        return jsonError(409, 'too_late_to_reschedule');
      if (!body.start) return jsonError(400, 'start_required');
      const result = b.visit_id
        ? await rescheduleVisit({
            visitId: b.visit_id,
            clientId: b.bucket_id,
            resourceId: b.resource_id,
            start: body.start,
            incrementCustomerRescheduleCount: true,
            eventSource: 'customer',
          })
        : await validateReservation({
            clientId: b.bucket_id,
            serviceId: b.service_id,
            resourceId: b.resource_id,
            start: body.start,
            excludeBookingId: b.id,
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
      if (b.visit_id) {
        return jsonOk({
          id: b.id,
          status: b.status,
          start_at: result.startIso,
          end_at: result.endIso,
        });
      }
      try {
        const moved = (await sql`UPDATE public.bookings
          SET time_range = tstzrange(${result.startIso}::timestamptz, ${result.endIso}::timestamptz), updated_at = now()
          WHERE id = ${b.id}::uuid RETURNING id, lower(time_range) AS start_at, upper(time_range) AS end_at`) as any[];
        return jsonOk({
          id: moved[0].id,
          status: b.status,
          start_at: moved[0].start_at,
          end_at: moved[0].end_at,
        });
      } catch (err: any) {
        if ((err?.code ?? err?.cause?.code) === '23P01') return jsonError(409, 'slot_taken');
        throw err;
      }
    }

    if (body.action !== 'cancel') return jsonError(400, 'invalid_action');

    // Token possession authorizes the customer's own cancel.
    const t = applyTransition({
      from: b.status as BookingStatus,
      action: 'cancel',
      perms: new Set([PERM.cancel]),
      now: new Date(),
      startsAt: startAt,
      cancelCutoffMin: Number(b.cancel_cutoff_min),
      byVendor: false,
    });
    if (!t.ok) {
      const code =
        t.code === 'too_late_to_cancel' ? 409 : t.code === 'illegal_transition' ? 409 : 403;
      return jsonError(code, t.code);
    }
    if (b.visit_id) {
      await setVisitStatus({
        visitId: b.visit_id,
        clientId: b.bucket_id,
        status: 'cancelled',
        reason: 'customer',
        eventSource: 'customer',
      });
    } else {
      await sql`UPDATE public.bookings SET status = 'cancelled'::booking_status,
                cancelled_at = now(), cancellation_reason = 'customer', updated_at = now()
                WHERE id = ${b.id}::uuid`;
    }
    return jsonOk({ id: b.id, status: 'cancelled' });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
