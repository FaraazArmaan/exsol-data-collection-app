// /api/workforce/payroll/:id
//   GET    → period detail with line items (workforce.payroll.view)
//   PATCH  → approve period (workforce.payroll.edit)
//   DELETE → hard delete draft period (workforce.payroll.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/payroll/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/\/payroll\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

interface LineItemRow {
  user_node_id: string;
  hours: string | number;
  hourly_rate: string | number | null;
}

async function computeLineItems(
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<Array<{ user_node_id: string; hours: number; hourly_rate: number; amount: number }>> {
  const sql = db();
  const rows = (await sql`
    SELECT
      te.user_node_id,
      SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600)::numeric(10,2) AS hours,
      (
        SELECT pr.hourly_rate
        FROM public.payroll_rates pr
        WHERE pr.client_id = ${clientId}::uuid
          AND pr.user_node_id = te.user_node_id
          AND pr.effective_from <= ${periodStart}::date
        ORDER BY pr.effective_from DESC
        LIMIT 1
      ) AS hourly_rate
    FROM public.timesheet_entries te
    WHERE te.client_id = ${clientId}::uuid
      AND te.entry_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
      AND te.approved_at IS NOT NULL
      AND te.user_node_id IS NOT NULL
    GROUP BY te.user_node_id
  `) as LineItemRow[];

  return rows.map(r => {
    const hours = Number(r.hours);
    const hourlyRate = r.hourly_rate !== null ? Number(r.hourly_rate) : 0;
    return {
      user_node_id: r.user_node_id,
      hours,
      hourly_rate: hourlyRate,
      amount: Math.round(hours * hourlyRate * 100) / 100,
    };
  });
}

async function handleGet(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.view']);
  if (!a.ok) return a.res;

  const sql = db();

  const periodRows = (await sql`
    SELECT
      id,
      to_char(period_start, 'YYYY-MM-DD') AS period_start,
      to_char(period_end,   'YYYY-MM-DD') AS period_end,
      status,
      total_amount,
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
  const line_items = await computeLineItems(
    a.ctx.clientId,
    period.period_start as string,
    period.period_end as string,
  );

  return jsonOk({ period, line_items });
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.edit']);
  if (!a.ok) return a.res;

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

  const { period_start, period_end } = existing[0]!;

  // Compute total from line items.
  const lineItems = await computeLineItems(a.ctx.clientId, period_start, period_end);
  const totalAmount = lineItems.reduce((sum, li) => sum + li.amount, 0);
  const totalRounded = Math.round(totalAmount * 100) / 100;

  const rows = (await sql`
    UPDATE public.payroll_periods
    SET
      status       = 'approved',
      total_amount = ${totalRounded}::numeric,
      approved_by  = ${a.ctx.userNodeId}::uuid,
      approved_at  = now(),
      updated_at   = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING
      id,
      to_char(period_start, 'YYYY-MM-DD') AS period_start,
      to_char(period_end,   'YYYY-MM-DD') AS period_end,
      status,
      total_amount,
      created_by,
      approved_by,
      approved_at,
      created_at
  `) as Array<Record<string, unknown>>;

  if (rows.length === 0) return jsonError(404, 'period_not_found');
  return jsonOk({ period: rows[0] });
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
