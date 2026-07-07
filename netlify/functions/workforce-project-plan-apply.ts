// /api/workforce/project-plan-apply
//   POST { plan_id, task_indices? } → convert selected draft tasks into real project_tasks
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/project-plan-apply' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DraftTask {
  title: string;
  description: string | null;
  due_date: string | null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforce(req, ['project-service.business.edit']);
  if (!a.ok) return a.res;

  const { clientId } = a.ctx;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const planId = typeof body.plan_id === 'string' ? body.plan_id.trim() : '';
  if (!planId || !UUID.test(planId)) return jsonError(400, 'invalid_plan_id');

  const taskIndicesRaw = body.task_indices;
  const taskIndices: number[] | null =
    Array.isArray(taskIndicesRaw) && taskIndicesRaw.length > 0
      ? (taskIndicesRaw as unknown[]).filter((x) => typeof x === 'number').map(Number)
      : null;

  const sql = db();

  const planRows = (await sql`
    SELECT p.id, p.project_id, p.draft_tasks, p.client_id
    FROM public.project_ai_plans p
    JOIN public.projects proj ON proj.id = p.project_id
    WHERE p.id = ${planId}::uuid AND proj.client_id = ${clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; project_id: string; draft_tasks: DraftTask[]; client_id: string }>;

  if (!planRows.length) return jsonError(404, 'plan_not_found');

  const plan = planRows[0]!;
  const allTasks = plan.draft_tasks as DraftTask[];

  const selectedTasks = taskIndices !== null
    ? allTasks.filter((_, i) => taskIndices.includes(i))
    : allTasks;

  let applied = 0;
  for (const t of selectedTasks) {
    const title = String(t.title).slice(0, 80);
    const description = typeof t.description === 'string' ? t.description : null;
    const dueDate = typeof t.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : null;

    if (dueDate) {
      await sql`
        INSERT INTO public.project_tasks (client_id, project_id, title, description, status, due_date)
        VALUES (${clientId}::uuid, ${plan.project_id}::uuid, ${title}::text, ${description}::text, 'open'::text, ${dueDate}::date)
      `;
    } else {
      await sql`
        INSERT INTO public.project_tasks (client_id, project_id, title, description, status)
        VALUES (${clientId}::uuid, ${plan.project_id}::uuid, ${title}::text, ${description}::text, 'open'::text)
      `;
    }
    applied += 1;
  }

  return jsonOk({ applied });
}
