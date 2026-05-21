import { createHash, randomBytes } from 'crypto';
import { withAdminContext, withTenantContext } from './tenancy.ts';
import { record as recordAudit } from './audit-log-writer.ts';
import type { WorkspaceRole } from './types.ts';

export type InviteRow = {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
};

export type CreateInviteInput = {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string;
};

export type CreateInviteResult =
  | { invite: InviteRow; token: string }
  | { error: 'invalid_role' | 'invalid_email' };

const VALID_ROLES: ReadonlySet<WorkspaceRole> = new Set(['manager', 'storekeeper']);
const EXPIRY_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

function rowToInvite(row: Record<string, any>): InviteRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    status: row.status,
  };
}

export async function createInvite(input: CreateInviteInput): Promise<CreateInviteResult> {
  if (!VALID_ROLES.has(input.role)) return { error: 'invalid_role' };
  if (!EMAIL_RE.test(input.email)) return { error: 'invalid_email' };

  const token = mintToken();
  const tokenHash = hashToken(token);

  return withTenantContext(
    { userId: input.invitedBy, workspaceId: input.workspaceId },
    async (c) => {
      const r = await c.query(
        `INSERT INTO invites (workspace_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '${EXPIRY_DAYS} days')
         RETURNING *`,
        [input.workspaceId, input.email.toLowerCase().trim(), input.role, tokenHash, input.invitedBy],
      );
      const invite = rowToInvite(r.rows[0]);
      await recordAudit(
        {
          realActorId: input.invitedBy,
          onBehalfOfId: null,
          impersonationReason: null,
          workspaceId: input.workspaceId,
          action: 'invite.create',
          resourceType: 'workspace_membership',
          resourceId: invite.id,
          after: { email: invite.email, role: invite.role },
        },
        c,
      );
      return { invite, token };
    },
  );
}

// Token-only lookup. Bypasses RLS via admin context — the token IS the
// authentication factor here (the user hasn't signed in yet).
export async function getInviteByToken(token: string): Promise<InviteRow | null> {
  if (!token || token.length < 20) return null;
  const tokenHash = hashToken(token);
  return withAdminContext({ userId: '00000000-0000-0000-0000-000000000000' }, async (c) => {
    const r = await c.query(`SELECT * FROM invites WHERE token_hash = $1`, [tokenHash]);
    if ((r.rowCount ?? 0) === 0) return null;
    return rowToInvite(r.rows[0]);
  });
}

export type AcceptResult =
  | { invite: InviteRow }
  | { error: 'invalid_token' | 'already_accepted' | 'revoked' | 'expired' | 'email_mismatch' };

export async function acceptInvite(token: string, userId: string): Promise<AcceptResult> {
  const invite = await getInviteByToken(token);
  if (!invite) return { error: 'invalid_token' };
  if (invite.status === 'accepted') return { error: 'already_accepted' };
  if (invite.status === 'revoked') return { error: 'revoked' };
  if (invite.expiresAt.getTime() < Date.now()) return { error: 'expired' };

  // Cross-workspace operations need admin context to bypass RLS scoped
  // to a single workspace_id setting.
  return withAdminContext({ userId }, async (c) => {
    // Concurrent-accept guard: only flip pending → accepted once.
    const update = await c.query(
      `UPDATE invites SET status = 'accepted', accepted_at = now(), accepted_by = $1
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [userId, invite.id],
    );
    if ((update.rowCount ?? 0) === 0) {
      return { error: 'already_accepted' as const };
    }
    const accepted = rowToInvite(update.rows[0]);

    await c.query(
      `INSERT INTO workspace_memberships (user_id, workspace_id, role, accepted_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, workspace_id) DO UPDATE
       SET role = EXCLUDED.role, accepted_at = COALESCE(workspace_memberships.accepted_at, now())`,
      [userId, accepted.workspaceId, accepted.role],
    );

    await recordAudit(
      {
        realActorId: userId,
        onBehalfOfId: null,
        impersonationReason: null,
        workspaceId: accepted.workspaceId,
        action: 'invite.accept',
        resourceType: 'workspace_membership',
        resourceId: accepted.id,
        after: { email: accepted.email, role: accepted.role },
      },
      c,
    );
    return { invite: accepted };
  });
}

export async function listInvites(workspaceId: string, requesterId: string): Promise<InviteRow[]> {
  return withTenantContext({ userId: requesterId, workspaceId }, async (c) => {
    const r = await c.query(
      `SELECT * FROM invites WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [workspaceId],
    );
    return r.rows.map(rowToInvite);
  });
}

export async function revokeInvite(
  workspaceId: string,
  inviteId: string,
  requesterId: string,
): Promise<{ revoked: true } | { error: 'not_found' | 'already_resolved' }> {
  return withTenantContext({ userId: requesterId, workspaceId }, async (c) => {
    const r = await c.query(
      `UPDATE invites SET status = 'revoked'
       WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
       RETURNING id`,
      [inviteId, workspaceId],
    );
    if ((r.rowCount ?? 0) === 0) {
      const exists = await c.query(`SELECT status FROM invites WHERE id = $1 AND workspace_id = $2`, [inviteId, workspaceId]);
      if ((exists.rowCount ?? 0) === 0) return { error: 'not_found' as const };
      return { error: 'already_resolved' as const };
    }
    await recordAudit(
      {
        realActorId: requesterId,
        onBehalfOfId: null,
        impersonationReason: null,
        workspaceId,
        action: 'invite.revoke',
        resourceType: 'workspace_membership',
        resourceId: inviteId,
      },
      c,
    );
    return { revoked: true as const };
  });
}
