// POST /api/booking-public/:slug/create — anonymous guest booking.
// Match-or-create customer → resolve resource (named or least-busy) → single INSERT
// guarded by the gist EXCLUDE constraint (23P01 → 409). pay_at_venue confirms instantly;
// deposit/full_upfront return a payment_intent stub (Razorpay wired in Phase 3).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { extractIp } from './_shared/rate-limit';
import { allowBookingCreate } from './_booking-ratelimit';
import { PublicCreateBody } from './_booking-validators';
import { upsertCustomer } from './_booking-customer-upsert';
import { createVisit, validateSequentialVisit } from './_booking-visits';
import { sendMail } from './_shared/mailer';
import { randomUUID } from 'node:crypto';

export const config = { path: '/api/booking-public/:slug/create', method: 'POST' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/');
  return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: PublicCreateBody;
  try {
    body = PublicCreateBody.parse(await req.json());
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }

  // Anti-abuse: honeypot (real users never fill `hp`) + best-effort IP rate-limit.
  if (body.hp && body.hp.trim() !== '') return jsonError(400, 'invalid_request');
  if (!(await allowBookingCreate(extractIp(req)))) return jsonError(429, 'rate_limited');

  const sql = db();
  const c =
    (await sql`SELECT id FROM public.clients WHERE slug = ${slugFrom(req)} LIMIT 1`) as Array<{
      id: string;
    }>;
  if (!c[0]) return jsonError(404, 'tenant_not_found');
  const clientId = c[0].id;
  const serviceIds = body.service_ids ?? [body.service_id!];
  const plan = await validateSequentialVisit({
    clientId,
    serviceIds,
    resourceId: body.resource_id,
    start: body.start,
  });
  if (!plan.ok) {
    const status =
      plan.code === 'invalid_start' || plan.code === 'invalid_services'
        ? 400
        : plan.code === 'service_not_found' || plan.code === 'resource_not_found'
          ? 404
          : 409;
    const code =
      (plan.code === 'slot_unavailable' || plan.code === 'slot_taken') && body.resource_id === 'any'
        ? 'no_resource_available'
        : plan.code;
    return jsonError(status, code);
  }

  const { userNodeId } = await upsertCustomer(sql, clientId, body.customer);

  const firstService = plan.lines[0]!.service;
  const isPayAtVenue = plan.lines.every((line) => line.service.payment_mode === 'pay_at_venue');
  const status = isPayAtVenue ? 'confirmed' : 'pending';
  const manageToken = randomUUID();

  try {
    const visit = await createVisit({
      clientId,
      userNodeId,
      customer: body.customer,
      plan,
      status,
      paymentStatus: isPayAtVenue ? 'cash_pending' : 'payment_requested',
      manageToken,
      eventSource: 'public',
    });
    // Confirmation email (+ .ics) only when the booking is actually confirmed now.
    // deposit/full_upfront stay 'pending' until the payment webhook (v1.1).
    if (isPayAtVenue) {
      await sendMail({
        clientId,
        to: body.customer.email,
        template: 'booking_confirmation',
        data: {
          customerName: body.customer.name,
          serviceName: plan.lines.map((line) => line.service.name).join(', '),
          startIso: plan.startIso,
          endIso: plan.endIso,
          priceCents: plan.priceCents,
          uid: `${manageToken}@exsol`,
        },
      });
    }
    const payment_intent = isPayAtVenue
      ? undefined
      : {
          provider: 'razorpay',
          amount_cents:
            firstService.payment_mode === 'deposit' ? firstService.deposit_cents : plan.priceCents,
          status: 'stub',
        };
    return jsonOk(
      {
        booking_id: visit.bookingId,
        visit_id: visit.visitId,
        status,
        manage_token: manageToken,
        payment_intent,
      },
      { status: 201 },
    );
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    if (code === '23P01') return jsonError(409, 'slot_taken');
    throw err;
  }
}
