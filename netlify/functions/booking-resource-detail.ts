// GET/PATCH/DELETE /api/booking/resource-detail/:id — bucket-scoped; DELETE = soft-deactivate.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { ResourcePatch } from './_booking-validators';

export const config = { path: '/api/booking/resource-detail/:id', method: ['GET', 'PATCH', 'DELETE'] };

function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

export default async function handler(req: Request): Promise<Response> {
  const read = req.method === 'GET';
  const a = await requireBooking(req, [read ? 'booking.employees.view' : 'booking.employees.edit']);
  if (!a.ok) return a.res;
  const sql = db();
  const id = idFrom(req);

  if (req.method === 'GET') {
    const rows = (await sql`SELECT id, name, weekly_schedule, active FROM public.booking_resources
      WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid LIMIT 1`) as any[];
    if (!rows[0]) return jsonError(404, 'not_found');
    return jsonOk(rows[0]);
  }
  if (req.method === 'PATCH') {
    let patch: ResourcePatch;
    try { patch = ResourcePatch.parse(await req.json()); }
    catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }
    const rows = (await sql`
      UPDATE public.booking_resources SET
        name = COALESCE(${patch.name ?? null}, name),
        weekly_schedule = COALESCE(${patch.weekly_schedule ? JSON.stringify(patch.weekly_schedule) : null}::jsonb, weekly_schedule),
        active = COALESCE(${patch.active ?? null}, active)
      WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
      RETURNING id, name, weekly_schedule, active`) as any[];
    if (!rows[0]) return jsonError(404, 'not_found');
    return jsonOk(rows[0]);
  }
  // DELETE
  const rows = (await sql`UPDATE public.booking_resources SET active = false
    WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid RETURNING id`) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  return jsonOk({ id: rows[0].id, active: false });
}
