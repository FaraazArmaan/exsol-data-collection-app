// /api/workforce/me/time-correction — self-service correction request.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import {
  appendClockEvent,
  readJsonObject,
  requireWorkforceSelf,
  resolveSelfEmployee,
} from './_workforce-self-time';

export const config = { path: '/api/workforce/me/time-correction' };

const CORRECTION_TYPES = new Set(['missed_clock_in', 'missed_clock_out', 'edit_time', 'delete_punch']);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;

  const body = await readJsonObject(req);
  if (body instanceof Response) return body;
  const correctionType = typeof body.correction_type === 'string' ? body.correction_type : '';
  if (!CORRECTION_TYPES.has(correctionType)) return jsonError(400, 'correction_type_invalid');

  const rows = await db()`
    INSERT INTO public.workforce_time_corrections (
      client_id, resource_id, requested_by, correction_type, new_values, notes
    )
    VALUES (
      ${a.ctx.clientId}::uuid,
      ${employee.resource_id}::uuid,
      ${a.ctx.userNodeId}::uuid,
      ${correctionType}::text,
      ${JSON.stringify(body.new_values ?? {})}::jsonb,
      ${typeof body.notes === 'string' ? body.notes.trim() || null : null}::text
    )
    RETURNING *
  ` as Array<Record<string, unknown>>;
  await appendClockEvent({ ctx: a.ctx, employee, eventType: 'correction' });
  return jsonOk({ correction: rows[0] }, { status: 201 });
}
