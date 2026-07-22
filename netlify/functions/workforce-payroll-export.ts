// /api/workforce/payroll-export
//   GET  → list payroll exports and payslips (workforce.payroll.view)
//   POST → generate export and draft payslips for a period (workforce.payroll.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { jsonBodyField, optionalUuidParam, readJson, stringField } from './_workforce-depth-utils';
import { getPayrollSnapshot } from './_workforce-payroll-snapshot';
import { recordSensitiveAccess, requireSensitiveAccess } from './_workforce-privacy';

export const config = { path: '/api/workforce/payroll-export' };

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.view']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'compensation');
  if (accessBasis instanceof Response) return accessBasis;

  const periodId = optionalUuidParam(new URL(req.url).searchParams.get('period_id'), 'period_id');
  if (periodId instanceof Response) return periodId;
  const exports = await db()`
    SELECT *
    FROM public.workforce_payroll_exports
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND (${periodId}::uuid IS NULL OR period_id = ${periodId}::uuid)
    ORDER BY created_at DESC
  ` as unknown[];
  const payslips = await db()`
    SELECT *
    FROM public.workforce_payslips
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND (${periodId}::uuid IS NULL OR period_id = ${periodId}::uuid)
    ORDER BY created_at DESC
  ` as unknown[];
  await recordSensitiveAccess(a.ctx, 'compensation', '/api/workforce/payroll-export', accessBasis);
  return jsonOk({ exports, payslips });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.create']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'compensation');
  if (accessBasis instanceof Response) return accessBasis;

  const body = await readJson(req);
  if (body instanceof Response) return body;
  const periodId = stringField(body, 'period_id');
  if (!periodId) return jsonError(400, 'period_id_required');

  const sql = db();
  const periods = await sql`
    SELECT id, status, snapshot_id
    FROM public.payroll_periods
    WHERE id = ${periodId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  ` as Array<{ id: string; status: string; snapshot_id: string | null }>;
  if (periods.length === 0) return jsonError(404, 'period_not_found');
  if (periods[0]!.status !== 'approved' || !periods[0]!.snapshot_id) return jsonError(409, 'payroll_snapshot_required');

  const snapshot = await getPayrollSnapshot(periods[0]!.snapshot_id, a.ctx.clientId);
  if (!snapshot || snapshot.status !== 'frozen') return jsonError(409, 'payroll_snapshot_required');

  const existingExports = await sql`
    SELECT *
    FROM public.workforce_payroll_exports
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND snapshot_id = ${snapshot.id}::uuid
      AND status <> 'void'
    ORDER BY created_at DESC
    LIMIT 1
  ` as Array<Record<string, unknown>>;
  if (existingExports.length > 0) {
    const payslips = await sql`
      SELECT *
      FROM public.workforce_payslips
      WHERE client_id = ${a.ctx.clientId}::uuid AND snapshot_id = ${snapshot.id}::uuid
      ORDER BY created_at, id
    ` as unknown[];
    await recordSensitiveAccess(a.ctx, 'compensation', '/api/workforce/payroll-export', accessBasis);
    return jsonOk({ export: existingExports[0], payslips, snapshot, reused: true });
  }

  const legacyPayslips = await sql`
    SELECT id
    FROM public.workforce_payslips
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND period_id = ${periodId}::uuid
      AND snapshot_id IS NULL
    LIMIT 1
  ` as unknown[];
  if (legacyPayslips.length > 0) return jsonError(409, 'legacy_payslips_require_void');

  const exportRows = await sql`
    INSERT INTO public.workforce_payroll_exports (client_id, period_id, snapshot_id, export_format, status, total_amount, exported_by, exported_at, metadata)
    VALUES (${a.ctx.clientId}::uuid, ${periodId}::uuid, ${snapshot.id}::uuid, COALESCE(NULLIF(${stringField(body, 'export_format')}::text, ''), 'csv'), 'generated', ${snapshot.total_amount}::numeric, ${a.ctx.userNodeId}::uuid, now(), jsonb_build_object('snapshot_id', ${snapshot.id}::text, 'frozen_at', ${snapshot.frozen_at}::text, 'request_metadata', ${jsonBodyField(body, 'metadata')}::jsonb))
    RETURNING *
  ` as Array<Record<string, unknown>>;
  const exportId = exportRows[0]!.id as string;

  const payslips: unknown[] = [];
  for (const item of snapshot.lines) {
    const rows = await sql`
      INSERT INTO public.workforce_payslips (client_id, export_id, period_id, snapshot_id, snapshot_line_id, user_node_id, gross_amount, net_amount, currency, metadata)
      VALUES (${a.ctx.clientId}::uuid, ${exportId}::uuid, ${periodId}::uuid, ${snapshot.id}::uuid, ${item.id}::uuid, ${item.user_node_id}::uuid, ${item.gross_amount}::numeric, ${item.net_amount}::numeric, ${item.currency}::text, jsonb_build_object('source_evidence', ${JSON.stringify(item.source_evidence)}::jsonb, 'snapshot_id', ${snapshot.id}::text))
      RETURNING *
    ` as unknown[];
    payslips.push(rows[0]);
  }

  await recordSensitiveAccess(a.ctx, 'compensation', '/api/workforce/payroll-export', accessBasis);
  return jsonOk({ export: exportRows[0], payslips, snapshot, reused: false }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
