import type { Context } from '@netlify/functions';
import { attemptUnlock } from '../../src/lib/workspace-unlock-manager.ts';
import {
  json,
  methodNotAllowed,
  readJson,
  requireAdmin,
  safeStr,
} from '../../src/lib/http.ts';

export const config = { path: '/api/admin/workspaces/:id/unlock' };

/**
 * POST /api/admin/workspaces/:id/unlock
 *
 * Verifies the per-workspace access key (Argon2id-hashed). Issues a
 * 15-minute auto-extending unlock claim on success. After 5 failed
 * attempts in 10 minutes, the admin↔workspace pair is locked out for
 * 1 hour and the Primary is notified by email.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[admin-workspace-unlock] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed();
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const workspaceId = context.params?.id;
  if (!workspaceId) return json({ error: 'missing_workspace_id' }, 400);

  const body = await readJson<{ key?: unknown }>(req);
  const key = safeStr(body?.key, 32);
  if (!key) return json({ error: 'missing_key' }, 400);

  const result = await attemptUnlock(admin.id, workspaceId, key);

  if (result.kind === 'unlocked') {
    return json({ ok: true, expiresAt: result.expiresAt });
  }
  if (result.kind === 'invalid_key') {
    return json(
      { error: 'invalid_key', remainingAttempts: result.remainingAttempts },
      401,
    );
  }
  if (result.kind === 'locked_out') {
    return json({ error: 'locked_out', lockedUntil: result.lockedUntil }, 423);
  }
  return json({ error: 'workspace_not_found' }, 404);
}
