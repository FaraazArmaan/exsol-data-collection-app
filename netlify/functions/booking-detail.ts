// GET/PATCH /api/booking/detail/:id — vendor read + state transitions.
// PATCH runs the Phase-1 FSM (byVendor: true → cutoff bypassed). complete/noShow
// guard on slot END (now > start+duration); cancel guards on slot start. unblock
// hard-deletes a blocked row (per spec). Bucket-scoped → cross-tenant id is 404.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { applyTransition, type BookingAction, type BookingStatus } from '../../src/modules/booking/lib/fsm';

export const config = { path: '/api/booking/detail/:id', method: ['GET', 'PATCH'] };

function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }
const FSM_HTTP: Record<string, number> = { missing_perm: 403, illegal_transition: 409, too_early: 409, too_late_to_cancel: 409 };

export default async function handler(req: Request): Promise<Response> {
  const read = req.method === 'GET';
  const a = await requireBooking(req, [read ? 'booking.customers.view' : 'booking.customers.edit']);
  if (!a.ok) return a.res;
  const sql = db();
  const id = idFrom(req);

  const rows = (await sql`
    SELECT id, service_id, resource_id, user_node_id, lower(time_range) AS start_at, upper(time_range) AS end_at,
           status, customer_name, customer_phone, customer_email, price_cents, cancellation_reason, cancelled_at
    FROM public.bookings WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  const booking = rows[0];

  if (req.method === 'GET') return jsonOk(booking);

  // PATCH
  let body: { action?: string; reason?: string; start?: string; resource_id?: string };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }

  // Reschedule: move the booking to a new start (and optionally resource). Off-grid
  // allowed (vendor); the gist constraint still guards → 23P01 → 409 slot_taken.
  if (body.action === 'reschedule') {
    if (!['pending', 'confirmed'].includes(booking.status)) return jsonError(409, 'illegal_transition');
    if (!body.start) return jsonError(400, 'start_required');
    const start = new Date(body.start);
    if (Number.isNaN(start.getTime())) return jsonError(400, 'invalid_start');
    const svc = (await sql`SELECT duration_min FROM public.booking_services WHERE id = ${booking.service_id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid LIMIT 1`) as any[];
    if (!svc[0]) return jsonError(404, 'service_not_found');
    const endIso = new Date(start.getTime() + svc[0].duration_min * 60_000).toISOString();
    const resourceId = body.resource_id ?? booking.resource_id;
    try {
      const moved = (await sql`
        UPDATE public.bookings
           SET time_range = tstzrange(${start.toISOString()}::timestamptz, ${endIso}::timestamptz),
               resource_id = ${resourceId}::uuid, updated_at = now()
         WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
         RETURNING id, lower(time_range) AS start_at, upper(time_range) AS end_at, status, resource_id
      `) as any[];
      return jsonOk(moved[0]);
    } catch (err: any) {
      if ((err?.code ?? err?.cause?.code) === '23P01') return jsonError(409, 'slot_taken');
      throw err;
    }
  }

  const action = body.action as BookingAction;
  if (!['cancel', 'complete', 'noShow', 'unblock', 'pay'].includes(action)) return jsonError(400, 'invalid_action');

  const isEnd = action === 'complete' || action === 'noShow';
  const t = applyTransition({
    from: booking.status as BookingStatus,
    action,
    perms: a.ctx.perms,
    now: new Date(),
    startsAt: new Date(isEnd ? booking.end_at : booking.start_at),
    cancelCutoffMin: 0,   // vendor bypasses cutoff
    byVendor: true,
  });
  if (!t.ok) return jsonError(FSM_HTTP[t.code] ?? 409, t.code);

  if (action === 'unblock') {
    await sql`DELETE FROM public.bookings WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid`;
    return jsonOk({ id, deleted: true });
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
