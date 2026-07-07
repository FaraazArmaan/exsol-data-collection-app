// /api/workforce/project-tasks
//   GET  ?project_id=<uuid>&status=<open|in_progress|done> → list tasks
//   POST { project_id, title, description?, assigned_to?, due_date?, status? } → create task
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/project-tasks' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.view']);
  if (!a.ok) return a.res;

  const { clientId } = a.ctx;
  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  const status = url.searchParams.get('status') ?? null;

  if (!projectId || !UUID.test(projectId)) return jsonError(400, 'invalid_project_id');

  const sql = db();

  const projectRows = (await sql`
    SELECT id FROM public.projects
    WHERE id = ${projectId}::uuid AND client_id = ${clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!projectRows.length) return jsonError(404, 'project_not_found');

  const tasks = await sql`
    SELECT
      pt.id,
      pt.project_id,
      pt.title,
      pt.description,
      pt.assigned_to,
      br.name AS assigned_name,
      pt.status,
      to_char(pt.due_date, 'YYYY-MM-DD') AS due_date,
      pt.created_at,
      pt.updated_at
    FROM public.project_tasks pt
    LEFT JOIN public.booking_resources br ON br.id = pt.assigned_to
    WHERE pt.project_id = ${projectId}::uuid
      AND pt.client_id = ${clientId}::uuid
      AND (${status}::text IS NULL OR pt.status = ${status}::text)
    ORDER BY pt.due_date ASC NULLS LAST, pt.created_at ASC
  `;

  return jsonOk({ tasks });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.edit']);
  if (!a.ok) return a.res;

  const { clientId } = a.ctx;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!projectId || !UUID.test(projectId)) return jsonError(400, 'invalid_project_id');
  if (!title) return jsonError(400, 'title_required');

  const sql = db();

  const projectRows = (await sql`
    SELECT id FROM public.projects
    WHERE id = ${projectId}::uuid AND client_id = ${clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!projectRows.length) return jsonError(404, 'project_not_found');

  const description = typeof body.description === 'string' ? body.description : null;
  const assignedTo = typeof body.assigned_to === 'string' && UUID.test(body.assigned_to) ? body.assigned_to : null;
  const dueDate = typeof body.due_date === 'string' && DATE_RE.test(body.due_date) ? body.due_date : null;
  const status = typeof body.status === 'string' &&
    ['open', 'in_progress', 'done'].includes(body.status)
    ? body.status : 'open';

  if (assignedTo) {
    const resourceRows = (await sql`
      SELECT id FROM public.booking_resources
      WHERE id = ${assignedTo}::uuid AND bucket_id = ${clientId}::uuid
      LIMIT 1
    `) as Array<{ id: string }>;
    if (!resourceRows.length) return jsonError(400, 'invalid_assigned_to');
  }

  let rows: Array<Record<string, unknown>>;
  if (assignedTo && dueDate) {
    rows = (await sql`
      INSERT INTO public.project_tasks (client_id, project_id, title, description, assigned_to, status, due_date)
      VALUES (${clientId}::uuid, ${projectId}::uuid, ${title}::text, ${description}::text, ${assignedTo}::uuid, ${status}::text, ${dueDate}::date)
      RETURNING id, project_id, title, description, assigned_to, status,
        to_char(due_date, 'YYYY-MM-DD') AS due_date, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else if (assignedTo) {
    rows = (await sql`
      INSERT INTO public.project_tasks (client_id, project_id, title, description, assigned_to, status)
      VALUES (${clientId}::uuid, ${projectId}::uuid, ${title}::text, ${description}::text, ${assignedTo}::uuid, ${status}::text)
      RETURNING id, project_id, title, description, assigned_to, status,
        to_char(due_date, 'YYYY-MM-DD') AS due_date, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else if (dueDate) {
    rows = (await sql`
      INSERT INTO public.project_tasks (client_id, project_id, title, description, status, due_date)
      VALUES (${clientId}::uuid, ${projectId}::uuid, ${title}::text, ${description}::text, ${status}::text, ${dueDate}::date)
      RETURNING id, project_id, title, description, assigned_to, status,
        to_char(due_date, 'YYYY-MM-DD') AS due_date, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else {
    rows = (await sql`
      INSERT INTO public.project_tasks (client_id, project_id, title, description, status)
      VALUES (${clientId}::uuid, ${projectId}::uuid, ${title}::text, ${description}::text, ${status}::text)
      RETURNING id, project_id, title, description, assigned_to, status,
        to_char(due_date, 'YYYY-MM-DD') AS due_date, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  }

  return new Response(JSON.stringify({ task: rows[0] }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
