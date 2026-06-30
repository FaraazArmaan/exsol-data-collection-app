// GET/POST/DELETE /api/booking/resource-time-off — per-resource one-off blocks.
// Ownership enforced by joining time-off → resource → bucket_id.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { TimeOffCreate } from './_booking-validators';

export const config = { path: '/api/booking/resource-time-off', method: ['GET', 'POST', 'DELETE'] };

async function resourceOwned(sql: ReturnType<typeof db>, clientId: string, resourceId: string): Promise<boolean> {
  const r = (await sql`SELECT 1 FROM public.booking_resources
    WHERE id = ${resourceId}::uuid AND bucket_id = ${clientId}::uuid LIMIT 1`) as any[];
  return r.length > 0;
}

export default async function handler(req: Request): Promise<Response> {
  const read = req.method === 'GET';
  const a = await requireBooking(req, [read ? 'booking.employees.view' : 'booking.employees.edit']);
  if (!a.ok) return a.res;
  const sql = db();
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const resourceId = url.searchParams.get('resource_id') ?? '';
    if (!(await resourceOwned(sql, a.ctx.clientId, resourceId))) return jsonError(404, 'resource_not_found');
    const rows = (await sql`SELECT id, resource_id, starts_at, ends_at, reason
      FROM public.booking_resource_time_off WHERE resource_id = ${resourceId}::uuid ORDER BY starts_at`) as any[];
    return jsonOk({ time_off: rows });
  }
  if (req.method === 'POST') {
    let body: TimeOffCreate;
    try { body = TimeOffCreate.parse(await req.json()); }
    catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }
    if (!(await resourceOwned(sql, a.ctx.clientId, body.resource_id))) return jsonError(404, 'resource_not_found');
    if (new Date(body.ends_at) <= new Date(body.starts_at)) return jsonError(400, 'invalid_range');
    const rows = (await sql`
      INSERT INTO public.booking_resource_time_off (resource_id, starts_at, ends_at, reason)
      VALUES (${body.resource_id}::uuid, ${body.starts_at}::timestamptz, ${body.ends_at}::timestamptz, ${body.reason ?? null})
      RETURNING id, resource_id, starts_at, ends_at, reason`) as any[];
    return jsonOk(rows[0], { status: 201 });
  }
  // DELETE ?id= — scoped via join to the owning resource's bucket.
  const id = url.searchParams.get('id') ?? '';
  const rows = (await sql`
    DELETE FROM public.booking_resource_time_off t
    USING public.booking_resources r
    WHERE t.id = ${id}::uuid AND t.resource_id = r.id AND r.bucket_id = ${a.ctx.clientId}::uuid
    RETURNING t.id`) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  return jsonOk({ id: rows[0].id, deleted: true });
}
