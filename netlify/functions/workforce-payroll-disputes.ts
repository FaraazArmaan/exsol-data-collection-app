// /api/workforce/payroll-disputes — immutable-payroll dispute register.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { optionalUuidField, optionalUuidParam, readJson, stringField, UUID_RE } from './_workforce-depth-utils';
import { recordSensitiveAccess, requireSensitiveAccess } from './_workforce-privacy';

export const config = { path: '/api/workforce/payroll-disputes' };

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.view']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'compensation');
  if (accessBasis instanceof Response) return accessBasis;
  const periodId = optionalUuidParam(new URL(req.url).searchParams.get('period_id'), 'period_id');
  if (periodId instanceof Response) return periodId;
  const disputes = await db()`
    SELECT d.*, subject.display_name AS subject_name, submitter.display_name AS submitted_by_name, resolver.display_name AS resolved_by_name
    FROM public.workforce_payroll_disputes d
    LEFT JOIN public.user_nodes subject ON subject.id = d.user_node_id
    LEFT JOIN public.user_nodes submitter ON submitter.id = d.submitted_by
    LEFT JOIN public.user_nodes resolver ON resolver.id = d.resolved_by
    WHERE d.client_id = ${a.ctx.clientId}::uuid
      AND (${periodId}::uuid IS NULL OR d.period_id = ${periodId}::uuid)
    ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, d.created_at DESC
  ` as unknown[];
  await recordSensitiveAccess(a.ctx, 'compensation', '/api/workforce/payroll-disputes', accessBasis);
  return jsonOk({ disputes });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.create']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'compensation');
  if (accessBasis instanceof Response) return accessBasis;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const periodId = stringField(body, 'period_id');
  const reason = stringField(body, 'reason');
  const subjectId = optionalUuidField(body, 'user_node_id');
  const payslipId = optionalUuidField(body, 'payslip_id');
  if (subjectId instanceof Response) return subjectId;
  if (payslipId instanceof Response) return payslipId;
  if (!periodId || !reason) return jsonError(400, 'period_id_and_reason_required');
  if (!UUID_RE.test(periodId)) return jsonError(400, 'invalid_period_id');

  const sql = db();
  const periods = await sql`
    SELECT id, snapshot_id
    FROM public.payroll_periods
    WHERE id = ${periodId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND status = 'approved'
    LIMIT 1
  ` as Array<{ id: string; snapshot_id: string | null }>;
  if (!periods[0]?.snapshot_id) return jsonError(409, 'payroll_snapshot_required');
  const resolvedSubjectId = subjectId ?? a.ctx.userNodeId;
  const snapshotLine = await sql`
    SELECT id
    FROM public.workforce_payroll_snapshot_lines
    WHERE snapshot_id = ${periods[0].snapshot_id}::uuid AND user_node_id = ${resolvedSubjectId}::uuid
    LIMIT 1
  ` as unknown[];
  if (snapshotLine.length === 0) return jsonError(400, 'dispute_subject_not_in_snapshot');
  if (payslipId) {
    const payslip = await sql`
      SELECT id
      FROM public.workforce_payslips
      WHERE id = ${payslipId}::uuid AND client_id = ${a.ctx.clientId}::uuid
        AND snapshot_id = ${periods[0].snapshot_id}::uuid AND user_node_id = ${resolvedSubjectId}::uuid
      LIMIT 1
    ` as unknown[];
    if (payslip.length === 0) return jsonError(400, 'payslip_not_in_snapshot');
  }
  const rows = await sql`
    INSERT INTO public.workforce_payroll_disputes (client_id, period_id, snapshot_id, payslip_id, user_node_id, reason, submitted_by)
    VALUES (${a.ctx.clientId}::uuid, ${periodId}::uuid, ${periods[0].snapshot_id}::uuid, ${payslipId}::uuid, ${resolvedSubjectId}::uuid, ${reason}::text, ${a.ctx.userNodeId}::uuid)
    RETURNING *
  ` as Array<Record<string, unknown>>;
  await recordSensitiveAccess(a.ctx, 'compensation', '/api/workforce/payroll-disputes', accessBasis, resolvedSubjectId);
  return jsonOk({ dispute: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
