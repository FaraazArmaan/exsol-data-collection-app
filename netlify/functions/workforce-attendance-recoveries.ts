// /api/workforce/attendance-recoveries — manager queue for geofence fallback requests.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { recordSensitiveAccess, requireSensitiveAccess } from './_workforce-privacy';

export const config = { path: '/api/workforce/attendance-recoveries' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending';
  if (!['pending', 'approved', 'denied', 'cancelled', 'all'].includes(status)) return jsonError(400, 'recovery_status_invalid');
  const includeLocation = url.searchParams.get('include_location') === 'true';
  const accessBasis = includeLocation ? await requireSensitiveAccess(a.ctx, 'location_history') : null;
  if (accessBasis instanceof Response) return accessBasis;
  const requests = await db()`
    SELECT
      r.id, r.client_id, r.resource_id, r.user_node_id, r.action, r.status, r.failure_code, r.employee_reason, r.attempted_at, r.work_location_id,
      ${includeLocation}::boolean AS location_visible,
      CASE WHEN ${includeLocation}::boolean THEN r.latitude END AS latitude,
      CASE WHEN ${includeLocation}::boolean THEN r.longitude END AS longitude,
      CASE WHEN ${includeLocation}::boolean THEN r.accuracy_meters END AS accuracy_meters,
      CASE WHEN ${includeLocation}::boolean THEN r.distance_meters END AS distance_meters,
      r.geofence_result, r.request_key, r.reviewed_by, r.reviewed_at, r.resolution_note, r.override_punch_id, r.created_at, r.updated_at,
      br.name AS resource_name,
      wl.name AS work_location_name
    FROM public.workforce_attendance_recovery_requests r
    JOIN public.booking_resources br ON br.id = r.resource_id
    LEFT JOIN public.workforce_work_locations wl ON wl.id = r.work_location_id
    WHERE r.client_id = ${a.ctx.clientId}::uuid
      AND (${status}::text = 'all' OR r.status = ${status}::text)
    ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at ASC
    LIMIT 200
  ` as unknown[];
  if (accessBasis) await recordSensitiveAccess(a.ctx, 'location_history', '/api/workforce/attendance-recoveries', accessBasis);
  return jsonOk({ requests });
}
