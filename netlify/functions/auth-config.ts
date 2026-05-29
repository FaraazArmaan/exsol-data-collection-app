// Public auth config — the Google OAuth client ID is not a secret (it ships
// in any web client that uses Google Sign-In). Exposing it via a tiny GET
// endpoint avoids duplicating GOOGLE_OAUTH_CLIENT_ID into a VITE_ prefixed
// env var and lets us rotate the client ID without rebuilding the frontend.

import type { Context } from '@netlify/functions';
import { env } from './_shared/env';
import { jsonError, jsonOk } from './_shared/http';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  return jsonOk({ google_client_id: env().GOOGLE_OAUTH_CLIENT_ID });
};
