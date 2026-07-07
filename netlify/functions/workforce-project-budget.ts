// /api/workforce/project-budget/:id
//   GET   → budget summary: timesheet cost + expenses vs budget (project-service.business.view)
//   PATCH { budget_cents?, hourly_rate_cents? } → set budget/rate (project-service.business.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/project-budget/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/workforce\/project-budget\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

async function handleGet(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.view']);
  if (!a.ok) return a.res;

  const { clientId } = a.ctx;
  const sql = db();

  const [projectRows, timesheetRows, expenseRows] = (await Promise.all([
    sql`
      SELECT id, name, status, budget_cents, hourly_rate_cents
      FROM public.projects
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      LIMIT 1
    `,
    sql`
      SELECT COALESCE(SUM(
        EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600
      ), 0)::numeric(12,2) AS total_hours
      FROM public.timesheet_entries te
      WHERE te.client_id = ${clientId}::uuid
        AND te.approved_at IS NOT NULL
        AND te.resource_id IN (
          SELECT resource_id FROM public.project_assignments
          WHERE project_id = ${id}::uuid
        )
    `,
    sql`
      SELECT COALESCE(SUM(amount_cents), 0) AS expense_cents, COUNT(*) AS expense_count
      FROM public.finance_expenses
      WHERE project_id = ${id}::uuid AND client_id = ${clientId}::uuid
    `,
  ])) as [
    Array<Record<string, unknown>>,
    Array<{ total_hours: string }>,
    Array<{ expense_cents: string; expense_count: string }>,
  ];

  if (!projectRows.length) return jsonError(404, 'project_not_found');

  const project = projectRows[0]!;
  const timesheetRow = timesheetRows[0]!;
  const expenseRow = expenseRows[0]!;

  const totalHours = Number(timesheetRow.total_hours);
  const hourlyRate = Number(project.hourly_rate_cents ?? 0);
  const timesheetCostCents = Math.round(totalHours * hourlyRate);
  const expenseCents = Number(expenseRow.expense_cents);
  const totalSpentCents = timesheetCostCents + expenseCents;
  const budgetCents = project.budget_cents ? Number(project.budget_cents) : null;
  const burnPct =
    budgetCents && budgetCents > 0
      ? Math.round((totalSpentCents / budgetCents) * 100)
      : null;

  return jsonOk({
    budget: {
      budget_cents: budgetCents,
      hourly_rate_cents: project.hourly_rate_cents ? Number(project.hourly_rate_cents) : null,
      total_hours: totalHours,
      timesheet_cost_cents: timesheetCostCents,
      expense_cents: expenseCents,
      total_spent_cents: totalSpentCents,
      burn_pct: burnPct,
      expense_count: Number(expenseRow.expense_count),
    },
  });
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.edit']);
  if (!a.ok) return a.res;

  const { clientId } = a.ctx;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const hasBudget = 'budget_cents' in body;
  const hasRate = 'hourly_rate_cents' in body;

  if (hasBudget && body.budget_cents !== null) {
    const v = body.budget_cents;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return jsonError(400, 'invalid_budget_cents');
    }
  }
  if (hasRate && body.hourly_rate_cents !== null) {
    const v = body.hourly_rate_cents;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return jsonError(400, 'invalid_hourly_rate_cents');
    }
  }

  const sql = db();

  // Build update with explicit null handling
  const budgetVal = hasBudget
    ? body.budget_cents === null
      ? null
      : (body.budget_cents as number)
    : undefined;
  const rateVal = hasRate
    ? body.hourly_rate_cents === null
      ? null
      : (body.hourly_rate_cents as number)
    : undefined;

  let updated: Array<Record<string, unknown>>;
  if (budgetVal !== undefined && rateVal !== undefined) {
    updated = (await sql`
      UPDATE public.projects
      SET budget_cents = ${budgetVal}::bigint,
          hourly_rate_cents = ${rateVal}::bigint,
          updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      RETURNING id, name, budget_cents, hourly_rate_cents, updated_at
    `) as Array<Record<string, unknown>>;
  } else if (budgetVal !== undefined) {
    updated = (await sql`
      UPDATE public.projects
      SET budget_cents = ${budgetVal}::bigint,
          updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      RETURNING id, name, budget_cents, hourly_rate_cents, updated_at
    `) as Array<Record<string, unknown>>;
  } else if (rateVal !== undefined) {
    updated = (await sql`
      UPDATE public.projects
      SET hourly_rate_cents = ${rateVal}::bigint,
          updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      RETURNING id, name, budget_cents, hourly_rate_cents, updated_at
    `) as Array<Record<string, unknown>>;
  } else {
    // Nothing to update — fetch current state
    updated = (await sql`
      SELECT id, name, budget_cents, hourly_rate_cents, updated_at
      FROM public.projects
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      LIMIT 1
    `) as Array<Record<string, unknown>>;
  }

  if (!updated.length) return jsonError(404, 'project_not_found');
  return jsonOk({ project: updated[0] });
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  if (req.method === 'GET') return handleGet(req, id);
  if (req.method === 'PATCH') return handlePatch(req, id);
  return jsonError(405, 'method_not_allowed');
}
