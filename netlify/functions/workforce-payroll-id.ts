// /api/workforce/payroll/:id
//   GET    → period detail with line items (workforce.payroll.view)
//   PATCH  → approve period (workforce.payroll.edit)
//   DELETE → hard delete draft period (workforce.payroll.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { computePayableLineItems } from './_workforce-payable-time';
import { recordApprovalDecision, requireApprovalOwner } from './_workforce-approval-routing';
import { freezePayrollSnapshot, getPayrollSnapshot } from './_workforce-payroll-snapshot';
import { recordSensitiveAccess, requireSensitiveAccess } from './_workforce-privacy';

export const config = { path: '/api/workforce/payroll/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/\/payroll\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

async function handleGet(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.view']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'compensation');
  if (accessBasis instanceof Response) return accessBasis;

  const sql = db();

  const periodRows = (await sql`
    SELECT
      id,
      to_char(period_start, 'YYYY-MM-DD') AS period_start,
      to_char(period_end,   'YYYY-MM-DD') AS period_end,
      status,
      total_amount,
      snapshot_id,
      created_by,
      approved_by,
      approved_at,
      created_at
    FROM public.payroll_periods
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<Record<string, unknown>>;

  if (periodRows.length === 0) return jsonError(404, 'period_not_found');

  const period = periodRows[0]!;
  const snapshotId = period.snapshot_id as string | null;
  const snapshot = snapshotId ? await getPayrollSnapshot(snapshotId, a.ctx.clientId) : null;
  if (snapshotId && !snapshot) return jsonError(409, 'payroll_snapshot_missing');
  if (snapshot?.status === 'building') return jsonError(409, 'payroll_snapshot_building');
  const line_items = snapshot?.lines ?? await computePayableLineItems(
    a.ctx.clientId,
    period.period_start as string,
    period.period_end as string,
  );

  await recordSensitiveAccess(a.ctx, 'compensation', `/api/workforce/payroll/${id}`, accessBasis);
  return jsonOk({ period, line_items, snapshot });
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.edit']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'compensation');
  if (accessBasis instanceof Response) return accessBasis;

  const sql = db();

  const existing = (await sql`
    SELECT
      id,
      status,
      to_char(period_start, 'YYYY-MM-DD') AS period_start,
      to_char(period_end,   'YYYY-MM-DD') AS period_end
    FROM public.payroll_periods
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string; period_start: string; period_end: string }>;

  if (existing.length === 0) return jsonError(404, 'period_not_found');
  if (existing[0]!.status === 'approved') return jsonError(409, 'already_approved');
  const routing = await requireApprovalOwner(a.ctx, 'payroll', null);
  if (routing instanceof Response) return routing;

  const { period_start, period_end } = existing[0]!;

  const snapshot = await freezePayrollSnapshot({
    clientId: a.ctx.clientId,
    periodId: id,
    periodStart: period_start,
    periodEnd: period_end,
    createdBy: a.ctx.userNodeId,
  });

  const rows = (await sql`
    UPDATE public.payroll_periods
    SET
      status       = 'approved',
      total_amount = ${snapshot.total_amount}::numeric,
      snapshot_id  = ${snapshot.id}::uuid,
      approved_by  = ${a.ctx.userNodeId}::uuid,
      approved_at  = now(),
      updated_at   = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid AND status = 'draft'
    RETURNING
      id,
      to_char(period_start, 'YYYY-MM-DD') AS period_start,
      to_char(period_end,   'YYYY-MM-DD') AS period_end,
      status,
      total_amount,
      snapshot_id,
      created_by,
      approved_by,
      approved_at,
      created_at
  `) as Array<Record<string, unknown>>;

  if (rows.length === 0) return jsonError(409, 'already_approved');
  await recordApprovalDecision(a.ctx, 'payroll', id, routing.ownerUserNodeId, 'approved');
  await recordSensitiveAccess(a.ctx, 'compensation', `/api/workforce/payroll/${id}`, accessBasis);
  return jsonOk({ period: rows[0], snapshot });
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.delete']);
  if (!a.ok) return a.res;

  const sql = db();

  const existing = (await sql`
    SELECT id, status FROM public.payroll_periods
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string }>;

  if (existing.length === 0) return jsonError(404, 'period_not_found');
  if (existing[0]!.status === 'approved') return jsonError(409, 'cannot_delete_approved');

  await sql`
    DELETE FROM public.payroll_periods
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `;

  return new Response(null, { status: 204 });
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  if (req.method === 'GET') return handleGet(req, id);
  if (req.method === 'PATCH') return handlePatch(req, id);
  if (req.method === 'DELETE') return handleDelete(req, id);
  return jsonError(405, 'method_not_allowed');
}
