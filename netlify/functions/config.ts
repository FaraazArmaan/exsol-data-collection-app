import { opt } from '../../src/lib/env.ts';

export const config = { path: '/api/config' };

/**
 * GET /api/config
 *
 * Returns public client-side configuration safe to expose to the browser:
 * the Google OAuth Client ID and the app base URL. The frontend reads this
 * once on the login page to initialize Google Identity Services.
 */
export default async (_req: Request): Promise<Response> => {
  try {
    const body = {
      googleClientId: opt('GOOGLE_OAUTH_CLIENT_ID') ?? null,
      appBaseUrl: opt('APP_BASE_URL') ?? null,
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[config] uncaught', err);
    return new Response(
      JSON.stringify({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
};
