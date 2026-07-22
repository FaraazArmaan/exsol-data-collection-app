// Shared decision routing for Workforce approvals. A delegation only assigns
// approval responsibility; it never grants Team or Workforce permissions.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import type { WorkforceAuthCtx } from './_workforce-authz';

export const APPROVAL_REQUEST_TYPES = ['leave', 'overtime', 'shift_swap', 'time_correction', 'attendance_recovery', 'payroll'] as const;
export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

type OwnerRow = { owner_user_node_id: string | null };

export async function requireApprovalOwner(
  ctx: WorkforceAuthCtx,
  requestType: ApprovalRequestType,
  subjectUserNodeId: string | null,
): Promise<Response | { ownerUserNodeId: string | null; delegated: boolean }> {
  if (ctx.levelNumber === 1) return { ownerUserNodeId: null, delegated: false };
  const sql = db();
  const rows = await sql`
    SELECT COALESCE(policy.primary_approver_user_node_id, profile.manager_user_node_id) AS owner_user_node_id
    FROM (SELECT 1) source
    LEFT JOIN public.workforce_approval_policies policy
      ON policy.client_id = ${ctx.clientId}::uuid
     AND policy.request_type = ${requestType}::text
     AND policy.active = true
    LEFT JOIN public.workforce_employee_profiles profile
      ON profile.client_id = ${ctx.clientId}::uuid
     AND profile.user_node_id = ${subjectUserNodeId}::uuid
    LIMIT 1
  ` as OwnerRow[];
  const ownerUserNodeId = rows[0]?.owner_user_node_id ?? null;
  // Existing workspaces can operate before assigning an approval owner. The
  // request remains permission-gated, but policy setup is not a breaking cutover.
  if (!ownerUserNodeId || ownerUserNodeId === ctx.userNodeId) return { ownerUserNodeId, delegated: false };
  const delegated = await sql`
    SELECT 1
    FROM public.workforce_approval_delegations
    WHERE client_id = ${ctx.clientId}::uuid
      AND owner_user_node_id = ${ownerUserNodeId}::uuid
      AND delegate_user_node_id = ${ctx.userNodeId}::uuid
      AND request_type = ${requestType}::text
      AND revoked_at IS NULL
      AND starts_at <= now()
      AND (ends_at IS NULL OR ends_at > now())
    LIMIT 1
  ` as unknown[];
  if (delegated.length > 0) return { ownerUserNodeId, delegated: true };
  return jsonError(403, 'approval_not_assigned_to_actor', { request_type: requestType, owner_user_node_id: ownerUserNodeId });
}

export async function recordApprovalDecision(
  ctx: WorkforceAuthCtx,
  requestType: ApprovalRequestType,
  requestId: string,
  ownerUserNodeId: string | null,
  decision: 'approved' | 'denied',
): Promise<void> {
  await db()`
    INSERT INTO public.workforce_approval_routing_events (client_id, request_type, request_id, event_type, owner_user_node_id, actor_user_node_id, details)
    VALUES (${ctx.clientId}::uuid, ${requestType}::text, ${requestId}::uuid, 'decision_routed', ${ownerUserNodeId}::uuid, ${ctx.userNodeId}::uuid, jsonb_build_object('decision', ${decision}::text))
  `;
}
