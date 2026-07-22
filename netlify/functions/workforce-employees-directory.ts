// /api/workforce/employees-directory
// Team-first employee directory for Workforce. Booking resources are included
// only when they are linked through an employee profile.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { recordSensitiveAccess, sensitiveAccessBasis } from './_workforce-privacy';

export const config = { path: '/api/workforce/employees-directory' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const profileAccess = await sensitiveAccessBasis(a.ctx, 'profile');
  const hasProfileGrant = profileAccess === 'grant';
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
      (${a.ctx.levelNumber}::int = 1 OR ${hasProfileGrant}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid) AS can_view_sensitive,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${hasProfileGrant}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.primary_email END AS primary_email,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${hasProfileGrant}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.primary_phone END AS primary_phone,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${hasProfileGrant}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.emergency_contact END AS emergency_contact,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${hasProfileGrant}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.custom_fields END AS custom_fields,
      p.created_at AS profile_created_at,
      p.updated_at AS profile_updated_at,
      (
        SELECT COUNT(*)::int
        FROM public.workforce_work_location_assignments wa
        JOIN public.workforce_work_locations wl ON wl.id = wa.work_location_id
        WHERE wa.client_id = un.client_id
          AND wa.active = true
          AND wl.active = true
          AND (
            wa.applies_to_all = true
            OR wa.resource_id = p.resource_id
            OR wa.user_node_id = un.id
          )
      ) AS active_work_location_count,
      EXISTS (
        SELECT 1
        FROM public.workforce_shifts ws
        WHERE ws.client_id = un.client_id
          AND ws.resource_id = p.resource_id
      ) AS has_recurring_shift
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
      (${a.ctx.levelNumber}::int = 1 OR ${hasProfileGrant}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid) AS can_view_sensitive,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${hasProfileGrant}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.primary_email END AS primary_email,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${hasProfileGrant}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.primary_phone END AS primary_phone,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${hasProfileGrant}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.emergency_contact END AS emergency_contact,
      CASE WHEN ${a.ctx.levelNumber}::int = 1 OR ${hasProfileGrant}::boolean OR p.manager_user_node_id = ${a.ctx.userNodeId}::uuid THEN p.custom_fields END AS custom_fields,
      p.created_at AS profile_created_at,
      p.updated_at AS profile_updated_at,
      (
        SELECT COUNT(*)::int
        FROM public.workforce_work_location_assignments wa
        JOIN public.workforce_work_locations wl ON wl.id = wa.work_location_id
        WHERE wa.client_id = p.client_id
          AND wa.active = true
          AND wl.active = true
          AND (
            wa.applies_to_all = true
            OR wa.resource_id = p.resource_id
            OR wa.user_node_id = p.user_node_id
          )
      ) AS active_work_location_count,
      EXISTS (
        SELECT 1
        FROM public.workforce_shifts ws
        WHERE ws.client_id = p.client_id
          AND ws.resource_id = p.resource_id
      ) AS has_recurring_shift
    FROM public.workforce_employee_profiles p
    JOIN public.booking_resources br
      ON br.id = p.resource_id
    WHERE p.client_id = ${a.ctx.clientId}::uuid
      AND p.user_node_id IS NULL
    ORDER BY p.legal_name ASC
  ` as Array<Record<string, unknown>>;

  if (profileAccess) await recordSensitiveAccess(a.ctx, 'profile', '/api/workforce/employees-directory', profileAccess);
  return jsonOk({ employees: [...teamRows, ...unlinkedProfileRows] });
}
