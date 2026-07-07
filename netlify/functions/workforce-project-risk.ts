// /api/workforce/project-risk/:id
//   GET → compute risk summary for a project
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/project-risk/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/project-risk\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

async function handleGet(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.view']);
  if (!a.ok) return a.res;

  const { clientId } = a.ctx;
  const sql = db();

  const [projectRows, taskRows, timesheetRows, assignmentRows] = (await Promise.all([
    sql`
      SELECT id, name, status, budget_cents, hourly_rate_cents
      FROM public.projects
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      LIMIT 1
    `,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE status != 'done' AND due_date < CURRENT_DATE) AS overdue_count,
        COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')) AS open_count,
        COUNT(*) AS total_count
      FROM public.project_tasks
      WHERE project_id = ${id}::uuid AND client_id = ${clientId}::uuid
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
      SELECT COUNT(*) AS assignment_count FROM public.project_assignments
      WHERE project_id = ${id}::uuid
    `,
  ])) as [
    Array<Record<string, unknown>>,
    Array<{ overdue_count: string; open_count: string; total_count: string }>,
    Array<{ total_hours: string }>,
    Array<{ assignment_count: string }>,
  ];

  if (!projectRows.length) return jsonError(404, 'project_not_found');

  const project = projectRows[0]!;
  const taskStats = taskRows[0]!;
  const totalHours = Number(timesheetRows[0]!.total_hours);
  const assignmentCount = Number(assignmentRows[0]!.assignment_count);

  const overdueCount = Number(taskStats.overdue_count);
  const openCount = Number(taskStats.open_count);
  const totalTasks = Number(taskStats.total_count);

  const hourlyRate = Number(project.hourly_rate_cents ?? 0);
  const timesheetCostCents = Math.round(totalHours * hourlyRate);
  const budgetCents = project.budget_cents ? Number(project.budget_cents) : null;
  const burnPct = budgetCents && budgetCents > 0
    ? Math.round((timesheetCostCents / budgetCents) * 100) : null;

  const budgetOverrun = burnPct !== null && burnPct > 100;
  const unstaffed = project.status === 'active' && assignmentCount === 0;

  let healthScore = 100;
  if (overdueCount > 0) healthScore -= Math.min(overdueCount * 10, 30);
  if (budgetOverrun) healthScore -= 30;
  if (unstaffed) healthScore -= 20;
  if (burnPct !== null && burnPct > 80 && !budgetOverrun) healthScore -= 10;
  healthScore = Math.max(0, healthScore);

  const flags: string[] = [];
  if (overdueCount > 0) flags.push(`${overdueCount} overdue task${overdueCount > 1 ? 's' : ''}`);
  if (budgetOverrun) flags.push('budget overrun');
  if (unstaffed) flags.push('no staff assigned');
  if (burnPct !== null && burnPct > 80 && !budgetOverrun) flags.push('approaching budget limit');

  return jsonOk({
    risk: {
      project_id: id,
      project_name: project.name,
      project_status: project.status,
      health_score: healthScore,
      flags,
      overdue_count: overdueCount,
      open_count: openCount,
      total_tasks: totalTasks,
      assignment_count: assignmentCount,
      unstaffed,
      budget_overrun: budgetOverrun,
      burn_pct: burnPct,
      total_hours: totalHours,
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  if (req.method === 'GET') return handleGet(req, id);
  return jsonError(405, 'method_not_allowed');
}
