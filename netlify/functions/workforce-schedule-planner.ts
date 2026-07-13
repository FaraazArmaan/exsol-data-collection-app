// /api/workforce/schedule-planner
//   GET  → computed daily schedule compliance plan (workforce.employees.view)
//   POST → create a compliance rule (workforce.employees.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { dateOrToday, numberField, readJson, stringField } from './_workforce-depth-utils';

export const config = { path: '/api/workforce/schedule-planner' };

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const planDate = dateOrToday(new URL(req.url).searchParams.get('date'));
  const rows = await db()`
    WITH active_rule AS (
      SELECT *
      FROM public.workforce_compliance_rules
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND active = true
        AND effective_from <= ${planDate}::date
        AND (effective_to IS NULL OR effective_to >= ${planDate}::date)
      ORDER BY effective_from DESC
      LIMIT 1
    ),
    day_shifts AS (
      SELECT s.resource_id, br.name AS resource_name, COUNT(*)::int AS shift_count, COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600), 0)::numeric(8,2) AS scheduled_hours
      FROM public.workforce_shifts s
      JOIN public.booking_resources br ON br.id = s.resource_id
      WHERE s.client_id = ${a.ctx.clientId}::uuid
        AND s.weekday = EXTRACT(DOW FROM ${planDate}::date)::int
      GROUP BY s.resource_id, br.name
    )
    SELECT d.resource_id, d.resource_name, d.shift_count, d.scheduled_hours, r.id AS rule_id, r.name AS rule_name, r.max_daily_hours, (r.max_daily_hours IS NOT NULL AND d.scheduled_hours > r.max_daily_hours) AS max_daily_hours_exceeded
    FROM day_shifts d
    LEFT JOIN active_rule r ON true
    ORDER BY d.resource_name
  ` as unknown[];

  const storedFindings = await db()`
    SELECT id, resource_id, finding_type, severity, status, details, created_at
    FROM public.workforce_schedule_compliance_findings
    WHERE client_id = ${a.ctx.clientId}::uuid AND schedule_date = ${planDate}::date
    ORDER BY created_at DESC
  ` as unknown[];

  return jsonOk({ date: planDate, plans: rows, findings: storedFindings });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;

  const body = await readJson(req);
  if (body instanceof Response) return body;

  const name = stringField(body, 'name');
  if (!name) return jsonError(400, 'name_required');

  const rows = await db()`
    INSERT INTO public.workforce_compliance_rules (
      client_id, name, max_daily_hours, max_weekly_hours, break_required_after_hours,
      min_break_minutes, effective_from
    )
    VALUES (
      ${a.ctx.clientId}::uuid,
      ${name}::text,
      ${numberField(body, 'max_daily_hours')}::numeric,
      ${numberField(body, 'max_weekly_hours')}::numeric,
      ${numberField(body, 'break_required_after_hours')}::numeric,
      ${numberField(body, 'min_break_minutes')}::int,
      COALESCE(NULLIF(${stringField(body, 'effective_from')}::text, '')::date, CURRENT_DATE)
    )
    RETURNING *
  ` as Array<Record<string, unknown>>;
  return jsonOk({ rule: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
