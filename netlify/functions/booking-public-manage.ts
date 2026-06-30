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
           COALESCE(s.cancel_cutoff_min, 0) AS cancel_cutoff_min
    FROM public.bookings b
    LEFT JOIN public.booking_settings s ON s.bucket_id = b.bucket_id
    WHERE b.manage_token = ${token} LIMIT 1
  `) as any[];
  if (!rows[0]) return jsonError(404, 'booking_not_found');
  const b = rows[0];
  const startAt = new Date(b.start_at);
  const cutoff = new Date(startAt.getTime() - Number(b.cancel_cutoff_min) * 60_000);
  const cancellable = (b.status === 'pending' || b.status === 'confirmed') && new Date() < cutoff;

  if (req.method === 'GET') {
    return jsonOk({
      id: b.id, status: b.status, start_at: b.start_at, end_at: b.end_at,
      customer_name: b.customer_name, price_cents: b.price_cents, cancellable,
    });
  }
  if (req.method === 'POST') {
    let body: { action?: string };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
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
