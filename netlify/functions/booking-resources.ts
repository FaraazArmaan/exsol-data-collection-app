// GET/POST /api/booking/resources — list (incl. inactive) + create.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { ResourceCreate } from './_booking-validators';

export const config = { path: '/api/booking/resources', method: ['GET', 'POST'] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireBooking(req, ['booking.employees.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT id, name, weekly_schedule, active FROM public.booking_resources
      WHERE bucket_id = ${a.ctx.clientId}::uuid ORDER BY name
    `) as any[];
    return jsonOk({ resources: rows });
  }
  if (req.method === 'POST') {
    const a = await requireBooking(req, ['booking.employees.edit']);
    if (!a.ok) return a.res;
    let body: ResourceCreate;
    try { body = ResourceCreate.parse(await req.json()); }
    catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }
    const sql = db();
    const rows = (await sql`
      INSERT INTO public.booking_resources (bucket_id, name, weekly_schedule, active)
      VALUES (${a.ctx.clientId}::uuid, ${body.name}, ${JSON.stringify(body.weekly_schedule)}::jsonb, ${body.active})
      RETURNING id, name, weekly_schedule, active
    `) as any[];
    return jsonOk(rows[0], { status: 201 });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
