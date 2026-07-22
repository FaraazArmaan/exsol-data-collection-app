// /api/workforce/time-correction/:id — review a pending correction into an audited payable adjustment.
import { jsonOk, jsonError } from './_shared/http';
import { randomUUID } from 'node:crypto';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { recordApprovalDecision, requireApprovalOwner } from './_workforce-approval-routing';

export const config = { path: '/api/workforce/time-correction/:id' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function idFromUrl(req: Request): string | null {
  const id = new URL(req.url).pathname.match(/workforce\/time-correction\/([^/?]+)/)?.[1];
  return id && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id) ? id : null;
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PATCH') return jsonError(405, 'method_not_allowed');

  const correctionId = idFromUrl(req);
  if (!correctionId) return jsonError(400, 'invalid_id');
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const action = typeof body.action === 'string' ? body.action : '';
  if (action !== 'approve' && action !== 'deny') return jsonError(400, 'review_action_invalid');
  const note = typeof body.resolution_note === 'string' ? body.resolution_note.trim() : '';
  if (!note) return jsonError(400, 'resolution_note_required');

  const sql = db();
  const existing = await sql`
    SELECT id, status, requested_by
    FROM public.workforce_time_corrections
    WHERE id = ${correctionId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  ` as Array<{ id: string; status: string; requested_by: string | null }>;
  if (!existing[0]) return jsonError(404, 'correction_not_found');
  if (existing[0].status !== 'pending') return jsonError(409, 'correction_already_reviewed');
  const routing = await requireApprovalOwner(a.ctx, 'time_correction', existing[0].requested_by);
  if (routing instanceof Response) return routing;
  if (action === 'deny') {
    const rows = await sql`
      WITH reviewed AS (
        UPDATE public.workforce_time_corrections
        SET status = 'denied', reviewed_by = ${a.ctx.userNodeId}::uuid, reviewed_at = now(), resolution_note = ${note}::text
        WHERE id = ${correctionId}::uuid
          AND client_id = ${a.ctx.clientId}::uuid
          AND status = 'pending'
        RETURNING *
      ), event AS (
        INSERT INTO public.workforce_time_clock_events (
          client_id, resource_id, user_node_id, event_type, source, notes, metadata, recorded_by
        )
        SELECT
          client_id,
          resource_id,
          requested_by,
          'correction',
          'system',
          ${note}::text,
          jsonb_build_object('correction_id', id, 'action', 'denied'),
          ${a.ctx.userNodeId}::uuid
        FROM reviewed
      )
      SELECT * FROM reviewed
    ` as Array<Record<string, unknown>>;
    if (rows.length === 0) return correctionStateError(sql, a.ctx.clientId, correctionId);
    await recordApprovalDecision(a.ctx, 'time_correction', correctionId, routing.ownerUserNodeId, 'denied');
    return jsonOk({ correction: rows[0] });
  }

  const workDate = typeof body.work_date === 'string' ? body.work_date : '';
  if (!validDate(workDate)) return jsonError(400, 'work_date_invalid');
  const minutes = typeof body.minutes === 'number'
    ? body.minutes
    : typeof body.minutes === 'string'
      ? Number(body.minutes)
      : NaN;
  if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 1440) {
    return jsonError(400, 'minutes_invalid');
  }

  const payableEntryId = randomUUID();
  const rows = await sql`
    WITH reviewed AS (
      UPDATE public.workforce_time_corrections
      SET
        status = 'approved',
        reviewed_by = ${a.ctx.userNodeId}::uuid,
        reviewed_at = now(),
        resolution_note = ${note}::text,
        payable_time_entry_id = ${payableEntryId}::uuid,
        applied_at = now()
      WHERE id = ${correctionId}::uuid
        AND client_id = ${a.ctx.clientId}::uuid
        AND status = 'pending'
      RETURNING *
    ), payable AS (
      INSERT INTO public.workforce_payable_time_entries (
        id, client_id, resource_id, user_node_id, work_date, minutes, source_type, source_id, approved_by, approved_at, notes, source_snapshot
      )
      SELECT
        ${payableEntryId}::uuid,
        reviewed.client_id,
        reviewed.resource_id,
        COALESCE(profile.user_node_id, reviewed.requested_by),
        ${workDate}::date,
        ${minutes}::int,
        'approved_correction',
        reviewed.id,
        ${a.ctx.userNodeId}::uuid,
        now(),
        ${note}::text,
        jsonb_build_object(
          'correction_id', reviewed.id,
          'correction_type', reviewed.correction_type,
          'original_values', reviewed.original_values,
          'requested_values', reviewed.new_values,
          'review_note', ${note}::text
        )
      FROM reviewed
      LEFT JOIN public.workforce_employee_profiles profile
        ON profile.client_id = reviewed.client_id
       AND profile.resource_id = reviewed.resource_id
      WHERE COALESCE(profile.user_node_id, reviewed.requested_by) IS NOT NULL
      RETURNING id
    ), event AS (
      INSERT INTO public.workforce_time_clock_events (
        client_id, resource_id, user_node_id, event_type, source, notes, metadata, recorded_by
      )
      SELECT
        client_id,
        resource_id,
        requested_by,
        'correction',
        'system',
        ${note}::text,
        jsonb_build_object('correction_id', id, 'action', 'approved', 'work_date', ${workDate}::text, 'minutes', ${minutes}::int),
        ${a.ctx.userNodeId}::uuid
      FROM reviewed
    )
    SELECT * FROM reviewed
  ` as Array<Record<string, unknown>>;
  if (rows.length === 0) return correctionStateError(sql, a.ctx.clientId, correctionId);
  await recordApprovalDecision(a.ctx, 'time_correction', correctionId, routing.ownerUserNodeId, 'approved');
  return jsonOk({ correction: rows[0] });
}

async function correctionStateError(sql: ReturnType<typeof db>, clientId: string, correctionId: string): Promise<Response> {
  const rows = await sql`
    SELECT status
    FROM public.workforce_time_corrections
    WHERE id = ${correctionId}::uuid AND client_id = ${clientId}::uuid
    LIMIT 1
  ` as Array<{ status: string }>;
  return rows.length === 0 ? jsonError(404, 'correction_not_found') : jsonError(409, 'correction_already_reviewed');
}
