import { opt } from '../../src/lib/env.ts';

export const config = { path: '/api/config' };

export default async (_req: Request): Promise<Response> => {
  const body = {
    googleClientId: opt('GOOGLE_OAUTH_CLIENT_ID') ?? null,
    appBaseUrl: opt('APP_BASE_URL') ?? null,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
