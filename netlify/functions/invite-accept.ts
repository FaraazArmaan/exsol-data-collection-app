import type { Context } from '@netlify/functions';
import { hash as argonHash } from '@node-rs/argon2';
import { acceptInvite, getInviteByToken } from '../../src/lib/invite-manager.ts';
import { withAdminContext } from '../../src/lib/tenancy.ts';
import { issue } from '../../src/lib/session-manager.ts';
import { setAccessCookie, setRefreshCookie } from '../../src/lib/cookies.ts';
import { json, methodNotAllowed, readJson } from '../../src/lib/http.ts';

export const config = { path: '/api/invites/:token/accept' };

/**
 * POST /api/invites/:token/accept
 *
 * Public endpoint (token IS the auth factor). Creates the user account
 * with the email from the invite + a password, then accepts the invite
 * (creating the workspace_memberships row). On success, issues session
 * cookies and the caller is signed in.
 *
 * Body: { name: string, password: string }
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    if (req.method !== 'POST') return methodNotAllowed();
    const token = context.params?.token;
    if (!token) return json({ error: 'missing_token' }, 400);

    const body = await readJson<{ name?: string; password?: string }>(req);
    if (!body?.name || !body.password) {
      return json({ error: 'invalid_input', detail: 'name and password required' }, 400);
    }
    if (body.password.length < 8) {
      return json({ error: 'weak_password', detail: 'min 8 chars' }, 400);
    }

    const invite = await getInviteByToken(token);
    if (!invite) return json({ error: 'not_found' }, 404);
    if (invite.status !== 'pending') return json({ error: invite.status }, 410);
    if (invite.expiresAt.getTime() < Date.now()) return json({ error: 'expired' }, 410);

    const passwordHash = await argonHash(body.password);

    const userId = await withAdminContext(
      { userId: '00000000-0000-0000-0000-000000000000' },
      async (c) => {
        const existing = await c.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [invite.email]);
        if ((existing.rowCount ?? 0) > 0) {
          // Existing user accepting an invite they were sent at the same address.
          // Leave their existing password intact (don't overwrite); they sign in
          // with whatever they already have.
          return existing.rows[0].id as string;
        }
        const r = await c.query(
          `INSERT INTO users (email, name, password_hash, email_verified)
           VALUES ($1, $2, $3, true)
           RETURNING id`,
          [invite.email.toLowerCase(), body.name, passwordHash],
        );
        return r.rows[0].id as string;
      },
    );

    const accepted = await acceptInvite(token, userId);
    if ('error' in accepted) return json(accepted, 409);

    const { accessToken, refreshToken } = await issue(userId);

    return new Response(
      JSON.stringify({
        userId,
        workspaceId: accepted.invite.workspaceId,
        role: accepted.invite.role,
        redirectTo: '/me.html',
      }),
      {
        status: 200,
        headers: new Headers([
          ['content-type', 'application/json'],
          ['set-cookie', setAccessCookie(accessToken)],
          ['set-cookie', setRefreshCookie(refreshToken)],
        ]),
      },
    );
  } catch (err) {
    console.error('[invite-accept] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};
