// /api/workforce/leave-accrual
//   GET  → policies, holidays, ledger (workforce.leave.view)
//   POST → create policy/holiday/ledger entry (workforce.leave.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { booleanField, nullableStringField, numberField, optionalUuidField, optionalUuidParam, readJson, resourceExists, stringField } from './_workforce-depth-utils';

export const config = { path: '/api/workforce/leave-accrual' };

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.leave.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const resourceId = optionalUuidParam(url.searchParams.get('resource_id'), 'resource_id');
  if (resourceId instanceof Response) return resourceId;
  const sql = db();
  const policies = await sql`
    SELECT *
    FROM public.workforce_leave_policies
    WHERE client_id = ${a.ctx.clientId}::uuid
    ORDER BY active DESC, leave_type, effective_from DESC
  ` as unknown[];
  const holidays = await sql`
    SELECT id, name, to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, region, paid, created_at
    FROM public.workforce_holidays
    WHERE client_id = ${a.ctx.clientId}::uuid
    ORDER BY holiday_date DESC
    LIMIT 100
  ` as unknown[];
  const ledger = await sql`
    SELECT id, resource_id, leave_type, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, entry_type, days_delta, request_id, notes, created_by, created_at
    FROM public.workforce_leave_ledger
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND (${resourceId}::uuid IS NULL OR resource_id = ${resourceId}::uuid)
    ORDER BY entry_date DESC, created_at DESC
    LIMIT 200
  ` as unknown[];
  return jsonOk({ policies, holidays, ledger });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.leave.create']);
  if (!a.ok) return a.res;

  const body = await readJson(req);
  if (body instanceof Response) return body;
  const kind = stringField(body, 'kind');
  const sql = db();

  if (kind === 'policy') {
    const leaveType = stringField(body, 'leave_type');
    if (!leaveType) return jsonError(400, 'leave_type_required');
    const rows = await sql`
      INSERT INTO public.workforce_leave_policies (
        client_id, leave_type, accrual_rate_days, accrual_period, carryover_cap_days, effective_from
      )
      VALUES (
        ${a.ctx.clientId}::uuid,
        ${leaveType}::text,
        COALESCE(${numberField(body, 'accrual_rate_days')}::numeric, 0),
        COALESCE(NULLIF(${stringField(body, 'accrual_period')}::text, ''), 'monthly'),
        ${numberField(body, 'carryover_cap_days')}::numeric,
        COALESCE(NULLIF(${stringField(body, 'effective_from')}::text, '')::date, CURRENT_DATE)
      )
      RETURNING *
    ` as Array<Record<string, unknown>>;
    return jsonOk({ policy: rows[0] }, { status: 201 });
  }

  if (kind === 'holiday') {
    const name = stringField(body, 'name');
    const holidayDate = stringField(body, 'holiday_date');
    if (!name) return jsonError(400, 'name_required');
    if (!holidayDate) return jsonError(400, 'holiday_date_required');
    const rows = await sql`
      INSERT INTO public.workforce_holidays (client_id, name, holiday_date, region, paid)
      VALUES (${a.ctx.clientId}::uuid, ${name}::text, ${holidayDate}::date, ${nullableStringField(body, 'region')}::text, ${booleanField(body, 'paid', true)}::boolean)
      ON CONFLICT (client_id, holiday_date, name) DO UPDATE SET region = EXCLUDED.region, paid = EXCLUDED.paid
      RETURNING id, name, to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, region, paid, created_at
    ` as Array<Record<string, unknown>>;
    return jsonOk({ holiday: rows[0] }, { status: 201 });
  }

  if (kind === 'ledger') {
    const resourceId = stringField(body, 'resource_id');
    const leaveType = stringField(body, 'leave_type');
    const entryType = stringField(body, 'entry_type');
    const daysDelta = numberField(body, 'days_delta');
    if (!resourceId) return jsonError(400, 'resource_id_required');
    if (!(await resourceExists(a.ctx.clientId, resourceId))) return jsonError(404, 'resource_not_found');
    if (!leaveType) return jsonError(400, 'leave_type_required');
    if (!entryType) return jsonError(400, 'entry_type_required');
    if (daysDelta === null) return jsonError(400, 'days_delta_required');
    const requestId = optionalUuidField(body, 'request_id');
    if (requestId instanceof Response) return requestId;
    const rows = await sql`
      INSERT INTO public.workforce_leave_ledger (
        client_id, resource_id, leave_type, entry_date, entry_type, days_delta, request_id, notes, created_by
      )
      VALUES (
        ${a.ctx.clientId}::uuid,
        ${resourceId}::uuid,
        ${leaveType}::text,
        COALESCE(NULLIF(${stringField(body, 'entry_date')}::text, '')::date, CURRENT_DATE),
        ${entryType}::text,
        ${daysDelta}::numeric,
        ${requestId}::uuid,
        ${nullableStringField(body, 'notes')}::text,
        ${a.ctx.userNodeId}::uuid
      )
      RETURNING id, resource_id, leave_type, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, entry_type, days_delta, request_id, notes, created_by, created_at
    ` as Array<Record<string, unknown>>;
    await sql`
      INSERT INTO public.leave_balances (client_id, resource_id, leave_type, balance_days)
      VALUES (${a.ctx.clientId}::uuid, ${resourceId}::uuid, ${leaveType}::text, GREATEST(${daysDelta}::numeric, 0))
      ON CONFLICT (client_id, resource_id, leave_type) DO UPDATE SET balance_days = GREATEST(public.leave_balances.balance_days + ${daysDelta}::numeric, 0), updated_at = now()
    `;
    return jsonOk({ entry: rows[0] }, { status: 201 });
  }

  return jsonError(400, 'kind_invalid');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
