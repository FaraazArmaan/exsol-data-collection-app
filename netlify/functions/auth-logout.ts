import { revoke } from '../../src/lib/session-manager.ts';
import {
  REFRESH_COOKIE_NAME,
  clearAccessCookie,
  clearRefreshCookie,
  parseCookies,
} from '../../src/lib/cookies.ts';

export const config = { path: '/api/auth/logout' };

/**
 * POST /api/auth/logout
 *
 * Revokes the current refresh token (best-effort) and clears auth cookies.
 * Always returns 200 — clearing the cookies is the primary outcome.
 */
export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req);
  } catch (err) {
    console.error('[auth-logout] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const cookies = parseCookies(req.headers.get('cookie') ?? '');
  const rt = cookies[REFRESH_COOKIE_NAME];
  if (rt) {
    try {
      await revoke(rt);
    } catch {
      // Best-effort: ignore if the token is already revoked or DB unreachable;
      // cookie clear below is what matters for the user-facing logout.
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: new Headers([
      ['content-type', 'application/json'],
      ['set-cookie', clearAccessCookie()],
      ['set-cookie', clearRefreshCookie()],
    ]),
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
