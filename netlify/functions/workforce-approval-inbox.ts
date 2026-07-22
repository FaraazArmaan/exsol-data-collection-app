// /api/workforce/approval-inbox — one manager queue across Workforce decision types.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/approval-inbox' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;
  const rows = await db()`
    WITH items AS (
      SELECT 'leave'::text AS request_type, id AS request_id, resource_id, user_node_id, created_at, leave_type AS summary FROM public.leave_requests WHERE client_id = ${a.ctx.clientId}::uuid AND status = 'pending'
      UNION ALL
      SELECT 'overtime', id, resource_id, user_node_id, created_at, CONCAT(ot_hours, ' hours') FROM public.overtime_entries WHERE client_id = ${a.ctx.clientId}::uuid AND status = 'pending'
      UNION ALL
      SELECT 'shift_swap', s.id, s.offering_resource_id, p.user_node_id, s.created_at, 'Claimed shift swap' FROM public.shift_swaps s LEFT JOIN public.workforce_employee_profiles p ON p.client_id = s.client_id AND p.resource_id = s.offering_resource_id WHERE s.client_id = ${a.ctx.clientId}::uuid AND s.status = 'claimed'
      UNION ALL
      SELECT 'time_correction', id, resource_id, requested_by, created_at, correction_type FROM public.workforce_time_corrections WHERE client_id = ${a.ctx.clientId}::uuid AND status = 'pending'
      UNION ALL
      SELECT 'attendance_recovery', id, resource_id, user_node_id, created_at, failure_code FROM public.workforce_attendance_recovery_requests WHERE client_id = ${a.ctx.clientId}::uuid AND status = 'pending'
      UNION ALL
      SELECT 'payroll', id, NULL::uuid, NULL::uuid, created_at, CONCAT(to_char(period_start, 'YYYY-MM-DD'), ' to ', to_char(period_end, 'YYYY-MM-DD')) FROM public.payroll_periods WHERE client_id = ${a.ctx.clientId}::uuid AND status = 'draft'
    )
    SELECT
      items.*, br.name AS resource_name, COALESCE(policy.primary_approver_user_node_id, profile.manager_user_node_id) AS owner_user_node_id,
      owner.display_name AS owner_name, policy.response_target_hours, items.created_at + make_interval(hours => COALESCE(policy.response_target_hours, 24)) AS due_at,
      EXISTS (
        SELECT 1 FROM public.workforce_approval_delegations d
        WHERE d.client_id = ${a.ctx.clientId}::uuid
          AND d.owner_user_node_id = COALESCE(policy.primary_approver_user_node_id, profile.manager_user_node_id)
          AND d.delegate_user_node_id = ${a.ctx.userNodeId}::uuid
          AND d.request_type = items.request_type
          AND d.revoked_at IS NULL AND d.starts_at <= now() AND (d.ends_at IS NULL OR d.ends_at > now())
      ) AS delegated_to_me
    FROM items
    LEFT JOIN public.booking_resources br ON br.id = items.resource_id
    LEFT JOIN public.workforce_employee_profiles profile ON profile.client_id = ${a.ctx.clientId}::uuid AND profile.user_node_id = items.user_node_id
    LEFT JOIN public.workforce_approval_policies policy ON policy.client_id = ${a.ctx.clientId}::uuid AND policy.request_type = items.request_type AND policy.active
    LEFT JOIN public.user_nodes owner ON owner.id = COALESCE(policy.primary_approver_user_node_id, profile.manager_user_node_id)
    WHERE ${a.ctx.levelNumber}::int = 1
       OR COALESCE(policy.primary_approver_user_node_id, profile.manager_user_node_id) IS NULL
       OR COALESCE(policy.primary_approver_user_node_id, profile.manager_user_node_id) = ${a.ctx.userNodeId}::uuid
       OR EXISTS (
         SELECT 1 FROM public.workforce_approval_delegations d
         WHERE d.client_id = ${a.ctx.clientId}::uuid AND d.owner_user_node_id = COALESCE(policy.primary_approver_user_node_id, profile.manager_user_node_id)
           AND d.delegate_user_node_id = ${a.ctx.userNodeId}::uuid AND d.request_type = items.request_type
           AND d.revoked_at IS NULL AND d.starts_at <= now() AND (d.ends_at IS NULL OR d.ends_at > now())
       )
    ORDER BY due_at ASC, items.created_at ASC
    LIMIT 200
  ` as unknown[];
  return jsonOk({ items: rows });
}
