// POST /api/booking-public/:slug/create — anonymous guest booking.
// Match-or-create customer → resolve resource (named or least-busy) → single INSERT
// guarded by the gist EXCLUDE constraint (23P01 → 409). pay_at_venue confirms instantly;
// deposit/full_upfront return a payment_intent stub (Razorpay wired in Phase 3).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { PublicCreateBody } from './_booking-validators';
import { upsertCustomer } from './_booking-customer-upsert';
import { pickLeastBusy } from '../../src/modules/booking/lib/autoassign';
import { randomUUID } from 'node:crypto';

export const config = { path: '/api/booking-public/:slug/create', method: 'POST' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/');
  return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: PublicCreateBody;
  try { body = PublicCreateBody.parse(await req.json()); }
  catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }

  const sql = db();
  const c = (await sql`SELECT id FROM public.clients WHERE slug = ${slugFrom(req)} LIMIT 1`) as Array<{ id: string }>;
  if (!c[0]) return jsonError(404, 'tenant_not_found');
  const clientId = c[0].id;

  const svc = (await sql`SELECT id, duration_min, buffer_min, price_cents, payment_mode, deposit_cents, eligible_resource_ids
    FROM public.booking_services WHERE id = ${body.service_id}::uuid AND bucket_id = ${clientId}::uuid AND active = true LIMIT 1`) as any[];
  if (!svc[0]) return jsonError(404, 'service_not_found');

  const start = new Date(body.start);
  if (Number.isNaN(start.getTime())) return jsonError(400, 'invalid_start');
  const startIso = start.toISOString();
  const endIso = new Date(start.getTime() + svc[0].duration_min * 60_000).toISOString();

  const st = (await sql`SELECT lead_time_min FROM public.booking_settings WHERE bucket_id = ${clientId}::uuid LIMIT 1`) as any[];
  const leadMin = st[0]?.lead_time_min ?? 0;
  if (start.getTime() < Date.now() + leadMin * 60_000) return jsonError(409, 'too_soon');

  let resourceId: string;
  if (body.resource_id !== 'any') {
    const r = (await sql`SELECT id FROM public.booking_resources
      WHERE id = ${body.resource_id}::uuid AND bucket_id = ${clientId}::uuid AND active = true LIMIT 1`) as Array<{ id: string }>;
    if (!r[0]) return jsonError(404, 'resource_not_found');
    resourceId = r[0].id;
  } else {
    const eligible: string[] = svc[0].eligible_resource_ids ?? [];
    const footprint = svc[0].duration_min + svc[0].buffer_min;
    const free = (await sql`
      SELECT br.id,
        (SELECT COUNT(*) FROM public.bookings b WHERE b.resource_id = br.id AND b.status IN ('pending','confirmed')
           AND b.time_range && tstzrange((${startIso}::timestamptz - interval '1 day'), (${startIso}::timestamptz + interval '1 day'))) AS cnt
      FROM public.booking_resources br
      WHERE br.bucket_id = ${clientId}::uuid AND br.active = true
        AND (cardinality(${eligible}::uuid[]) = 0 OR br.id = ANY(${eligible}::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.resource_id = br.id
          AND b.status IN ('pending','confirmed','blocked')
          AND b.time_range && tstzrange(${startIso}::timestamptz, (${startIso}::timestamptz + make_interval(mins => ${footprint}))))
    `) as Array<{ id: string; cnt: number }>;
    const pick = pickLeastBusy(free.map((f) => ({ id: f.id, bookingsToday: Number(f.cnt) })));
    if (!pick) return jsonError(409, 'no_resource_available');
    resourceId = pick;
  }

  const { userNodeId } = await upsertCustomer(sql, clientId, body.customer);

  const isPayAtVenue = svc[0].payment_mode === 'pay_at_venue';
  const status = isPayAtVenue ? 'confirmed' : 'pending';
  const manageToken = randomUUID();

  try {
    const rows = (await sql`
      INSERT INTO public.bookings
        (bucket_id, service_id, resource_id, user_node_id, time_range, status,
         customer_name, customer_phone, customer_email, price_cents, manage_token)
      VALUES (${clientId}::uuid, ${svc[0].id}::uuid, ${resourceId}::uuid, ${userNodeId}::uuid,
              tstzrange(${startIso}::timestamptz, ${endIso}::timestamptz), ${status}::booking_status,
              ${body.customer.name}, ${body.customer.phone}, ${body.customer.email ?? null},
              ${svc[0].price_cents}, ${manageToken})
      RETURNING id, status
    `) as Array<{ id: string; status: string }>;
    const booking = rows[0]!;
    const payment_intent = isPayAtVenue ? undefined : {
      provider: 'razorpay',
      amount_cents: svc[0].payment_mode === 'deposit' ? svc[0].deposit_cents : svc[0].price_cents,
      status: 'stub',
    };
    return jsonOk({ booking_id: booking.id, status: booking.status, manage_token: manageToken, payment_intent }, { status: 201 });
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    if (code === '23P01') return jsonError(409, 'slot_taken');
    throw err;
  }
}
