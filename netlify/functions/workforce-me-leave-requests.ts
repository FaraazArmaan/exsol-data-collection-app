// /api/workforce/me/leave-requests — employee self-service leave requests.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { readJsonObject, requireWorkforceSelf, resolveSelfEmployee } from './_workforce-self-time';

export const config = { path: '/api/workforce/me/leave-requests' };

const VALID_LEAVE_TYPES = new Set(['annual', 'sick', 'personal', 'unpaid']);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;

  const body = await readJsonObject(req);
  if (body instanceof Response) return body;
  const leaveType = typeof body.leave_type === 'string' ? body.leave_type.trim() : '';
  if (!VALID_LEAVE_TYPES.has(leaveType)) return jsonError(400, 'invalid_leave_type');
  const startDate = typeof body.start_date === 'string' ? body.start_date.trim() : '';
  const endDate = typeof body.end_date === 'string' ? body.end_date.trim() : '';
  if (!startDate) return jsonError(400, 'start_date_required');
  if (!endDate) return jsonError(400, 'end_date_required');

  const rows = await db()`
    INSERT INTO public.leave_requests (
      client_id, resource_id, user_node_id, leave_type, start_date, end_date, notes
    )
    VALUES (
      ${a.ctx.clientId}::uuid,
      ${employee.resource_id}::uuid,
      ${a.ctx.userNodeId}::uuid,
      ${leaveType}::text,
      ${startDate}::date,
      ${endDate}::date,
      ${typeof body.notes === 'string' ? body.notes.trim() || null : null}::text
    )
    RETURNING id, resource_id, user_node_id, leave_type,
      to_char(start_date, 'YYYY-MM-DD') AS start_date,
      to_char(end_date, 'YYYY-MM-DD') AS end_date,
      notes, status, created_at
  ` as Array<Record<string, unknown>>;
  return jsonOk({ request: rows[0] }, { status: 201 });
}
