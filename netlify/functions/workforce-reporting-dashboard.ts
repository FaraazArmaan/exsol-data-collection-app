// /api/workforce/reporting-dashboard
//   GET  → live dashboard metrics + snapshots (workforce.employees.view)
//   POST → save today's or requested snapshot (workforce.employees.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { dateOrToday, jsonBodyField, readJson, stringField } from './_workforce-depth-utils';

export const config = { path: '/api/workforce/reporting-dashboard' };

async function metrics(clientId: string): Promise<Record<string, number>> {
  const rows = await db()`
    SELECT
      (SELECT COUNT(*) FROM public.workforce_employee_profiles WHERE client_id = ${clientId}::uuid AND employment_status = 'active')::int AS active_profiles,
      (SELECT COUNT(*) FROM public.workforce_schedule_compliance_findings WHERE client_id = ${clientId}::uuid AND status = 'open')::int AS open_schedule_findings,
      (SELECT COUNT(*) FROM public.workforce_time_corrections WHERE client_id = ${clientId}::uuid AND status = 'pending')::int AS pending_time_corrections,
      (SELECT COUNT(*) FROM public.leave_requests WHERE client_id = ${clientId}::uuid AND status = 'pending')::int AS pending_leave_requests,
      (SELECT COUNT(*) FROM public.workforce_payslips WHERE client_id = ${clientId}::uuid AND status = 'draft')::int AS draft_payslips,
      (SELECT COUNT(*) FROM public.workforce_compliance_tasks WHERE client_id = ${clientId}::uuid AND status IN ('pending','overdue'))::int AS open_compliance_tasks
  ` as Array<Record<string, number>>;
  return rows[0] ?? {};
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const live = await metrics(a.ctx.clientId);
  const snapshots = await db()`
    SELECT id, to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_date, metrics, created_by, created_at
    FROM public.workforce_dashboard_snapshots
    WHERE client_id = ${a.ctx.clientId}::uuid
    ORDER BY snapshot_date DESC
    LIMIT 30
  ` as unknown[];
  return jsonOk({ metrics: live, snapshots });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.create']);
  if (!a.ok) return a.res;

  const body = await readJson(req);
  if (body instanceof Response) return body;
  const snapshotDate = dateOrToday(stringField(body, 'snapshot_date') || null);
  const metricJson = body.metrics && typeof body.metrics === 'object' ? jsonBodyField(body, 'metrics') : JSON.stringify(await metrics(a.ctx.clientId));

  const rows = await db()`
    INSERT INTO public.workforce_dashboard_snapshots (client_id, snapshot_date, metrics, created_by)
    VALUES (${a.ctx.clientId}::uuid, ${snapshotDate}::date, ${metricJson}::jsonb, ${a.ctx.userNodeId}::uuid)
    ON CONFLICT (client_id, snapshot_date) DO UPDATE SET metrics = EXCLUDED.metrics, created_by = EXCLUDED.created_by, created_at = now()
    RETURNING id, to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_date, metrics, created_by, created_at
  ` as Array<Record<string, unknown>>;
  return jsonOk({ snapshot: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
