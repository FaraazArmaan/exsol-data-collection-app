// GET /api/onboard-public/:token — validate an onboarding token and return the
// tenant name for the public /onboard/:token landing. Unauthenticated: token
// possession is the authorization. 404 unknown token, 410 used/expired.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';

export const config = { path: '/api/onboard-public/:token', method: 'GET' };

function tokenFromUrl(req: Request): string {
  return decodeURIComponent(new URL(req.url).pathname.split('/').pop() ?? '');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const token = tokenFromUrl(req);
  if (!token) return jsonError(404, 'not_found');

  const sql = db();
  const rows = (await sql`
    SELECT ot.used_at, (ot.expires_at <= now()) AS expired, c.name
    FROM public.onboard_tokens ot
    JOIN public.clients c ON c.id = ot.client_id
    WHERE ot.token = ${token}
    LIMIT 1
  `) as Array<{ used_at: string | null; expired: boolean; name: string }>;
  const row = rows[0];
  if (!row) return jsonError(404, 'not_found');
  if (row.used_at !== null) return jsonError(410, 'token_used');
  if (row.expired) return jsonError(410, 'token_expired');

  return jsonOk({ tenant: { name: row.name }, valid: true });
}
