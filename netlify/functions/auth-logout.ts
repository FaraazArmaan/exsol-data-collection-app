import { revoke } from '../../src/lib/session-manager.ts';
import {
  REFRESH_COOKIE_NAME,
  clearAccessCookie,
  clearRefreshCookie,
  parseCookies,
} from '../../src/lib/cookies.ts';

export const config = { path: '/api/auth/logout' };

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const cookies = parseCookies(req.headers.get('cookie') ?? '');
  const rt = cookies[REFRESH_COOKIE_NAME];
  if (rt) {
    try {
      await revoke(rt);
    } catch {
      // ignore - clearing cookies is the important part
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
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
