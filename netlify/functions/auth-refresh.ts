import { refresh } from '../../src/lib/session-manager.ts';
import {
  REFRESH_COOKIE_NAME,
  parseCookies,
  setAccessCookie,
  setRefreshCookie,
} from '../../src/lib/cookies.ts';

export const config = { path: '/api/auth/refresh' };

/**
 * POST /api/auth/refresh
 *
 * Rotates the refresh token cookie and issues a new access token.
 * Called transparently by the frontend when access token expires.
 */
export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req);
  } catch (err) {
    console.error('[auth-refresh] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const cookies = parseCookies(req.headers.get('cookie') ?? '');
  const rt = cookies[REFRESH_COOKIE_NAME];
  if (!rt) return json({ error: 'no_refresh_token' }, 401);

  const result = await refresh(rt);
  if (!result) return json({ error: 'invalid_refresh_token' }, 401);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: new Headers([
      ['content-type', 'application/json'],
      ['set-cookie', setAccessCookie(result.accessToken)],
      ['set-cookie', setRefreshCookie(result.refreshToken)],
    ]),
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
