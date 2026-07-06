// POST /api/onboard-generate — mint a single-use, 7-day onboarding link.
// Authed (Product Manager); gated by the data-collection module. Returns the
// opaque token; the FE builds the /onboard/:token URL.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireDataCollection } from './_data-collection-authz';
import { randomUUID } from 'node:crypto';

export const config = { path: '/api/onboard-generate', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireDataCollection(req, ['data-collection.products.create']);
  if (!a.ok) return a.res;

  const token = randomUUID();
  const sql = db();
  const rows = (await sql`
    INSERT INTO public.onboard_tokens (client_id, token, expires_at, created_by)
    VALUES (${a.ctx.clientId}::uuid, ${token}, now() + interval '7 days', ${a.ctx.userNodeId}::uuid)
    RETURNING token, expires_at
  `) as Array<{ token: string; expires_at: string }>;
  return jsonOk({ token: rows[0]!.token, expires_at: rows[0]!.expires_at }, { status: 201 });
}
