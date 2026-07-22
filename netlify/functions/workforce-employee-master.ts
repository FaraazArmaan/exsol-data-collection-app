// /api/workforce/employee-master
//   GET  → list employee master profiles (workforce.employees.view)
//   POST → create/update a profile by resource_id (workforce.employees.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { jsonBodyField, nullableStringField, optionalUuidField, readJson, resourceExists, stringField } from './_workforce-depth-utils';
import { recordSensitiveAccess, sensitiveAccessBasis } from './_workforce-privacy';

export const config = { path: '/api/workforce/employee-master' };

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const status = new URL(req.url).searchParams.get('status');
  const accessBasis = await sensitiveAccessBasis(a.ctx, 'profile');
  const rows = await db()`
    SELECT
      p.id, p.client_id, p.resource_id, br.name AS resource_name, p.user_node_id,
      p.employee_number, p.legal_name, p.preferred_name, p.employment_status, p.employment_type,
      p.job_title, p.department, p.hire_date, p.termination_date, p.manager_user_node_id,
      (${a.ctx.levelNumber}::int = 1 OR ${accessBasis === 'grant'}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid) AS can_view_sensitive,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${accessBasis === 'grant'}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.primary_email END AS primary_email,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${accessBasis === 'grant'}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.primary_phone END AS primary_phone,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${accessBasis === 'grant'}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.emergency_contact END AS emergency_contact,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${accessBasis === 'grant'}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.custom_fields END AS custom_fields,
      p.created_at, p.updated_at
    FROM public.workforce_employee_profiles p
    JOIN public.booking_resources br ON br.id = p.resource_id
    WHERE p.client_id = ${a.ctx.clientId}::uuid
      AND (${status}::text IS NULL OR p.employment_status = ${status}::text)
    ORDER BY p.legal_name, p.created_at DESC
  ` as unknown[];
  if (accessBasis) await recordSensitiveAccess(a.ctx, 'profile', '/api/workforce/employee-master', accessBasis);
  return jsonOk({ profiles: rows });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.create']);
  if (!a.ok) return a.res;

  const body = await readJson(req);
  if (body instanceof Response) return body;

  const legalName = stringField(body, 'legal_name');
  if (!legalName) return jsonError(400, 'legal_name_required');
  const userNodeId = optionalUuidField(body, 'user_node_id');
  if (userNodeId instanceof Response) return userNodeId;
  const managerUserNodeId = optionalUuidField(body, 'manager_user_node_id');
  if (managerUserNodeId instanceof Response) return managerUserNodeId;
  const sql = db();

  if (userNodeId) {
    const rows = await sql`
      SELECT id
      FROM public.user_nodes
      WHERE id = ${userNodeId}::uuid
        AND client_id = ${a.ctx.clientId}::uuid
      LIMIT 1
    ` as Array<{ id: string }>;
    if (rows.length === 0) return jsonError(404, 'user_node_not_found');
  }
  if (managerUserNodeId) {
    const rows = await sql`
      SELECT id
      FROM public.user_nodes
      WHERE id = ${managerUserNodeId}::uuid
        AND client_id = ${a.ctx.clientId}::uuid
      LIMIT 1
    ` as Array<{ id: string }>;
    if (rows.length === 0) return jsonError(404, 'manager_user_node_not_found');
  }

  let resourceId = stringField(body, 'resource_id');
  if (resourceId) {
    if (!(await resourceExists(a.ctx.clientId, resourceId))) return jsonError(404, 'resource_not_found');
  } else if (userNodeId) {
    const existing = await sql`
      SELECT resource_id
      FROM public.workforce_employee_profiles
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND user_node_id = ${userNodeId}::uuid
      ORDER BY updated_at DESC
      LIMIT 1
    ` as Array<{ resource_id: string }>;
    if (existing[0]?.resource_id) {
      resourceId = existing[0].resource_id;
    } else {
      const created = await sql`
        INSERT INTO public.booking_resources (bucket_id, name)
        VALUES (${a.ctx.clientId}::uuid, ${legalName}::text)
        RETURNING id
      ` as Array<{ id: string }>;
      resourceId = created[0]!.id;
    }
  } else {
    return jsonError(400, 'resource_or_user_node_required');
  }

  const existingProfile = await sql`
    SELECT user_node_id, manager_user_node_id
    FROM public.workforce_employee_profiles
    WHERE client_id = ${a.ctx.clientId}::uuid AND resource_id = ${resourceId}::uuid
    LIMIT 1
  ` as Array<{ user_node_id: string | null; manager_user_node_id: string | null }>;
  const profileAccess = await sensitiveAccessBasis(a.ctx, 'profile');
  const canWriteSensitive = !existingProfile[0]
    || a.ctx.levelNumber === 1
    || profileAccess === 'grant'
    || existingProfile[0].manager_user_node_id === a.ctx.userNodeId;

  const rows = await sql`
    INSERT INTO public.workforce_employee_profiles (
      client_id, resource_id, user_node_id, employee_number, legal_name, preferred_name,
      employment_status, employment_type, job_title, department, hire_date, termination_date,
      manager_user_node_id, primary_email, primary_phone, emergency_contact, custom_fields
    )
    VALUES (
      ${a.ctx.clientId}::uuid,
      ${resourceId}::uuid,
      ${userNodeId}::uuid,
      ${nullableStringField(body, 'employee_number')}::text,
      ${legalName}::text,
      ${nullableStringField(body, 'preferred_name')}::text,
      COALESCE(NULLIF(${stringField(body, 'employment_status')}::text, ''), 'active'),
      COALESCE(NULLIF(${stringField(body, 'employment_type')}::text, ''), 'full_time'),
      ${nullableStringField(body, 'job_title')}::text,
      ${nullableStringField(body, 'department')}::text,
      NULLIF(${nullableStringField(body, 'hire_date') ?? ''}::text, '')::date,
      NULLIF(${nullableStringField(body, 'termination_date') ?? ''}::text, '')::date,
      ${managerUserNodeId}::uuid,
      ${nullableStringField(body, 'primary_email')}::text,
      ${nullableStringField(body, 'primary_phone')}::text,
      ${jsonBodyField(body, 'emergency_contact')}::jsonb,
      ${jsonBodyField(body, 'custom_fields')}::jsonb
    )
    ON CONFLICT (client_id, resource_id) DO UPDATE SET
      user_node_id = EXCLUDED.user_node_id,
      employee_number = EXCLUDED.employee_number,
      legal_name = EXCLUDED.legal_name,
      preferred_name = EXCLUDED.preferred_name,
      employment_status = EXCLUDED.employment_status,
      employment_type = EXCLUDED.employment_type,
      job_title = EXCLUDED.job_title,
      department = EXCLUDED.department,
      hire_date = EXCLUDED.hire_date,
      termination_date = EXCLUDED.termination_date,
      manager_user_node_id = EXCLUDED.manager_user_node_id,
      primary_email = CASE WHEN ${canWriteSensitive}::boolean THEN EXCLUDED.primary_email ELSE workforce_employee_profiles.primary_email END,
      primary_phone = CASE WHEN ${canWriteSensitive}::boolean THEN EXCLUDED.primary_phone ELSE workforce_employee_profiles.primary_phone END,
      emergency_contact = CASE WHEN ${canWriteSensitive}::boolean THEN EXCLUDED.emergency_contact ELSE workforce_employee_profiles.emergency_contact END,
      custom_fields = CASE WHEN ${canWriteSensitive}::boolean THEN EXCLUDED.custom_fields ELSE workforce_employee_profiles.custom_fields END
    RETURNING *
  ` as Array<Record<string, unknown>>;
  if (canWriteSensitive && profileAccess) await recordSensitiveAccess(a.ctx, 'profile', '/api/workforce/employee-master', profileAccess, userNodeId ?? existingProfile[0]?.user_node_id ?? null);
  return jsonOk({ profile: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
