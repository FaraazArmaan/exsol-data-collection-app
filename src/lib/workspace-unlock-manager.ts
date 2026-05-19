import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { withAdminContext } from './tenancy.ts';
import { record as recordAudit } from './audit-log-writer.ts';

const UNLOCK_TTL_MS = 15 * 60 * 1000;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 60 * 60 * 1000;

export type UnlockResult =
  | { kind: 'unlocked'; expiresAt: Date }
  | { kind: 'invalid_key'; remainingAttempts: number }
  | { kind: 'locked_out'; lockedUntil: Date }
  | { kind: 'workspace_not_found' };

export async function attemptUnlock(
  adminUserId: string,
  workspaceId: string,
  keyPlaintext: string,
): Promise<UnlockResult> {
  return withAdminContext({ userId: adminUserId }, async (c) => {
    const lockoutRes = await c.query(
      `SELECT locked_until FROM workspace_lockouts
       WHERE admin_user_id = $1 AND workspace_id = $2 AND locked_until > now()`,
      [adminUserId, workspaceId],
    );
    if ((lockoutRes.rowCount ?? 0) > 0) {
      return { kind: 'locked_out' as const, lockedUntil: lockoutRes.rows[0].locked_until };
    }

    const wsRes = await c.query(
      `SELECT admin_access_key_hash FROM workspaces WHERE id = $1 AND deleted_at IS NULL`,
      [workspaceId],
    );
    if ((wsRes.rowCount ?? 0) === 0) {
      return { kind: 'workspace_not_found' as const };
    }

    const ok = await argonVerify(wsRes.rows[0].admin_access_key_hash, keyPlaintext);

    await c.query(
      `INSERT INTO unlock_attempts (admin_user_id, workspace_id, succeeded)
       VALUES ($1, $2, $3)`,
      [adminUserId, workspaceId, ok],
    );

    if (ok) {
      const expiresAt = new Date(Date.now() + UNLOCK_TTL_MS);
      await c.query(
        `INSERT INTO workspace_unlocks (admin_user_id, workspace_id, unlocked_at, last_extended_at, expires_at)
         VALUES ($1, $2, now(), now(), $3)
         ON CONFLICT (admin_user_id, workspace_id)
         DO UPDATE SET unlocked_at = now(), last_extended_at = now(), expires_at = EXCLUDED.expires_at`,
        [adminUserId, workspaceId, expiresAt],
      );
      await recordAudit(
        {
          realActorId: adminUserId,
          workspaceId,
          action: 'workspace.unlock',
          resourceType: 'workspace',
          resourceId: workspaceId,
        },
        c,
      );
      return { kind: 'unlocked' as const, expiresAt };
    }

    const recentRes = await c.query(
      `SELECT count(*)::int AS n FROM unlock_attempts
       WHERE admin_user_id = $1 AND workspace_id = $2
         AND succeeded = false AND attempted_at > now() - interval '10 minutes'`,
      [adminUserId, workspaceId],
    );
    const failedCount = (recentRes.rows[0].n as number) ?? 0;

    if (failedCount >= LOCKOUT_THRESHOLD) {
      const until = new Date(Date.now() + LOCKOUT_DURATION_MS);
      await c.query(
        `INSERT INTO workspace_lockouts (admin_user_id, workspace_id, locked_until, reason)
         VALUES ($1, $2, $3, 'too_many_failed_unlock_attempts')
         ON CONFLICT (admin_user_id, workspace_id)
         DO UPDATE SET locked_until = EXCLUDED.locked_until`,
        [adminUserId, workspaceId, until],
      );
      await recordAudit(
        {
          realActorId: adminUserId,
          workspaceId,
          action: 'workspace.lockout',
          resourceType: 'workspace',
          resourceId: workspaceId,
          metadata: { failed_attempts: failedCount },
        },
        c,
      );
      return { kind: 'locked_out' as const, lockedUntil: until };
    }

    return {
      kind: 'invalid_key' as const,
      remainingAttempts: LOCKOUT_THRESHOLD - failedCount,
    };
  });
}

export async function isUnlocked(adminUserId: string, workspaceId: string): Promise<boolean> {
  return withAdminContext({ userId: adminUserId }, async (c) => {
    const r = await c.query(
      `SELECT 1 FROM workspace_unlocks
       WHERE admin_user_id = $1 AND workspace_id = $2 AND expires_at > now()`,
      [adminUserId, workspaceId],
    );
    return (r.rowCount ?? 0) > 0;
  });
}

export async function extendUnlock(adminUserId: string, workspaceId: string): Promise<void> {
  return withAdminContext({ userId: adminUserId }, async (c) => {
    const newExpiry = new Date(Date.now() + UNLOCK_TTL_MS);
    await c.query(
      `UPDATE workspace_unlocks
       SET last_extended_at = now(), expires_at = $3
       WHERE admin_user_id = $1 AND workspace_id = $2 AND expires_at > now()`,
      [adminUserId, workspaceId, newExpiry],
    );
  });
}

export type RotateKeyResult = { plaintext: string };

export async function rotateKey(
  workspaceId: string,
  requesterId: string,
): Promise<RotateKeyResult> {
  const { plaintext, hash } = await generateAndHashKey();
  await withAdminContext({ userId: requesterId }, async (c) => {
    await c.query(
      `UPDATE workspaces
       SET admin_access_key_hash = $1, key_rotated_at = now(), updated_at = now()
       WHERE id = $2`,
      [hash, workspaceId],
    );
    await c.query(`DELETE FROM workspace_unlocks WHERE workspace_id = $1`, [workspaceId]);
    await recordAudit(
      {
        realActorId: requesterId,
        workspaceId,
        action: 'workspace.key_rotated',
        resourceType: 'workspace',
        resourceId: workspaceId,
      },
      c,
    );
  });
  return { plaintext };
}

export function generateAccessKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[(bytes[i] ?? 0) % alphabet.length];
  }
  return out;
}

export async function generateAndHashKey(): Promise<{ plaintext: string; hash: string }> {
  const plaintext = generateAccessKey();
  const hash = await argonHash(plaintext);
  return { plaintext, hash };
}
