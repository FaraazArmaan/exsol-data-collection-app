// /api/workforce/me/clock-in — self-service geofenced clock-in.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { workforceClientTimeZone } from './_workforce-depth-utils';
import {
  appendClockEvent,
  geoFromBody,
  idempotencyKeyFromBody,
  listAssignedWorkLocations,
  openPunch,
  readJsonObject,
  requireWorkforceSelf,
  resolveSelfEmployee,
  validateGeofence,
} from './_workforce-self-time';

export const config = { path: '/api/workforce/me/clock-in' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;
  const timeZone = await workforceClientTimeZone(a.ctx.clientId);

  const body = await readJsonObject(req);
  if (body instanceof Response) return body;
  const idempotencyKey = idempotencyKeyFromBody(body);
  if (idempotencyKey instanceof Response) return idempotencyKey;
  const geo = geoFromBody(body);
  if (geo instanceof Response) return geo;

  if (idempotencyKey) {
    const replay = await db()`
      SELECT *
      FROM public.workforce_punches
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND user_node_id = ${a.ctx.userNodeId}::uuid
        AND clock_in_idempotency_key = ${idempotencyKey}::text
      LIMIT 1
    ` as Array<Record<string, unknown>>;
    if (replay[0]) return jsonOk({ punch: replay[0], replayed: true });
  }

  const existing = await openPunch(a.ctx, employee);
  if (existing) return jsonError(409, 'already_clocked_in');

  const locations = await listAssignedWorkLocations(a.ctx, employee);
  const decision = validateGeofence(geo, locations);
  if (!decision.ok) {
    await appendClockEvent({ ctx: a.ctx, employee, eventType: 'clock_in', geo, decision, idempotencyKey });
    return jsonError(403, decision.code ?? 'geofence_failed', {
      distance_meters: decision.distance_meters,
      work_location_id: decision.location?.id ?? null,
      geofence_result: decision.result,
    });
  }

  const shiftRows = await db()`
    SELECT
      id,
      GREATEST(0, EXTRACT(EPOCH FROM (
        (NOW() AT TIME ZONE ${timeZone}::text)
        - ((NOW() AT TIME ZONE ${timeZone}::text)::date + start_time)
      ))::int / 60)::smallint AS late_minutes
    FROM public.workforce_shifts
    WHERE resource_id = ${employee.resource_id}::uuid
      AND client_id = ${a.ctx.clientId}::uuid
      AND weekday = EXTRACT(DOW FROM (NOW() AT TIME ZONE ${timeZone}::text))::int
    ORDER BY start_time ASC
    LIMIT 1
  ` as Array<{ id: string; late_minutes: number }>;
  const shift = shiftRows[0] ?? null;

  const rows = await db()`
    INSERT INTO public.workforce_punches
      (client_id, resource_id, user_node_id, shift_id, late_minutes, notes, clock_in_idempotency_key)
    VALUES
      (
        ${a.ctx.clientId}::uuid,
        ${employee.resource_id}::uuid,
        ${a.ctx.userNodeId}::uuid,
        ${shift?.id ?? null}::uuid,
        ${shift?.late_minutes ?? null}::smallint,
        ${typeof body.notes === 'string' ? body.notes.trim() || null : null}::text,
        ${idempotencyKey}::text
      )
    ON CONFLICT DO NOTHING
    RETURNING *
  ` as Array<Record<string, unknown>>;
  const punch = rows[0] ?? (idempotencyKey ? (await db()`
    SELECT *
    FROM public.workforce_punches
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND user_node_id = ${a.ctx.userNodeId}::uuid
      AND clock_in_idempotency_key = ${idempotencyKey}::text
    LIMIT 1
  ` as Array<Record<string, unknown>>)[0] : null);
  if (!punch) return jsonError(409, 'already_clocked_in');
  await appendClockEvent({
    ctx: a.ctx,
    employee,
    eventType: 'clock_in',
    punchId: String(punch.id),
    geo,
    decision,
    idempotencyKey,
  });
  return jsonOk({ punch, geofence: decision }, { status: rows[0] ? 201 : 200 });
}
