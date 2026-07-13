// /api/workforce/me/time-status — self-service employee clock status.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
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

  const punch = await openPunch(a.ctx, employee);
  const currentBreak = punch ? await openBreak(a.ctx, String(punch.id)) : null;
  const locations = await listAssignedWorkLocations(a.ctx, employee);
  const todayEvents = await db()`
    SELECT id, event_type, occurred_at, source, geofence_result, distance_meters
    FROM public.workforce_time_clock_events
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND resource_id = ${employee.resource_id}::uuid
      AND occurred_at::date = CURRENT_DATE
    ORDER BY occurred_at DESC
    LIMIT 20
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
  });
}
