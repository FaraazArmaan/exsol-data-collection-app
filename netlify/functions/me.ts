import { getCurrentUser } from '../../src/lib/session-manager.ts';
import { withUserContext } from '../../src/lib/tenancy.ts';
import { current as currentImpersonation } from '../../src/lib/impersonation-manager.ts';

export const config = { path: '/api/me' };

/**
 * GET /api/me
 *
 * Returns the current authenticated user, their workspace memberships
 * (empty for admins), and any active impersonation session.
 * Returns `{ user: null }` with HTTP 200 if not authenticated — used by
 * the frontend's first-render redirect logic.
 */
export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req);
  } catch (err) {
    console.error('[me] uncaught', err);
    return new Response(
      JSON.stringify({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
};

async function handle(req: Request): Promise<Response> {
  const user = await getCurrentUser(req);
  if (!user) {
    return new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const memberships = user.isAdmin ? [] : await loadMembershipsForUser(user.id);
  const impersonation = user.isAdmin ? await currentImpersonation(user.id) : null;

  return new Response(
    JSON.stringify({ user, memberships, impersonation }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

async function loadMembershipsForUser(userId: string) {
  return withUserContext({ userId }, async (c) => {
    const r = await c.query(
      `SELECT w.id AS workspace_id, w.name AS workspace_name, m.role
       FROM workspace_memberships m
       JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = $1 AND w.deleted_at IS NULL AND w.disabled_at IS NULL
       ORDER BY w.name`,
      [userId],
    );
    return r.rows.map((row) => ({
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      role: row.role,
    }));
  });
}
