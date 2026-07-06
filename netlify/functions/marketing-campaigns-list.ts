import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';

export const config = { path: '/api/marketing/campaigns', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.view']);
  if (!a.ok) return a.res;
  const rows = await db()`
    SELECT id, name, subject, audience, status, sent_at, created_at
    FROM public.marketing_campaigns WHERE client_id = ${a.ctx.clientId}::uuid
    ORDER BY created_at DESC LIMIT 500
  `;
  return new Response(JSON.stringify({ campaigns: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
