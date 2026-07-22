// /api/workforce/attendance-recovery/:id — manager decision on a self-service geofence fallback.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { recordApprovalDecision, requireApprovalOwner } from './_workforce-approval-routing';
import { recordSensitiveAccess, sensitiveAccessBasis } from './_workforce-privacy';

export const config = { path: '/api/workforce/attendance-recovery/:id' };

function idFromUrl(req: Request): string | null {
  const id = new URL(req.url).pathname.match(/workforce\/attendance-recovery\/([^/?]+)/)?.[1];
  return id && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id) ? id : null;
}

function parseClockInAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 5 * 60_000) return null;
  return date.toISOString();
}

function redactedRecovery(row: Record<string, unknown>, includeLocation: boolean): Record<string, unknown> {
  if (includeLocation) return row;
  const { latitude, longitude, accuracy_meters, distance_meters, ...recovery } = row;
  return { ...recovery, location_visible: false };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PATCH') return jsonError(405, 'method_not_allowed');
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;
  const locationAccess = await sensitiveAccessBasis(a.ctx, 'location_history');
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const note = typeof body.resolution_note === 'string' ? body.resolution_note.trim() : '';
  if (action !== 'approve' && action !== 'deny') return jsonError(400, 'recovery_action_invalid');
  if (note.length < 3 || note.length > 2000) return jsonError(400, 'resolution_note_required');

  const sql = db();
  const existing = await sql`
    SELECT id, status, user_node_id
    FROM public.workforce_attendance_recovery_requests
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  ` as Array<{ id: string; status: string; user_node_id: string | null }>;
  if (!existing[0]) return jsonError(404, 'attendance_recovery_not_found');
  if (existing[0].status !== 'pending') return jsonError(409, 'attendance_recovery_already_reviewed');
  const routing = await requireApprovalOwner(a.ctx, 'attendance_recovery', existing[0].user_node_id);
  if (routing instanceof Response) return routing;
  if (action === 'deny') {
    const rows = await sql`
      WITH reviewed AS (
        UPDATE public.workforce_attendance_recovery_requests
        SET status = 'denied', reviewed_by = ${a.ctx.userNodeId}::uuid, reviewed_at = now(), resolution_note = ${note}::text
        WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid AND status = 'pending'
        RETURNING *
      ), event AS (
        INSERT INTO public.workforce_time_clock_events (
          client_id, resource_id, user_node_id, event_type, source, notes, metadata, recorded_by
        )
        SELECT client_id, resource_id, user_node_id, 'note', 'system', ${note}::text, jsonb_build_object('attendance_recovery_id', id, 'action', 'denied'), ${a.ctx.userNodeId}::uuid
        FROM reviewed
      )
      SELECT * FROM reviewed
    ` as Array<Record<string, unknown>>;
    if (!rows[0]) return recoveryStateError(sql, a.ctx.clientId, id);
    await recordApprovalDecision(a.ctx, 'attendance_recovery', id, routing.ownerUserNodeId, 'denied');
    if (locationAccess) await recordSensitiveAccess(a.ctx, 'location_history', '/api/workforce/attendance-recovery', locationAccess, existing[0].user_node_id);
    return jsonOk({ recovery: redactedRecovery(rows[0], !!locationAccess) });
  }

  const clockInAt = body.clock_in_at === undefined ? null : parseClockInAt(body.clock_in_at);
  if (body.clock_in_at !== undefined && !clockInAt) return jsonError(400, 'clock_in_at_invalid');
  const rows = await sql`
    WITH pending AS (
      SELECT *
      FROM public.workforce_attendance_recovery_requests
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid AND status = 'pending'
      FOR UPDATE
    ), eligible AS (
      SELECT pending.*
      FROM pending
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.workforce_punches p
        WHERE p.client_id = pending.client_id
          AND p.resource_id = pending.resource_id
          AND p.punched_out_at IS NULL
      )
    ), punch AS (
      INSERT INTO public.workforce_punches (client_id, resource_id, user_node_id, punched_in_at, notes)
      SELECT client_id, resource_id, user_node_id, COALESCE(${clockInAt}::timestamptz, attempted_at), ${`Supervisor override: ${note}`}::text
      FROM eligible
      RETURNING *
    ), reviewed AS (
      UPDATE public.workforce_attendance_recovery_requests r
      SET status = 'approved', reviewed_by = ${a.ctx.userNodeId}::uuid, reviewed_at = now(), resolution_note = ${note}::text, override_punch_id = punch.id
      FROM punch
      WHERE r.id = ${id}::uuid
      RETURNING r.*
    ), event AS (
      INSERT INTO public.workforce_time_clock_events (
        client_id, resource_id, user_node_id, punch_id, event_type, source, notes, metadata, recorded_by,
        work_location_id, latitude, longitude, accuracy_meters, distance_meters, geofence_result
      )
      SELECT
        reviewed.client_id,
        reviewed.resource_id,
        reviewed.user_node_id,
        reviewed.override_punch_id,
        'clock_in',
        'manual',
        ${note}::text,
        jsonb_build_object('attendance_recovery_id', reviewed.id, 'action', 'supervisor_override', 'failure_code', reviewed.failure_code),
        ${a.ctx.userNodeId}::uuid,
        reviewed.work_location_id,
        reviewed.latitude,
        reviewed.longitude,
        reviewed.accuracy_meters,
        reviewed.distance_meters,
        reviewed.geofence_result
      FROM reviewed
    )
    SELECT * FROM reviewed
  ` as Array<Record<string, unknown>>;
  if (!rows[0]) return recoveryStateError(sql, a.ctx.clientId, id);
  await recordApprovalDecision(a.ctx, 'attendance_recovery', id, routing.ownerUserNodeId, 'approved');
  if (locationAccess) await recordSensitiveAccess(a.ctx, 'location_history', '/api/workforce/attendance-recovery', locationAccess, existing[0].user_node_id);
  return jsonOk({ recovery: redactedRecovery(rows[0], !!locationAccess) });
}

async function recoveryStateError(sql: ReturnType<typeof db>, clientId: string, id: string): Promise<Response> {
  const rows = await sql`
    SELECT status
    FROM public.workforce_attendance_recovery_requests
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
    LIMIT 1
  ` as Array<{ status: string }>;
  return rows.length === 0 ? jsonError(404, 'attendance_recovery_not_found') : jsonError(409, 'attendance_recovery_already_reviewed');
}
