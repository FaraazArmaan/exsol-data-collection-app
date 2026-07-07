// /api/workforce/project-plan
//   POST { project_id, description } → generate AI draft plan (persisted)
//   GET  ?project_id=<uuid>          → list saved plans (most recent first)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { ask } from './_shared/ai';

export const config = { path: '/api/workforce/project-plan' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DraftTask {
  title: string;
  description: string | null;
  due_date: string | null;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.view']);
  if (!a.ok) return a.res;

  const { clientId } = a.ctx;
  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');

  if (!projectId || !UUID.test(projectId)) return jsonError(400, 'invalid_project_id');

  const sql = db();

  const projectRows = (await sql`
    SELECT id FROM public.projects
    WHERE id = ${projectId}::uuid AND client_id = ${clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!projectRows.length) return jsonError(404, 'project_not_found');

  const plans = await sql`
    SELECT id, project_id, prompt_text, draft_tasks, created_at
    FROM public.project_ai_plans
    WHERE project_id = ${projectId}::uuid AND client_id = ${clientId}::uuid
    ORDER BY created_at DESC
    LIMIT 10
  `;

  return jsonOk({ plans });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.edit']);
  if (!a.ok) return a.res;

  const { clientId, userNodeId } = a.ctx;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!projectId || !UUID.test(projectId)) return jsonError(400, 'invalid_project_id');
  if (!description) return jsonError(400, 'description_required');
  if (description.length > 2000) return jsonError(400, 'description_too_long');

  const sql = db();

  const projectRows = (await sql`
    SELECT id, name FROM public.projects
    WHERE id = ${projectId}::uuid AND client_id = ${clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; name: string }>;
  if (!projectRows.length) return jsonError(404, 'project_not_found');

  const project = projectRows[0]!;

  const existingTasks = (await sql`
    SELECT title, status FROM public.project_tasks
    WHERE project_id = ${projectId}::uuid AND client_id = ${clientId}::uuid
    ORDER BY created_at ASC
  `) as Array<{ title: string; status: string }>;

  const existingTasksSummary = existingTasks.length > 0
    ? `Existing tasks:\n${existingTasks.map((t) => `- ${t.title} (${t.status})`).join('\n')}`
    : 'No tasks yet.';

  const prompt = `Project: "${project.name}"
Description: ${description}
${existingTasksSummary}

Generate a task plan for this project. Return ONLY a JSON array of task objects, no prose:
[{"title":"...", "description":"...", "due_date":"YYYY-MM-DD or null"}]
Produce 3–8 tasks. Keep titles under 80 characters. due_date should be realistic (within 90 days from today). Return only valid JSON, nothing else.`;

  const system = 'You are a project planning assistant. You output only JSON arrays of task objects. No explanation, no markdown, no prose — only the raw JSON array.';

  const result = await ask({ system, prompt, maxTokens: 1000 });

  let draftTasks: DraftTask[] = [];
  try {
    const cleaned = result.text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned) as unknown;
    if (Array.isArray(parsed)) {
      draftTasks = (parsed as DraftTask[])
        .filter((t) => typeof t.title === 'string' && t.title.trim())
        .slice(0, 10)
        .map((t) => ({
          title: String(t.title).slice(0, 80),
          description: typeof t.description === 'string' ? t.description.slice(0, 500) : null,
          due_date: typeof t.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : null,
        }));
    }
  } catch {
    // fallback: return a generic plan
    draftTasks = [
      { title: 'Define project scope and requirements', description: null, due_date: null },
      { title: 'Create project timeline', description: null, due_date: null },
      { title: 'Assign team resources', description: null, due_date: null },
      { title: 'Execute and review milestones', description: null, due_date: null },
      { title: 'Project delivery and sign-off', description: null, due_date: null },
    ];
  }

  // Clamp to at least 1 task
  if (draftTasks.length === 0) {
    draftTasks = [{ title: 'Review project requirements', description: null, due_date: null }];
  }

  const rows = (await sql`
    INSERT INTO public.project_ai_plans
      (client_id, project_id, prompt_text, draft_tasks, generated_by)
    VALUES
      (${clientId}::uuid, ${projectId}::uuid, ${description}::text, ${JSON.stringify(draftTasks)}::jsonb, ${userNodeId}::uuid)
    RETURNING id, project_id, draft_tasks, created_at
  `) as Array<{ id: string; project_id: string; draft_tasks: DraftTask[]; created_at: string }>;

  const plan = { ...rows[0]!, fallback: result.fallback };
  return new Response(JSON.stringify({ plan }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
