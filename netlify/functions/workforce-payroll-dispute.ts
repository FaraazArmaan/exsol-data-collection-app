// /api/workforce/payroll-dispute/:id — review a payroll dispute without reopening its snapshot.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { readJson, stringField, UUID_RE } from './_workforce-depth-utils';
import { recordSensitiveAccess, requireSensitiveAccess } from './_workforce-privacy';

export const config = { path: '/api/workforce/payroll-dispute/:id' };

function idFromUrl(req: Request): string | null {
  const id = new URL(req.url).pathname.match(/\/payroll-dispute\/([^/?]+)/)?.[1] ?? '';
  return UUID_RE.test(id) ? id : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PATCH') return jsonError(405, 'method_not_allowed');
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  const a = await requireWorkforce(req, ['workforce.payroll.edit']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'compensation');
  if (accessBasis instanceof Response) return accessBasis;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const action = stringField(body, 'action');
  const note = stringField(body, 'resolution_note');
  const nextStatus = action === 'start_review' ? 'under_review' : action === 'resolve' ? 'resolved' : action === 'reject' ? 'rejected' : null;
  if (!nextStatus) return jsonError(400, 'dispute_action_invalid');
  if ((nextStatus === 'resolved' || nextStatus === 'rejected') && !note) return jsonError(400, 'resolution_note_required');
  const rows = await db()`
    UPDATE public.workforce_payroll_disputes
    SET status = ${nextStatus}::text,
        resolution_note = CASE WHEN ${note}::text = '' THEN resolution_note ELSE ${note}::text END,
        resolved_by = CASE WHEN ${nextStatus}::text IN ('resolved', 'rejected') THEN ${a.ctx.userNodeId}::uuid ELSE resolved_by END,
        resolved_at = CASE WHEN ${nextStatus}::text IN ('resolved', 'rejected') THEN now() ELSE resolved_at END
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      AND status IN ('open', 'under_review')
    RETURNING *
  ` as Array<Record<string, unknown>>;
  if (rows.length === 0) return jsonError(404, 'open_dispute_not_found');
  await recordSensitiveAccess(a.ctx, 'compensation', `/api/workforce/payroll-dispute/${id}`, accessBasis, rows[0]!.user_node_id as string);
  return jsonOk({ dispute: rows[0] });
}
