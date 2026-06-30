// GET /api/booking/list?from=&to=&status=&resource_id= — vendor calendar/list view.
// Bucket-scoped; date window defaults to today..today+30; status CSV + resource filters.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';

export const config = { path: '/api/booking/list', method: 'GET' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireBooking(req, ['booking.customers.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? today;
  const to = url.searchParams.get('to') ?? today;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return jsonError(400, 'invalid_query');
  const statusArr = (url.searchParams.get('status') ?? '').split(',').filter(Boolean);
  const resourceId = url.searchParams.get('resource_id');

  const sql = db();
  const rows = (await sql`
    SELECT id, service_id, resource_id, user_node_id,
           lower(time_range) AS start_at, upper(time_range) AS end_at,
           status, customer_name, customer_phone, customer_email, price_cents
    FROM public.bookings
    WHERE bucket_id = ${a.ctx.clientId}::uuid
      AND time_range && tstzrange(${from}::date::timestamptz, (${to}::date + 1)::timestamptz)
      AND (cardinality(${statusArr}::text[]) = 0 OR status::text = ANY(${statusArr}::text[]))
      AND (${resourceId === null}::boolean OR resource_id = ${resourceId ?? a.ctx.clientId}::uuid)
    ORDER BY lower(time_range)
  `) as any[];
  return jsonOk({ bookings: rows });
}
