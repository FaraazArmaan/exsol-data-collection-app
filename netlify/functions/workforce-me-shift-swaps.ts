// /api/workforce/me/shift-swaps — employee offers one of their own shifts.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { readJsonObject, requireWorkforceSelf, resolveSelfEmployee } from './_workforce-self-time';

export const config = { path: '/api/workforce/me/shift-swaps' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;

  const body = await readJsonObject(req);
  if (body instanceof Response) return body;
  const shiftId = typeof body.shift_id === 'string' ? body.shift_id.trim() : '';
  const offeringDate = typeof body.offering_date === 'string' ? body.offering_date.trim() : '';
  if (!shiftId) return jsonError(400, 'shift_id_required');
  if (!offeringDate) return jsonError(400, 'offering_date_required');

  const shifts = await db()`
    SELECT id
    FROM public.workforce_shifts
    WHERE id = ${shiftId}::uuid
      AND client_id = ${a.ctx.clientId}::uuid
      AND resource_id = ${employee.resource_id}::uuid
    LIMIT 1
  ` as Array<{ id: string }>;
  if (shifts.length === 0) return jsonError(404, 'shift_not_found');

  const rows = await db()`
    INSERT INTO public.shift_swaps (
      client_id, offering_shift_id, offering_resource_id, offering_date, notes
    )
    VALUES (
      ${a.ctx.clientId}::uuid,
      ${shiftId}::uuid,
      ${employee.resource_id}::uuid,
      ${offeringDate}::date,
      ${typeof body.notes === 'string' ? body.notes.trim() || null : null}::text
    )
    RETURNING id, offering_shift_id, offering_resource_id,
      to_char(offering_date, 'YYYY-MM-DD') AS offering_date,
      claimed_by_resource_id, claimed_at, status, notes, created_at
  ` as Array<Record<string, unknown>>;
  return jsonOk({ swap: rows[0] }, { status: 201 });
}
