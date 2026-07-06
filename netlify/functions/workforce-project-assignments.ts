// /api/workforce/project-assignments
//   POST   { project_id, resource_id } → assign resource to project (project-service.business.edit)
//   DELETE { project_id, resource_id } → unassign (project-service.business.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/project-assignments' };

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.edit']);
  if (!a.ok) return a.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
  const resourceId = typeof body.resource_id === 'string' ? body.resource_id.trim() : '';
  if (!projectId) return jsonError(400, 'project_id_required');
  if (!resourceId) return jsonError(400, 'resource_id_required');

  const sql = db();

  // Verify the project belongs to this client.
  const proj = (await sql`
    SELECT id FROM public.projects
    WHERE id = ${projectId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!proj.length) return jsonError(404, 'project_not_found');

  // Verify the resource belongs to this client.
  const res = (await sql`
    SELECT id FROM public.booking_resources
    WHERE id = ${resourceId}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!res.length) return jsonError(404, 'resource_not_found');

  try {
    await sql`
      INSERT INTO public.project_assignments (project_id, resource_id)
      VALUES (${projectId}::uuid, ${resourceId}::uuid)
    `;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return jsonError(409, 'already_assigned');
    throw e;
  }
  return jsonOk({ assigned: true }, { status: 201 });
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

  const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
  const resourceId = typeof body.resource_id === 'string' ? body.resource_id.trim() : '';
  if (!projectId) return jsonError(400, 'project_id_required');
  if (!resourceId) return jsonError(400, 'resource_id_required');

  const sql = db();

  // Ensure the project belongs to this client (prevents cross-client unassign).
  const proj = (await sql`
    SELECT id FROM public.projects
    WHERE id = ${projectId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!proj.length) return jsonError(404, 'project_not_found');

  const rows = (await sql`
    DELETE FROM public.project_assignments
    WHERE project_id = ${projectId}::uuid AND resource_id = ${resourceId}::uuid
    RETURNING project_id
  `) as Array<{ project_id: string }>;
  if (!rows.length) return jsonError(404, 'assignment_not_found');
  return new Response(null, { status: 204 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'POST') return handlePost(req);
  if (req.method === 'DELETE') return handleDelete(req);
  return jsonError(405, 'method_not_allowed');
}
