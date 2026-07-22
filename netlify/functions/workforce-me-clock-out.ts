// /api/workforce/me/clock-out — self-service clock-out for current employee.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import {
  appendClockEvent,
  idempotencyKeyFromBody,
  openBreak,
  openPunch,
  readJsonObject,
  requireWorkforceSelf,
  resolveSelfEmployee,
} from './_workforce-self-time';

export const config = { path: '/api/workforce/me/clock-out' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;
  const body = await readJsonObject(req);
  if (body instanceof Response) return body;
  const idempotencyKey = idempotencyKeyFromBody(body);
  if (idempotencyKey instanceof Response) return idempotencyKey;

  if (idempotencyKey) {
    const replay = await db()`
      SELECT *
      FROM public.workforce_punches
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND user_node_id = ${a.ctx.userNodeId}::uuid
        AND clock_out_idempotency_key = ${idempotencyKey}::text
      LIMIT 1
    ` as Array<Record<string, unknown>>;
    if (replay[0]) return jsonOk({ punch: replay[0], replayed: true });
  }

  const punch = await openPunch(a.ctx, employee);
  if (!punch) return jsonError(409, 'not_clocked_in');
  const currentBreak = await openBreak(a.ctx, String(punch.id));
  if (currentBreak) return jsonError(409, 'break_open');

  const rows = await db()`
    UPDATE public.workforce_punches
    SET punched_out_at = now(), clock_out_idempotency_key = ${idempotencyKey}::text, updated_at = now()
    WHERE id = ${String(punch.id)}::uuid
      AND client_id = ${a.ctx.clientId}::uuid
      AND resource_id = ${employee.resource_id}::uuid
      AND punched_out_at IS NULL
    RETURNING *
  ` as Array<Record<string, unknown>>;
  if (rows.length === 0) return jsonError(404, 'punch_not_found');
  await appendClockEvent({ ctx: a.ctx, employee, eventType: 'clock_out', punchId: String(punch.id), idempotencyKey });
  return jsonOk({ punch: rows[0] });
}
