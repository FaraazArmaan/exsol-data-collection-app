// POST /api/booking/manual-create — vendor creates a booking on behalf of a customer,
// or a blocked staff-time window. Bypasses lead-time + cutoff; off-grid starts allowed
// (gist still guards). 23P01 → 409 slot_taken.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { ManualCreateBody } from './_booking-validators';
import { upsertCustomer } from './_booking-customer-upsert';
import { sendMail } from './_shared/mailer';
import { createVisit, validateSequentialVisit } from './_booking-visits';

export const config = { path: '/api/booking/manual-create', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireBooking(req, ['booking.customers.create']);
  if (!a.ok) return a.res;

  let body: ManualCreateBody;
  try {
    body = ManualCreateBody.parse(await req.json());
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }

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
    const plan = await validateSequentialVisit({
      clientId: a.ctx.clientId,
      serviceIds: [body.service_id],
      resourceId: body.resource_id,
      start: body.start,
      allowAvailabilityOverride: true,
    });
    if (!plan.ok) {
      const status =
        plan.code === 'invalid_start'
          ? 400
          : plan.code === 'service_not_found' || plan.code === 'resource_not_found'
            ? 404
            : 409;
      return jsonError(status, plan.code);
    }
    const { userNodeId } = await upsertCustomer(sql, a.ctx.clientId, body.customer);
    const visit = await createVisit({
      clientId: a.ctx.clientId,
      userNodeId,
      customer: body.customer,
      plan,
      status: 'confirmed',
      paymentStatus: body.mark_paid ? 'paid' : 'cash_pending',
      createdByUserNodeId: a.ctx.userNodeId,
      depositPaidCents: body.mark_paid ? plan.priceCents : 0,
      eventSource: 'vendor',
    });
    // Vendor-created bookings are always confirmed → send the confirmation + .ics.
    // No manage_token on this path; the booking id seeds the calendar UID.
    await sendMail({
      clientId: a.ctx.clientId,
      to: body.customer.email,
      template: 'booking_confirmation',
      data: {
        customerName: body.customer.name,
        serviceName: plan.lines[0]!.service.name,
        startIso: plan.startIso,
        endIso: plan.endIso,
        priceCents: plan.priceCents,
        uid: `${visit.bookingId}@exsol`,
      },
    });
    return jsonOk(
      { id: visit.bookingId, visit_id: visit.visitId, status: 'confirmed' },
      { status: 201 },
    );
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    if (code === '23P01') return jsonError(409, 'slot_taken');
    throw err;
  }
}
