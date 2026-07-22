// Field-level Workforce privacy. Grants are separate from Team access levels.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import type { WorkforceAuthCtx } from './_workforce-authz';

export const SENSITIVE_SCOPES = ['profile', 'compensation', 'location_history'] as const;
export type SensitiveDataScope = (typeof SENSITIVE_SCOPES)[number];

export async function sensitiveAccessBasis(ctx: WorkforceAuthCtx, scope: SensitiveDataScope): Promise<'owner' | 'grant' | null> {
  if (ctx.levelNumber === 1) return 'owner';
  const rows = await db()`
    SELECT 1
    FROM public.workforce_sensitive_data_grants
    WHERE client_id = ${ctx.clientId}::uuid
      AND user_node_id = ${ctx.userNodeId}::uuid
      AND data_scope = ${scope}::text
      AND active = true
    LIMIT 1
  ` as unknown[];
  return rows.length > 0 ? 'grant' : null;
}

export async function requireSensitiveAccess(ctx: WorkforceAuthCtx, scope: SensitiveDataScope): Promise<Response | 'owner' | 'grant'> {
  const basis = await sensitiveAccessBasis(ctx, scope);
  return basis ?? jsonError(403, 'sensitive_data_access_required', { data_scope: scope });
}

export async function recordSensitiveAccess(
  ctx: WorkforceAuthCtx,
  scope: SensitiveDataScope,
  endpoint: string,
  accessBasis: 'owner' | 'direct_manager' | 'grant',
  subjectUserNodeId: string | null = null,
): Promise<void> {
  await db()`
    INSERT INTO public.workforce_sensitive_data_access_events (client_id, actor_user_node_id, data_scope, subject_user_node_id, endpoint, access_basis)
    VALUES (${ctx.clientId}::uuid, ${ctx.userNodeId}::uuid, ${scope}::text, ${subjectUserNodeId}::uuid, ${endpoint}::text, ${accessBasis}::text)
  `;
}
