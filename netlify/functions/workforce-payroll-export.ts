// /api/workforce/payroll-export
//   GET  → list payroll exports and payslips (workforce.payroll.view)
//   POST → generate export and draft payslips for a period (workforce.payroll.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { jsonBodyField, optionalUuidParam, readJson, stringField } from './_workforce-depth-utils';

export const config = { path: '/api/workforce/payroll-export' };

interface LineRow {
  user_node_id: string;
  hours: string | number;
  hourly_rate: string | number | null;
}

async function lineItems(clientId: string, periodStart: string, periodEnd: string): Promise<Array<{ user_node_id: string; amount: number }>> {
  const rows = await db()`
    SELECT te.user_node_id, SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600)::numeric(10,2) AS hours, (
      SELECT pr.hourly_rate
      FROM public.payroll_rates pr
      WHERE pr.client_id = ${clientId}::uuid AND pr.user_node_id = te.user_node_id AND pr.effective_from <= ${periodStart}::date
      ORDER BY pr.effective_from DESC
      LIMIT 1
    ) AS hourly_rate
    FROM public.timesheet_entries te
    WHERE te.client_id = ${clientId}::uuid
      AND te.entry_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
      AND te.approved_at IS NOT NULL
      AND te.user_node_id IS NOT NULL
    GROUP BY te.user_node_id
  ` as LineRow[];
  return rows.map(row => {
    const rate = row.hourly_rate === null ? 0 : Number(row.hourly_rate);
    return { user_node_id: row.user_node_id, amount: Math.round(Number(row.hours) * rate * 100) / 100 };
  });
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.view']);
  if (!a.ok) return a.res;

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
  return jsonOk({ exports, payslips });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.create']);
  if (!a.ok) return a.res;

  const body = await readJson(req);
  if (body instanceof Response) return body;
  const periodId = stringField(body, 'period_id');
  if (!periodId) return jsonError(400, 'period_id_required');

  const sql = db();
  const periods = await sql`
    SELECT id, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end
    FROM public.payroll_periods
    WHERE id = ${periodId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  ` as Array<{ id: string; period_start: string; period_end: string }>;
  if (periods.length === 0) return jsonError(404, 'period_not_found');

  const items = await lineItems(a.ctx.clientId, periods[0]!.period_start, periods[0]!.period_end);
  const total = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  const exportRows = await sql`
    INSERT INTO public.workforce_payroll_exports (client_id, period_id, export_format, status, total_amount, exported_by, exported_at, metadata)
    VALUES (${a.ctx.clientId}::uuid, ${periodId}::uuid, COALESCE(NULLIF(${stringField(body, 'export_format')}::text, ''), 'csv'), 'generated', ${total}::numeric, ${a.ctx.userNodeId}::uuid, now(), ${jsonBodyField(body, 'metadata')}::jsonb)
    RETURNING *
  ` as Array<Record<string, unknown>>;
  const exportId = exportRows[0]!.id as string;

  const payslips: unknown[] = [];
  for (const item of items) {
    const rows = await sql`
      INSERT INTO public.workforce_payslips (client_id, export_id, period_id, user_node_id, gross_amount, net_amount)
      VALUES (${a.ctx.clientId}::uuid, ${exportId}::uuid, ${periodId}::uuid, ${item.user_node_id}::uuid, ${item.amount}::numeric, ${item.amount}::numeric)
      ON CONFLICT (client_id, period_id, user_node_id) DO UPDATE SET export_id = EXCLUDED.export_id, gross_amount = EXCLUDED.gross_amount, net_amount = EXCLUDED.net_amount, updated_at = now()
      RETURNING *
    ` as unknown[];
    payslips.push(rows[0]);
  }

  return jsonOk({ export: exportRows[0], payslips }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
