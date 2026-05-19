import { getCurrentUser, type AuthedUser } from './session-manager.ts';
import { current as currentImpersonation } from './impersonation-manager.ts';
import { isUnlocked } from './workspace-unlock-manager.ts';
import { withUserContext } from './tenancy.ts';
import { json } from './http.ts';
import type { ActorContext, WorkspaceRole } from './types.ts';

export type ResolvedActor = {
  user: AuthedUser;
  actor: ActorContext;
};

export async function resolveWorkspaceActor(
  req: Request,
  workspaceId: string,
): Promise<ResolvedActor | Response> {
  const user = await getCurrentUser(req);
  if (!user) return json({ error: 'unauthenticated' }, 401);

  if (user.isAdmin) {
    const unlocked = await isUnlocked(user.id, workspaceId);
    if (!unlocked) return json({ error: 'workspace_locked' }, 423);

    const imp = await currentImpersonation(user.id);
    if (imp && imp.workspaceId === workspaceId) {
      const role = await loadRole(imp.targetUserId, workspaceId);
      if (!role) return json({ error: 'impersonation_target_missing' }, 500);
      return {
        user,
        actor: {
          realActorId: user.id,
          realRole: 'admin',
          onBehalfOfId: imp.targetUserId,
          workspaceRole: role,
          workspaceId,
          isImpersonating: true,
          impersonationReason: imp.reason,
        },
      };
    }

    return {
      user,
      actor: {
        realActorId: user.id,
        realRole: 'admin',
        onBehalfOfId: null,
        workspaceRole: null,
        workspaceId,
        isImpersonating: false,
        impersonationReason: null,
      },
    };
  }

  const role = await loadRole(user.id, workspaceId);
  if (!role) return json({ error: 'forbidden' }, 403);

  return {
    user,
    actor: {
      realActorId: user.id,
      realRole: null,
      onBehalfOfId: null,
      workspaceRole: role,
      workspaceId,
      isImpersonating: false,
      impersonationReason: null,
    },
  };
}

async function loadRole(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  return withUserContext({ userId }, async (c) => {
    const r = await c.query(
      `SELECT role FROM workspace_memberships
       WHERE user_id = $1 AND workspace_id = $2 AND accepted_at IS NOT NULL`,
      [userId, workspaceId],
    );
    if ((r.rowCount ?? 0) === 0) return null;
    return r.rows[0].role as WorkspaceRole;
  });
}
