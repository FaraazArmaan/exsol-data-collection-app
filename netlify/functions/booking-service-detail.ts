// GET/PATCH/DELETE /api/booking/service-detail/:id — every query scoped by bucket_id
// so a cross-tenant id reads as 404. DELETE = soft-deactivate (services are ON DELETE RESTRICT).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { ServicePatch } from './_booking-validators';

export const config = { path: '/api/booking/service-detail/:id', method: ['GET', 'PATCH', 'DELETE'] };

function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

export default async function handler(req: Request): Promise<Response> {
  const read = req.method === 'GET';
  const a = await requireBooking(req, [read ? 'booking.employees.view' : 'booking.employees.edit']);
  if (!a.ok) return a.res;
  const sql = db();
  const id = idFrom(req);

  if (req.method === 'GET') {
    const rows = (await sql`SELECT * FROM public.booking_services
      WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid LIMIT 1`) as any[];
    if (!rows[0]) return jsonError(404, 'not_found');
    return jsonOk(rows[0]);
  }
  if (req.method === 'PATCH') {
    let patch: ServicePatch;
    try { patch = ServicePatch.parse(await req.json()); }
    catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }
    if (patch.payment_mode === 'deposit' && patch.deposit_cents == null) return jsonError(400, 'deposit_required');
    const rows = (await sql`
      UPDATE public.booking_services SET
        name = COALESCE(${patch.name ?? null}, name),
        duration_min = COALESCE(${patch.duration_min ?? null}, duration_min),
        price_cents = COALESCE(${patch.price_cents ?? null}, price_cents),
        payment_mode = COALESCE(${patch.payment_mode ?? null}::booking_payment_mode, payment_mode),
        deposit_cents = CASE WHEN ${patch.deposit_cents !== undefined} THEN ${patch.deposit_cents ?? null} ELSE deposit_cents END,
        buffer_min = COALESCE(${patch.buffer_min ?? null}, buffer_min),
        active = COALESCE(${patch.active ?? null}, active),
        eligible_resource_ids = COALESCE(${patch.eligible_resource_ids ?? null}::uuid[], eligible_resource_ids)
      WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
      RETURNING *`) as any[];
    if (!rows[0]) return jsonError(404, 'not_found');
    return jsonOk(rows[0]);
  }
  // DELETE
  const rows = (await sql`UPDATE public.booking_services SET active = false
    WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid RETURNING id`) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  return jsonOk({ id: rows[0].id, active: false });
}
