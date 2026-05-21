import type { Context } from '@netlify/functions';
import { getInviteByToken } from '../../src/lib/invite-manager.ts';
import { withAdminContext } from '../../src/lib/tenancy.ts';
import { json, methodNotAllowed } from '../../src/lib/http.ts';

export const config = { path: '/api/invites/:token' };

/**
 * Public (no auth) lookup of invite metadata by raw token. The token
 * itself is the auth factor — we hash + compare server-side.
 * Returns only safe fields (email + role + workspace name + status),
 * never the inviter ID or workspace ID.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    if (req.method !== 'GET') return methodNotAllowed();
    const token = context.params?.token;
    if (!token) return json({ error: 'missing_token' }, 400);

    const invite = await getInviteByToken(token);
    if (!invite) return json({ error: 'not_found' }, 404);

    const wsName = await withAdminContext(
      { userId: '00000000-0000-0000-0000-000000000000' },
      async (c) => {
        const r = await c.query(`SELECT name FROM workspaces WHERE id = $1`, [invite.workspaceId]);
        return (r.rows[0]?.name as string) ?? 'workspace';
      },
    );

    const expired = invite.expiresAt.getTime() < Date.now();
    const usable = invite.status === 'pending' && !expired;

    return json({
      email: invite.email,
      role: invite.role,
      workspaceName: wsName,
      status: expired && invite.status === 'pending' ? 'expired' : invite.status,
      expiresAt: invite.expiresAt,
      usable,
    });
  } catch (err) {
    console.error('[invite-info] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};
