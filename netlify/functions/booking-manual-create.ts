// POST /api/booking/manual-create — vendor creates a booking on behalf of a customer,
// or a blocked staff-time window. Bypasses lead-time + cutoff; off-grid starts allowed
// (gist still guards). 23P01 → 409 slot_taken.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { ManualCreateBody } from './_booking-validators';
import { upsertCustomer } from './_booking-customer-upsert';

export const config = { path: '/api/booking/manual-create', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireBooking(req, ['booking.customers.create']);
  if (!a.ok) return a.res;

  let body: ManualCreateBody;
  try { body = ManualCreateBody.parse(await req.json()); }
  catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }

  const sql = db();
  // Resource must belong to this tenant.
  const r = (await sql`SELECT id FROM public.booking_resources
    WHERE id = ${body.resource_id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid AND active = true LIMIT 1`) as any[];
  if (!r[0]) return jsonError(404, 'resource_not_found');

  const start = new Date(body.start);
  if (Number.isNaN(start.getTime())) return jsonError(400, 'invalid_start');

  try {
    if (body.blocked) {
      if (!body.end) return jsonError(400, 'end_required_for_blocked');
      const end = new Date(body.end);
      if (Number.isNaN(end.getTime()) || end <= start) return jsonError(400, 'invalid_range');
      const rows = (await sql`
        INSERT INTO public.bookings (bucket_id, resource_id, time_range, status, created_by_user_node)
        VALUES (${a.ctx.clientId}::uuid, ${body.resource_id}::uuid,
                tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz),
                'blocked', ${a.ctx.userNodeId}::uuid)
        RETURNING id, status`) as any[];
      return jsonOk(rows[0], { status: 201 });
    }

    // Normal vendor booking.
    if (!body.service_id || !body.customer) return jsonError(400, 'service_and_customer_required');
    const svc = (await sql`SELECT id, duration_min, price_cents FROM public.booking_services
      WHERE id = ${body.service_id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid AND active = true LIMIT 1`) as any[];
    if (!svc[0]) return jsonError(404, 'service_not_found');
    const endIso = new Date(start.getTime() + svc[0].duration_min * 60_000).toISOString();
    const { userNodeId } = await upsertCustomer(sql, a.ctx.clientId, body.customer);
    const rows = (await sql`
      INSERT INTO public.bookings
        (bucket_id, service_id, resource_id, user_node_id, time_range, status,
         customer_name, customer_phone, customer_email, price_cents, deposit_paid_cents, created_by_user_node)
      VALUES (${a.ctx.clientId}::uuid, ${svc[0].id}::uuid, ${body.resource_id}::uuid, ${userNodeId}::uuid,
              tstzrange(${start.toISOString()}::timestamptz, ${endIso}::timestamptz), 'confirmed',
              ${body.customer.name}, ${body.customer.phone}, ${body.customer.email ?? null},
              ${svc[0].price_cents}, ${body.mark_paid ? svc[0].price_cents : 0}, ${a.ctx.userNodeId}::uuid)
      RETURNING id, status`) as any[];
    return jsonOk(rows[0], { status: 201 });
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    if (code === '23P01') return jsonError(409, 'slot_taken');
    throw err;
  }
}
