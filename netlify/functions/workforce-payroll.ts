// /api/workforce/payroll
//   GET  → list payroll periods (workforce.payroll.view)
//   POST → create a payroll period (workforce.payroll.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/payroll' };

interface CreatePeriodBody {
  period_start?: unknown;
  period_end?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const sql = db();

  const periods = (await sql`
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
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND (${status}::text IS NULL OR status = ${status}::text)
    ORDER BY period_start DESC, created_at DESC
  `) as unknown[];

  return jsonOk({ periods });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.create']);
  if (!a.ok) return a.res;

  let body: CreatePeriodBody;
  try {
    body = (await req.json()) as CreatePeriodBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const periodStart = typeof body.period_start === 'string' ? body.period_start.trim() : '';
  if (!periodStart) return jsonError(400, 'period_start_required');

  const periodEnd = typeof body.period_end === 'string' ? body.period_end.trim() : '';
  if (!periodEnd) return jsonError(400, 'period_end_required');

  if (periodEnd < periodStart) return jsonError(400, 'period_end_before_start');

  const sql = db();

  try {
    const rows = (await sql`
      INSERT INTO public.payroll_periods
        (client_id, period_start, period_end, created_by)
      VALUES
        (${a.ctx.clientId}::uuid, ${periodStart}::date, ${periodEnd}::date, ${a.ctx.userNodeId}::uuid)
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

    return jsonOk({ period: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') return jsonError(409, 'period_exists');
    throw err;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
