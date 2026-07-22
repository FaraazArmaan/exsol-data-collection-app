// /api/workforce/me/start-break — self-service break start.
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

export const config = { path: '/api/workforce/me/start-break' };

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

  const punch = await openPunch(a.ctx, employee);
  if (!punch) return jsonError(409, 'not_clocked_in');
  if (idempotencyKey) {
    const replay = await db()`
      SELECT *
      FROM public.workforce_punch_breaks
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND user_node_id = ${a.ctx.userNodeId}::uuid
        AND start_idempotency_key = ${idempotencyKey}::text
      LIMIT 1
    ` as Array<Record<string, unknown>>;
    if (replay[0]) return jsonOk({ break: replay[0], replayed: true });
  }
  const currentBreak = await openBreak(a.ctx, String(punch.id));
  if (currentBreak) return jsonError(409, 'break_already_open');

  const rows = await db()`
    INSERT INTO public.workforce_punch_breaks
      (client_id, punch_id, resource_id, user_node_id, start_idempotency_key)
    VALUES
      (${a.ctx.clientId}::uuid, ${String(punch.id)}::uuid, ${employee.resource_id}::uuid, ${a.ctx.userNodeId}::uuid, ${idempotencyKey}::text)
    RETURNING *
  ` as Array<Record<string, unknown>>;
  await appendClockEvent({ ctx: a.ctx, employee, eventType: 'break_start', punchId: String(punch.id), idempotencyKey });
  return jsonOk({ break: rows[0] }, { status: 201 });
}
