// /api/workforce/employees-directory
// Team-first employee directory for Workforce. Booking resources are included
// only when they are linked through an employee profile.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { ensureEmployeeProfilesForTeam } from './_workforce-employee-sync';

export const config = { path: '/api/workforce/employees-directory' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  await ensureEmployeeProfilesForTeam(a.ctx.clientId);

  const sql = db();
  const teamRows = await sql`
    SELECT
      un.id AS user_node_id,
      un.display_name,
      COALESCE(unc.email, un.email) AS email,
      un.level_number,
      cl.label AS level_label,
      cr.label AS role_label,
      (unc.id IS NOT NULL) AS has_login,
      (unc.disabled_at IS NOT NULL) AS login_disabled,
      p.id AS profile_id,
      p.client_id AS profile_client_id,
      p.resource_id,
      br.name AS resource_name,
      p.employee_number,
      p.legal_name,
      p.preferred_name,
      p.employment_status,
      p.employment_type,
      p.job_title,
      p.department,
      p.hire_date,
      p.termination_date,
      p.manager_user_node_id,
      p.primary_email,
      p.primary_phone,
      p.emergency_contact,
      p.custom_fields,
      p.created_at AS profile_created_at,
      p.updated_at AS profile_updated_at
    FROM public.user_nodes un
    LEFT JOIN public.client_roles cr
      ON cr.id = un.role_id
    LEFT JOIN public.client_levels cl
      ON cl.client_id = un.client_id AND cl.level_number = un.level_number
    LEFT JOIN public.user_node_credentials unc
      ON unc.user_node_id = un.id
    LEFT JOIN public.workforce_employee_profiles p
      ON p.client_id = un.client_id AND p.user_node_id = un.id
    LEFT JOIN public.booking_resources br
      ON br.id = p.resource_id
    WHERE un.client_id = ${a.ctx.clientId}::uuid
    ORDER BY un.level_number NULLS LAST, un.display_name ASC
  ` as Array<Record<string, unknown>>;

  const unlinkedProfileRows = await sql`
    SELECT
      NULL::uuid AS user_node_id,
      p.legal_name AS display_name,
      NULL::text AS email,
      NULL::integer AS level_number,
      NULL::text AS level_label,
      NULL::text AS role_label,
      false AS has_login,
      false AS login_disabled,
      p.id AS profile_id,
      p.client_id AS profile_client_id,
      p.resource_id,
      br.name AS resource_name,
      p.employee_number,
      p.legal_name,
      p.preferred_name,
      p.employment_status,
      p.employment_type,
      p.job_title,
      p.department,
      p.hire_date,
      p.termination_date,
      p.manager_user_node_id,
      p.primary_email,
      p.primary_phone,
      p.emergency_contact,
      p.custom_fields,
      p.created_at AS profile_created_at,
      p.updated_at AS profile_updated_at
    FROM public.workforce_employee_profiles p
    JOIN public.booking_resources br
      ON br.id = p.resource_id
    WHERE p.client_id = ${a.ctx.clientId}::uuid
      AND p.user_node_id IS NULL
    ORDER BY p.legal_name ASC
  ` as Array<Record<string, unknown>>;

  return jsonOk({ employees: [...teamRows, ...unlinkedProfileRows] });
}
