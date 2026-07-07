// /api/workforce/project-task/:id
//   PATCH { title?, description?, assigned_to?, due_date?, status? } → update task
//   DELETE → hard delete task
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/project-task/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/project-task\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
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

  const sql = db();

  const existing = (await sql`
    SELECT id, title, description, assigned_to, status,
      to_char(due_date, 'YYYY-MM-DD') AS due_date
    FROM public.project_tasks
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  if (!existing.length) return jsonError(404, 'task_not_found');

  const row = existing[0]!;

  const newTitle = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim() : (row.title as string);
  const newDesc = 'description' in body
    ? (body.description as string | null ?? null)
    : (row.description as string | null);
  const newStatus = typeof body.status === 'string' &&
    ['open', 'in_progress', 'done'].includes(body.status)
    ? body.status : (row.status as string);
  const newAssigned = 'assigned_to' in body
    ? (typeof body.assigned_to === 'string' && UUID.test(body.assigned_to) ? body.assigned_to : null)
    : (row.assigned_to as string | null);
  const newDue = 'due_date' in body
    ? (typeof body.due_date === 'string' && DATE_RE.test(body.due_date) ? body.due_date : null)
    : (row.due_date as string | null);

  let updated: Array<Record<string, unknown>>;
  if (newAssigned && newDue) {
    updated = (await sql`
      UPDATE public.project_tasks
      SET title = ${newTitle}::text,
          description = ${newDesc}::text,
          assigned_to = ${newAssigned}::uuid,
          due_date = ${newDue}::date,
          status = ${newStatus}::text,
          updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      RETURNING id, project_id, title, description, assigned_to, status,
        to_char(due_date, 'YYYY-MM-DD') AS due_date, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else if (newAssigned) {
    updated = (await sql`
      UPDATE public.project_tasks
      SET title = ${newTitle}::text,
          description = ${newDesc}::text,
          assigned_to = ${newAssigned}::uuid,
          due_date = NULL,
          status = ${newStatus}::text,
          updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      RETURNING id, project_id, title, description, assigned_to, status,
        to_char(due_date, 'YYYY-MM-DD') AS due_date, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else if (newDue) {
    updated = (await sql`
      UPDATE public.project_tasks
      SET title = ${newTitle}::text,
          description = ${newDesc}::text,
          assigned_to = NULL,
          due_date = ${newDue}::date,
          status = ${newStatus}::text,
          updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      RETURNING id, project_id, title, description, assigned_to, status,
        to_char(due_date, 'YYYY-MM-DD') AS due_date, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else {
    updated = (await sql`
      UPDATE public.project_tasks
      SET title = ${newTitle}::text,
          description = ${newDesc}::text,
          assigned_to = NULL,
          due_date = NULL,
          status = ${newStatus}::text,
          updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      RETURNING id, project_id, title, description, assigned_to, status,
        to_char(due_date, 'YYYY-MM-DD') AS due_date, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  }

  if (!updated.length) return jsonError(404, 'task_not_found');
  return jsonOk({ task: updated[0] });
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.edit']);
  if (!a.ok) return a.res;

  const { clientId } = a.ctx;
  const sql = db();

  const deleted = (await sql`
    DELETE FROM public.project_tasks
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
    RETURNING id
  `) as Array<{ id: string }>;

  if (!deleted.length) return jsonError(404, 'task_not_found');
  return new Response(null, { status: 204 });
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  if (req.method === 'PATCH') return handlePatch(req, id);
  if (req.method === 'DELETE') return handleDelete(req, id);
  return jsonError(405, 'method_not_allowed');
}
