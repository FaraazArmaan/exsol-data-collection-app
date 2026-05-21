import type { Context } from '@netlify/functions';
import { acceptInvite, getInviteByToken } from '../../src/lib/invite-manager.ts';
import { verifyGoogleIdToken } from '../../src/lib/google-verifier.ts';
import { withAdminContext } from '../../src/lib/tenancy.ts';
import { issue } from '../../src/lib/session-manager.ts';
import { setAccessCookie, setRefreshCookie } from '../../src/lib/cookies.ts';
import { json, methodNotAllowed, readJson } from '../../src/lib/http.ts';

export const config = { path: '/api/invites/:token/accept-google' };

/**
 * POST /api/invites/:token/accept-google
 *
 * Public endpoint. Body: { idToken: string }.
 *
 * Strict email binding: the Google account's verified email must equal
 * the invite email (case-insensitive). See ADR-0007.
 *
 * Creates the user with password_hash = NULL (Google-only), or reuses
 * an existing user at that email (attaches google_sub if not set,
 * leaves their password_hash + name untouched).
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    if (req.method !== 'POST') return methodNotAllowed();
    const token = context.params?.token;
    if (!token) return json({ error: 'missing_token' }, 400);

    const body = await readJson<{ idToken?: string }>(req);
    if (!body?.idToken) return json({ error: 'missing_idToken' }, 400);

    const invite = await getInviteByToken(token);
    if (!invite) return json({ error: 'not_found' }, 404);
    if (invite.status !== 'pending') return json({ error: invite.status }, 410);
    if (invite.expiresAt.getTime() < Date.now()) return json({ error: 'expired' }, 410);

    const identity = await verifyGoogleIdToken(body.idToken);
    if ('kind' in identity) {
      const status = identity.kind === 'misconfigured' ? 500
        : identity.kind === 'email_not_verified' ? 403
        : 401;
      return json({ error: identity.kind, detail: identity.detail }, status);
    }

    if (identity.email.toLowerCase() !== invite.email.toLowerCase()) {
      return json(
        {
          error: 'email_mismatch',
          detail: `Invite was sent to ${invite.email}, but you signed in as ${identity.email}.`,
          inviteEmail: invite.email,
          googleEmail: identity.email,
        },
        403,
      );
    }

    const userId = await withAdminContext(
      { userId: '00000000-0000-0000-0000-000000000000' },
      async (c) => {
        // Existing user at this email? Reuse the row; attach google_sub
        // if unset; do NOT overwrite password_hash or name.
        const existing = await c.query(
          `SELECT id, google_sub FROM users WHERE lower(email) = lower($1)`,
          [invite.email],
        );
        if ((existing.rowCount ?? 0) > 0) {
          const row = existing.rows[0];
          if (row.google_sub && row.google_sub !== identity.sub) {
            // This shouldn't normally happen (one verified email = one Google sub),
            // but if it does we treat it as a token problem.
            throw new Error('sub_mismatch_for_existing_user');
          }
          if (!row.google_sub) {
            await c.query(
              `UPDATE users SET google_sub = $1, email_verified = true, updated_at = now() WHERE id = $2`,
              [identity.sub, row.id],
            );
          }
          return row.id as string;
        }

        const r = await c.query(
          `INSERT INTO users (email, name, google_sub, photo_url, email_verified, password_hash)
           VALUES ($1, $2, $3, $4, true, NULL)
           RETURNING id`,
          [invite.email.toLowerCase(), identity.name, identity.sub, identity.photoUrl],
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
    console.error('[invite-accept-google] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};
