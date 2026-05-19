import { withAdminContext } from './tenancy.ts';
import { isUnlocked } from './workspace-unlock-manager.ts';
import { record as recordAudit } from './audit-log-writer.ts';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MIN_REASON_CHARS = 3;
const MAX_REASON_CHARS = 500;

export type BeginResult =
  | { kind: 'started'; sessionId: string; expiresAt: Date }
  | { kind: 'not_unlocked' }
  | { kind: 'invalid_reason' }
  | { kind: 'invalid_target' }
  | { kind: 'already_active'; sessionId: string; expiresAt: Date };

export async function begin(
  adminUserId: string,
  targetUserId: string,
  workspaceId: string,
  reasonRaw: string,
): Promise<BeginResult> {
  const reason = reasonRaw?.trim() ?? '';
  if (reason.length < MIN_REASON_CHARS || reason.length > MAX_REASON_CHARS) {
    return { kind: 'invalid_reason' };
  }

  if (!(await isUnlocked(adminUserId, workspaceId))) {
    return { kind: 'not_unlocked' };
  }

  return withAdminContext({ userId: adminUserId }, async (c) => {
    const memberRes = await c.query(
      `SELECT 1 FROM workspace_memberships
       WHERE user_id = $1 AND workspace_id = $2 AND accepted_at IS NOT NULL`,
      [targetUserId, workspaceId],
    );
    if ((memberRes.rowCount ?? 0) === 0) return { kind: 'invalid_target' as const };

    const activeRes = await c.query(
      `SELECT id, expires_at FROM impersonation_sessions
       WHERE admin_user_id = $1 AND ended_at IS NULL AND expires_at > now()
       ORDER BY started_at DESC LIMIT 1`,
      [adminUserId],
    );
    if ((activeRes.rowCount ?? 0) > 0) {
      const row = activeRes.rows[0];
      return {
        kind: 'already_active' as const,
        sessionId: row.id,
        expiresAt: row.expires_at,
      };
    }

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const insertRes = await c.query(
      `INSERT INTO impersonation_sessions
        (admin_user_id, target_user_id, workspace_id, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [adminUserId, targetUserId, workspaceId, reason, expiresAt],
    );
    const sessionId = insertRes.rows[0].id as string;

    await recordAudit(
      {
        realActorId: adminUserId,
        onBehalfOfId: targetUserId,
        impersonationReason: reason,
        workspaceId,
        action: 'impersonation.begin',
        resourceType: 'team_member',
        resourceId: targetUserId,
      },
      c,
    );

    return { kind: 'started' as const, sessionId, expiresAt };
  });
}

export async function end(adminUserId: string): Promise<void> {
  await withAdminContext({ userId: adminUserId }, async (c) => {
    const r = await c.query(
      `UPDATE impersonation_sessions
       SET ended_at = now()
       WHERE admin_user_id = $1 AND ended_at IS NULL AND expires_at > now()
       RETURNING id, target_user_id, workspace_id, reason`,
      [adminUserId],
    );
    if ((r.rowCount ?? 0) > 0) {
      const row = r.rows[0];
      await recordAudit(
        {
          realActorId: adminUserId,
          onBehalfOfId: row.target_user_id,
          impersonationReason: row.reason,
          workspaceId: row.workspace_id,
          action: 'impersonation.end',
          resourceType: 'team_member',
          resourceId: row.target_user_id,
        },
        c,
      );
    }
  });
}

export type CurrentImpersonation = {
  sessionId: string;
  targetUserId: string;
  targetUserName: string;
  targetUserEmail: string;
  workspaceId: string;
  workspaceName: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
};

export async function current(adminUserId: string): Promise<CurrentImpersonation | null> {
  return withAdminContext({ userId: adminUserId }, async (c) => {
    const r = await c.query(
      `SELECT s.id, s.target_user_id, s.workspace_id, s.reason, s.started_at, s.expires_at,
              u.name AS target_name, u.email AS target_email,
              w.name AS workspace_name
       FROM impersonation_sessions s
       JOIN users u ON u.id = s.target_user_id
       JOIN workspaces w ON w.id = s.workspace_id
       WHERE s.admin_user_id = $1 AND s.ended_at IS NULL AND s.expires_at > now()
       ORDER BY s.started_at DESC LIMIT 1`,
      [adminUserId],
    );
    if ((r.rowCount ?? 0) === 0) return null;
    const row = r.rows[0];
    return {
      sessionId: row.id,
      targetUserId: row.target_user_id,
      targetUserName: row.target_name,
      targetUserEmail: row.target_email,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      reason: row.reason,
      startedAt: row.started_at,
      expiresAt: row.expires_at,
    };
  });
}
