// /api/workforce/me/time-status — self-service employee clock status.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { workforceClientTimeZone } from './_workforce-depth-utils';
import {
  listAssignedWorkLocations,
  openBreak,
  openPunch,
  requireWorkforceSelf,
  resolveSelfEmployee,
} from './_workforce-self-time';

export const config = { path: '/api/workforce/me/time-status' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;

  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;
  const timeZone = await workforceClientTimeZone(a.ctx.clientId);

  const punch = await openPunch(a.ctx, employee);
  const currentBreak = punch ? await openBreak(a.ctx, String(punch.id)) : null;
  const locations = await listAssignedWorkLocations(a.ctx, employee);
  const todayEvents = await db()`
    SELECT id, event_type, occurred_at, source, geofence_result, distance_meters
    FROM public.workforce_time_clock_events
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND resource_id = ${employee.resource_id}::uuid
      AND (occurred_at AT TIME ZONE ${timeZone}::text)::date = (NOW() AT TIME ZONE ${timeZone}::text)::date
    ORDER BY occurred_at DESC
    LIMIT 20
  ` as unknown[];
  const recoveryRequests = await db()`
    SELECT id, action, status, failure_code, employee_reason, attempted_at, resolution_note, reviewed_at, created_at
    FROM public.workforce_attendance_recovery_requests
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND user_node_id = ${a.ctx.userNodeId}::uuid
    ORDER BY created_at DESC
    LIMIT 5
  ` as unknown[];

  return jsonOk({
    employee,
    open_punch: punch,
    open_break: currentBreak,
    locations: locations.map((location) => ({
      id: location.id,
      name: location.name,
      radius_meters: location.radius_meters,
      min_accuracy_meters: location.min_accuracy_meters,
    })),
    geofence_required: true,
    today_events: todayEvents,
    recovery_requests: recoveryRequests,
  });
}
