import { verifyCredentials } from '../../src/lib/auth-verifier.ts';
import { issue } from '../../src/lib/session-manager.ts';
import { setAccessCookie, setRefreshCookie } from '../../src/lib/cookies.ts';

export const config = { path: '/api/auth/google' };

export default async (req: Request): Promise<Response> => {
  try {
    return await handle(req);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error('[auth-google] uncaught', err);
    return json({ error: 'server_error', detail: msg }, 500);
  }
};

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const idToken = (body as { idToken?: unknown } | null)?.idToken;
  if (typeof idToken !== 'string' || idToken.length === 0) {
    return json({ error: 'missing_idToken' }, 400);
  }

  const result = await verifyCredentials({ provider: 'google', idToken });
  if ('kind' in result) {
    return json({ error: result.kind, detail: result.detail }, errorStatus(result.kind));
  }

  const { accessToken, refreshToken } = await issue(result.id);
  const redirectTo = result.isAdmin ? '/admin.html' : '/me.html';

  return new Response(JSON.stringify({ user: result, redirectTo }), {
    status: 200,
    headers: new Headers([
      ['content-type', 'application/json'],
      ['set-cookie', setAccessCookie(accessToken)],
      ['set-cookie', setRefreshCookie(refreshToken)],
    ]),
  });
}

function errorStatus(kind: string): number {
  if (kind === 'unknown_user' || kind === 'user_disabled') return 403;
  if (kind === 'misconfigured') return 500;
  return 401;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
