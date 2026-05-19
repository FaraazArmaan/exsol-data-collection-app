import { verifyCredentials } from '../../src/lib/auth-verifier.ts';
import { issue } from '../../src/lib/session-manager.ts';
import { setAccessCookie, setRefreshCookie } from '../../src/lib/cookies.ts';

export const config = { path: '/api/auth/email/login' };

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const { email, password } = (body as { email?: unknown; password?: unknown } | null) ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return json({ error: 'missing_credentials' }, 400);
  }

  const result = await verifyCredentials({ provider: 'email', email, password });
  if ('kind' in result) {
    const status =
      result.kind === 'user_disabled' || result.kind === 'unknown_user' ? 403 : 401;
    return json({ error: result.kind }, status);
  }

  const { accessToken, refreshToken } = await issue(result.id);
  const redirectTo = result.isAdmin ? '/admin.html' : '/me.html';

  return new Response(
    JSON.stringify({ user: result, redirectTo }),
    {
      status: 200,
      headers: new Headers([
        ['content-type', 'application/json'],
        ['set-cookie', setAccessCookie(accessToken)],
        ['set-cookie', setRefreshCookie(refreshToken)],
      ]),
    },
  );
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
