import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';

export const config = { path: '/api/marketing/campaigns/:id', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.view']);
  if (!a.ok) return a.res;
  const id = new URL(req.url).pathname.split('/').pop()!;
  const sql = db();
  const rows = (await sql`
    SELECT id, name, subject, subject_b, is_ab, ab_split, body_html, audience, channel, status, sent_at, created_at
    FROM public.marketing_campaigns WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  const sends = await sql`
    SELECT id, channel, recipient_email, recipient_phone, status, provider_id, error, created_at
    FROM public.campaign_sends WHERE campaign_id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    ORDER BY created_at DESC LIMIT 1000
  `;
  return new Response(JSON.stringify({ campaign: rows[0], sends }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
