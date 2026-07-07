// /api/workforce/project-docs
//   GET    ?project_id=<uuid> → list files linked to a project (project-service.business.view)
//   POST   { project_id, file_id } → link a file to a project (project-service.business.edit)
//   DELETE { project_id, file_id } → unlink a file from a project (project-service.business.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/project-docs' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) return jsonError(400, 'project_id_required');
  if (!UUID.test(projectId)) return jsonError(400, 'invalid_project_id');

  const sql = db();
  const project = (await sql`
    SELECT id FROM public.projects
    WHERE id = ${projectId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!project.length) return jsonError(404, 'project_not_found');

  const docs = await sql`
    SELECT
      pf.file_id,
      pf.attached_at,
      f.title,
      f.type,
      f.storage_kind,
      f.filename,
      f.mime,
      f.byte_size,
      f.external_url,
      f.tier,
      f.created_at AS file_created_at
    FROM public.project_files pf
    JOIN public.files f ON f.id = pf.file_id
    WHERE pf.project_id = ${projectId}::uuid
      AND f.deleted_at IS NULL
    ORDER BY pf.attached_at DESC
  `;

  return jsonOk({ docs });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.edit']);
  if (!a.ok) return a.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const projectId = typeof body.project_id === 'string' ? body.project_id : null;
  const fileId = typeof body.file_id === 'string' ? body.file_id : null;
  if (!projectId || !fileId) return jsonError(400, 'project_id_and_file_id_required');
  if (!UUID.test(projectId)) return jsonError(400, 'invalid_project_id');
  if (!UUID.test(fileId)) return jsonError(400, 'invalid_file_id');

  const sql = db();

  const project = (await sql`
    SELECT id FROM public.projects
    WHERE id = ${projectId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!project.length) return jsonError(404, 'project_not_found');

  const file = (await sql`
    SELECT id FROM public.files
    WHERE id = ${fileId}::uuid
      AND (client_id = ${a.ctx.clientId}::uuid OR client_id IS NULL)
      AND deleted_at IS NULL
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!file.length) return jsonError(404, 'file_not_found');

  await sql`
    INSERT INTO public.project_files (project_id, file_id, attached_by)
    VALUES (${projectId}::uuid, ${fileId}::uuid, ${a.ctx.userNodeId}::uuid)
    ON CONFLICT DO NOTHING
  `;

  return jsonOk({ linked: true }, { status: 201 });
}

async function handleDelete(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.edit']);
  if (!a.ok) return a.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const projectId = typeof body.project_id === 'string' ? body.project_id : null;
  const fileId = typeof body.file_id === 'string' ? body.file_id : null;
  if (!projectId || !fileId) return jsonError(400, 'project_id_and_file_id_required');
  if (!UUID.test(projectId)) return jsonError(400, 'invalid_project_id');
  if (!UUID.test(fileId)) return jsonError(400, 'invalid_file_id');

  const sql = db();

  const project = (await sql`
    SELECT id FROM public.projects
    WHERE id = ${projectId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!project.length) return jsonError(404, 'project_not_found');

  const deleted = (await sql`
    DELETE FROM public.project_files
    WHERE project_id = ${projectId}::uuid AND file_id = ${fileId}::uuid
    RETURNING project_id
  `) as Array<{ project_id: string }>;
  if (!deleted.length) return jsonError(404, 'link_not_found');

  return new Response(null, { status: 204 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  if (req.method === 'DELETE') return handleDelete(req);
  return jsonError(405, 'method_not_allowed');
}
