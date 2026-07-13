// /api/workforce/compliance-ops
//   GET  → requirements, asset maintenance, compliance tasks (workforce.assets.view)
//   POST → create requirement/task/maintenance row (workforce.assets.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { booleanField, nullableStringField, numberField, optionalUuidField, readJson, resourceExists, stringField } from './_workforce-depth-utils';

export const config = { path: '/api/workforce/compliance-ops' };

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.assets.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const requirements = await sql`SELECT * FROM public.workforce_compliance_requirements WHERE client_id = ${a.ctx.clientId}::uuid ORDER BY active DESC, created_at DESC` as unknown[];
  const tasks = await sql`SELECT * FROM public.workforce_compliance_tasks WHERE client_id = ${a.ctx.clientId}::uuid ORDER BY due_date NULLS LAST, created_at DESC LIMIT 200` as unknown[];
  const maintenance = await sql`SELECT * FROM public.workforce_asset_maintenance WHERE client_id = ${a.ctx.clientId}::uuid ORDER BY scheduled_for DESC, created_at DESC LIMIT 200` as unknown[];
  return jsonOk({ requirements, tasks, maintenance });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.assets.create']);
  if (!a.ok) return a.res;

  const body = await readJson(req);
  if (body instanceof Response) return body;
  const kind = stringField(body, 'kind');
  const sql = db();

  if (kind === 'requirement') {
    const name = stringField(body, 'name');
    const requirementType = stringField(body, 'requirement_type');
    if (!name) return jsonError(400, 'name_required');
    if (!requirementType) return jsonError(400, 'requirement_type_required');
    const courseId = optionalUuidField(body, 'course_id');
    if (courseId instanceof Response) return courseId;
    const assetId = optionalUuidField(body, 'asset_id');
    if (assetId instanceof Response) return assetId;
    const rows = await sql`
      INSERT INTO public.workforce_compliance_requirements (
        client_id, requirement_type, name, description, course_id, asset_id,
        required_for_employment_type, due_within_days, recurrence_days, active
      )
      VALUES (
        ${a.ctx.clientId}::uuid,
        ${requirementType}::text,
        ${name}::text,
        ${nullableStringField(body, 'description')}::text,
        ${courseId}::uuid,
        ${assetId}::uuid,
        ${nullableStringField(body, 'required_for_employment_type')}::text,
        ${numberField(body, 'due_within_days')}::int,
        ${numberField(body, 'recurrence_days')}::int,
        ${booleanField(body, 'active', true)}::boolean
      )
      RETURNING *
    ` as Array<Record<string, unknown>>;
    return jsonOk({ requirement: rows[0] }, { status: 201 });
  }

  if (kind === 'maintenance') {
    const assetId = stringField(body, 'asset_id');
    const scheduledFor = stringField(body, 'scheduled_for');
    if (!assetId) return jsonError(400, 'asset_id_required');
    if (optionalUuidField(body, 'asset_id') instanceof Response) return jsonError(400, 'invalid_asset_id');
    if (!scheduledFor) return jsonError(400, 'scheduled_for_required');
    const rows = await sql`
      INSERT INTO public.workforce_asset_maintenance (client_id, asset_id, scheduled_for, notes)
      VALUES (${a.ctx.clientId}::uuid, ${assetId}::uuid, ${scheduledFor}::date, ${nullableStringField(body, 'notes')}::text)
      RETURNING *
    ` as Array<Record<string, unknown>>;
    return jsonOk({ maintenance: rows[0] }, { status: 201 });
  }

  if (kind === 'task') {
    const resourceId = stringField(body, 'resource_id');
    if (!resourceId) return jsonError(400, 'resource_id_required');
    if (!(await resourceExists(a.ctx.clientId, resourceId))) return jsonError(404, 'resource_not_found');
    const requirementId = optionalUuidField(body, 'requirement_id');
    if (requirementId instanceof Response) return requirementId;
    const userNodeId = optionalUuidField(body, 'user_node_id');
    if (userNodeId instanceof Response) return userNodeId;
    const sourceId = optionalUuidField(body, 'source_id');
    if (sourceId instanceof Response) return sourceId;
    const rows = await sql`
      INSERT INTO public.workforce_compliance_tasks (
        client_id, requirement_id, resource_id, user_node_id, due_date, source_type, source_id, notes
      )
      VALUES (
        ${a.ctx.clientId}::uuid,
        ${requirementId}::uuid,
        ${resourceId}::uuid,
        ${userNodeId}::uuid,
        NULLIF(${nullableStringField(body, 'due_date') ?? ''}::text, '')::date,
        ${nullableStringField(body, 'source_type')}::text,
        ${sourceId}::uuid,
        ${nullableStringField(body, 'notes')}::text
      )
      RETURNING *
    ` as Array<Record<string, unknown>>;
    return jsonOk({ task: rows[0] }, { status: 201 });
  }

  return jsonError(400, 'kind_invalid');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
