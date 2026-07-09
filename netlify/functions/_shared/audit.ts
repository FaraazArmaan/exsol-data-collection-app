//
// logAudit — single INSERT into public.audit_log per audited action.
// Called from every mutating endpoint (~20 sites). INSERT failures are
// caught + logged to stderr; they NEVER propagate to the parent request,
// because losing one audit row is better than rolling back a business
// operation on the audit path.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { AnySession } from './permissions';

export interface AuditArgs {
  session: AnySession;
  op: string;                                      // e.g., 'client.created'
  clientId?: string | null;
  targetType?: string | null;
  targetId?: string | null;                        // text — varies by type
  detail?: Record<string, unknown> | null;
}

export async function logAudit(
  sql: NeonQueryFunction<false, false>,
  args: AuditArgs,
): Promise<void> {
  const actorAdmin = args.session.kind === 'admin' ? args.session.admin.id : null;
  const actorUserNode = args.session.kind === 'bucket_user' ? args.session.user_node_id : null;
  const impersonatedByAdmin = args.session.kind === 'bucket_user'
    ? (args.session.impersonated_by_admin ?? null)
    : null;
  const detailJson = args.detail ? JSON.stringify(args.detail) : null;
  try {
    await sql`
      INSERT INTO public.audit_log
        (actor_admin, actor_user_node, impersonated_by_admin, op, client_id, target_type, target_id, detail)
      VALUES
        (${actorAdmin}, ${actorUserNode}, ${impersonatedByAdmin}, ${args.op},
         ${args.clientId ?? null}, ${args.targetType ?? null}, ${args.targetId ?? null},
         ${detailJson})
    `;
  } catch (err) {
    console.error('[audit] insert failed', { op: args.op, err: (err as Error).message });
  }
}
