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

export default async (req: Request, context: Context): Promise<Response> => {
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
};
