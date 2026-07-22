// /api/workforce/me/attendance-recovery — employee fallback when geofence capture cannot complete.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import {
  appendClockEvent,
  geoFromBody,
  listAssignedWorkLocations,
  numberValue,
  readJsonObject,
  requireWorkforceSelf,
  resolveSelfEmployee,
  validateGeofence,
} from './_workforce-self-time';

const FAILURE_CODES = new Set([
  'permission_denied',
  'position_unavailable',
  'location_timeout',
  'outside_geofence',
  'location_accuracy_too_low',
  'geofence_unconfigured',
  'network_error',
]);

export const config = { path: '/api/workforce/me/attendance-recovery' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;

  const body = await readJsonObject(req);
  if (body instanceof Response) return body;
  const failureCode = typeof body.failure_code === 'string' ? body.failure_code : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const requestKey = typeof body.request_key === 'string' ? body.request_key.trim() : '';
  if (!FAILURE_CODES.has(failureCode)) return jsonError(400, 'recovery_failure_code_invalid');
  if (reason.length < 3 || reason.length > 2000) return jsonError(400, 'recovery_reason_invalid');
  if (requestKey.length < 8 || requestKey.length > 128) return jsonError(400, 'recovery_request_key_invalid');

  const hasGeo = body.latitude !== undefined || body.longitude !== undefined || body.accuracy_meters !== undefined;
  const geo = hasGeo ? geoFromBody(body) : null;
  if (geo instanceof Response) return geo;
  const decision = geo ? validateGeofence(geo, await listAssignedWorkLocations(a.ctx, employee)) : null;
  const distance = numberValue(body.distance_meters);
  if (body.distance_meters !== undefined && (distance === null || distance < 0)) return jsonError(400, 'distance_meters_invalid');

  const rows = await db()`
    INSERT INTO public.workforce_attendance_recovery_requests (
      client_id, resource_id, user_node_id, failure_code, employee_reason, work_location_id,
      latitude, longitude, accuracy_meters, distance_meters, geofence_result, request_key
    )
    VALUES (
      ${a.ctx.clientId}::uuid,
      ${employee.resource_id}::uuid,
      ${a.ctx.userNodeId}::uuid,
      ${failureCode}::text,
      ${reason}::text,
      ${decision?.location?.id ?? null}::uuid,
      ${geo?.latitude ?? null}::numeric,
      ${geo?.longitude ?? null}::numeric,
      ${geo?.accuracy_meters ?? null}::numeric,
      ${decision?.distance_meters ?? distance ?? null}::numeric,
      ${decision?.result ?? null}::text,
      ${requestKey}::text
    )
    ON CONFLICT (client_id, user_node_id, request_key)
    DO UPDATE SET request_key = EXCLUDED.request_key
    RETURNING *
  ` as Array<Record<string, unknown>>;
  const recovery = rows[0]!;
  await appendClockEvent({
    ctx: a.ctx,
    employee,
    eventType: 'note',
    notes: `Attendance recovery requested: ${failureCode}. ${reason}`,
    geo,
    decision,
    idempotencyKey: requestKey,
  });
  return jsonOk({ recovery }, { status: 201 });
}
