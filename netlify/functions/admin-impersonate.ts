import { begin, current, end } from '../../src/lib/impersonation-manager.ts';
import {
  json,
  methodNotAllowed,
  readJson,
  requireAdmin,
  safeStr,
} from '../../src/lib/http.ts';

export const config = { path: '/api/admin/impersonate' };

type BeginBody = {
  targetUserId?: unknown;
  workspaceId?: unknown;
  reason?: unknown;
};

/**
 * /api/admin/impersonate
 *
 *   GET    — return the admin's currently-active impersonation session (or null).
 *   POST   — begin a new impersonation session (target user + workspace + reason).
 *   DELETE — end the active impersonation session.
 *
 * Impersonation is god-mode: admin retains admin powers while acting as
 * the target user. Reason is required (3+ chars). Session auto-expires
 * after 30 minutes; only one active session per admin at a time.
 */
export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req);
  } catch (err) {
    console.error('[admin-impersonate] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  if (req.method === 'GET') {
    const c = await current(admin.id);
    return json({ impersonation: c });
  }

  if (req.method === 'POST') {
    const body = await readJson<BeginBody>(req);
    if (!body) return json({ error: 'invalid_json' }, 400);

    const targetUserId = safeStr(body.targetUserId, 64);
    const workspaceId = safeStr(body.workspaceId, 64);
    const reason = safeStr(body.reason, 500);
    if (!targetUserId || !workspaceId || !reason) {
      return json({ error: 'missing_fields' }, 400);
    }

    const result = await begin(admin.id, targetUserId, workspaceId, reason);
    if (result.kind === 'started') {
      return json({
        ok: true,
        sessionId: result.sessionId,
        expiresAt: result.expiresAt,
      });
    }
    if (result.kind === 'not_unlocked') {
      return json({ error: 'not_unlocked' }, 423);
    }
    if (result.kind === 'invalid_reason') {
      return json({ error: 'invalid_reason' }, 400);
    }
    if (result.kind === 'invalid_target') {
      return json({ error: 'invalid_target' }, 400);
    }
    if (result.kind === 'already_active') {
      return json(
        {
          error: 'already_active',
          sessionId: result.sessionId,
          expiresAt: result.expiresAt,
        },
        409,
      );
    }
    return json({ error: 'unknown' }, 500);
  }

  if (req.method === 'DELETE') {
    await end(admin.id);
    return json({ ok: true });
  }

  return methodNotAllowed();
}
