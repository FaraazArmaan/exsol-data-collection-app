// GET/POST /api/booking-public/manage/:token — anonymous magic-link manage flow.
// The manage_token alone resolves the booking + its bucket (tenant-agnostic URL).
// GET returns the booking + whether it's still cancellable; POST {action:'cancel'}
// cancels iff now < starts_at - cancel_cutoff_min (customer path; FSM byVendor=false).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { applyTransition, PERM, type BookingStatus } from '../../src/modules/booking/lib/fsm';

export const config = { path: '/api/booking-public/manage/:token', method: ['GET', 'POST'] };

function tokenFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

export default async function handler(req: Request): Promise<Response> {
  const token = tokenFrom(req);
  const sql = db();
  const rows = (await sql`
    SELECT b.id, b.bucket_id, b.status, b.service_id, b.resource_id,
           lower(b.time_range) AS start_at, upper(b.time_range) AS end_at,
           b.customer_name, b.price_cents,
           COALESCE(s.cancel_cutoff_min, 0) AS cancel_cutoff_min,
           svc.name AS service_name, svc.duration_min, cl.slug
    FROM public.bookings b
    LEFT JOIN public.booking_settings s ON s.bucket_id = b.bucket_id
    LEFT JOIN public.booking_services svc ON svc.id = b.service_id
    LEFT JOIN public.clients cl ON cl.id = b.bucket_id
    WHERE b.manage_token = ${token} LIMIT 1
  `) as any[];
  if (!rows[0]) return jsonError(404, 'booking_not_found');
  const b = rows[0];
  const startAt = new Date(b.start_at);
  const cutoff = new Date(startAt.getTime() - Number(b.cancel_cutoff_min) * 60_000);
  const changeable = (b.status === 'pending' || b.status === 'confirmed') && new Date() < cutoff;

  if (req.method === 'GET') {
    return jsonOk({
      id: b.id, status: b.status, start_at: b.start_at, end_at: b.end_at,
      customer_name: b.customer_name, price_cents: b.price_cents, cancellable: changeable,
      reschedulable: changeable, service_id: b.service_id, service_name: b.service_name,
      duration_min: b.duration_min, slug: b.slug,
    });
  }
  if (req.method === 'POST') {
    let body: { action?: string; start?: string };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }

    if (body.action === 'reschedule') {
      if (!changeable) return jsonError(409, 'too_late_to_cancel');
      if (!body.start) return jsonError(400, 'start_required');
      const start = new Date(body.start);
      if (Number.isNaN(start.getTime()) || !b.duration_min) return jsonError(400, 'invalid_start');
      const endIso = new Date(start.getTime() + Number(b.duration_min) * 60_000).toISOString();
      try {
        const moved = (await sql`UPDATE public.bookings
          SET time_range = tstzrange(${start.toISOString()}::timestamptz, ${endIso}::timestamptz), updated_at = now()
          WHERE id = ${b.id}::uuid RETURNING id, lower(time_range) AS start_at, upper(time_range) AS end_at`) as any[];
        return jsonOk({ id: moved[0].id, status: b.status, start_at: moved[0].start_at, end_at: moved[0].end_at });
      } catch (err: any) {
        if ((err?.code ?? err?.cause?.code) === '23P01') return jsonError(409, 'slot_taken');
        throw err;
      }
    }

    if (body.action !== 'cancel') return jsonError(400, 'invalid_action');

    // Token possession authorizes the customer's own cancel.
    const t = applyTransition({
      from: b.status as BookingStatus, action: 'cancel',
      perms: new Set([PERM.cancel]), now: new Date(),
      startsAt: startAt, cancelCutoffMin: Number(b.cancel_cutoff_min), byVendor: false,
    });
    if (!t.ok) {
      const code = t.code === 'too_late_to_cancel' ? 409 : t.code === 'illegal_transition' ? 409 : 403;
      return jsonError(code, t.code);
    }
    await sql`UPDATE public.bookings SET status = 'cancelled'::booking_status,
              cancelled_at = now(), cancellation_reason = 'customer', updated_at = now()
              WHERE id = ${b.id}::uuid`;
    return jsonOk({ id: b.id, status: 'cancelled' });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
