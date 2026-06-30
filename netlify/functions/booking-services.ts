// GET/POST /api/booking/services — list active + create.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { ServiceCreate } from './_booking-validators';

export const config = { path: '/api/booking/services', method: ['GET', 'POST'] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireBooking(req, ['booking.employees.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT id, name, duration_min, price_cents, payment_mode, deposit_cents, buffer_min, active, eligible_resource_ids
      FROM public.booking_services WHERE bucket_id = ${a.ctx.clientId}::uuid AND active = true ORDER BY name
    `) as any[];
    return jsonOk({ services: rows });
  }
  if (req.method === 'POST') {
    const a = await requireBooking(req, ['booking.employees.edit']);
    if (!a.ok) return a.res;
    let body: ServiceCreate;
    try { body = ServiceCreate.parse(await req.json()); }
    catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }
    const sql = db();
    if (body.eligible_resource_ids.length) {
      const owned = (await sql`
        SELECT id FROM public.booking_resources
        WHERE bucket_id = ${a.ctx.clientId}::uuid AND id = ANY(${body.eligible_resource_ids}::uuid[])
      `) as Array<{ id: string }>;
      if (owned.length !== body.eligible_resource_ids.length) return jsonError(400, 'unknown_resource');
    }
    const rows = (await sql`
      INSERT INTO public.booking_services
        (bucket_id, name, duration_min, price_cents, payment_mode, deposit_cents, buffer_min, eligible_resource_ids)
      VALUES (${a.ctx.clientId}::uuid, ${body.name}, ${body.duration_min}, ${body.price_cents},
              ${body.payment_mode}::booking_payment_mode, ${body.deposit_cents ?? null}, ${body.buffer_min},
              ${body.eligible_resource_ids}::uuid[])
      RETURNING id, name, duration_min, price_cents, payment_mode, deposit_cents, buffer_min, active, eligible_resource_ids
    `) as any[];
    return jsonOk(rows[0], { status: 201 });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
