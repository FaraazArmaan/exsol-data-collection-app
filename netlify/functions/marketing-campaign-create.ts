import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';

export const config = { path: '/api/marketing/campaigns', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.create']);
  if (!a.ok) return a.res;
  const b = (await req.json().catch(() => ({}))) as { name?: string; subject?: string; body_html?: string; audience?: string };
  if (!b.name?.trim() || !b.subject?.trim() || !b.body_html?.trim()) return jsonError(400, 'invalid_input');
  const audience = b.audience === 'recent_30d' ? 'recent_30d' : 'all';
  const sql = db();
  const rows = (await sql`
    INSERT INTO public.marketing_campaigns (client_id, name, subject, body_html, audience, status, created_by_user_node)
    VALUES (${a.ctx.clientId}::uuid, ${b.name.trim()}, ${b.subject.trim()}, ${b.body_html}, ${audience}, 'draft', ${a.ctx.userNodeId}::uuid)
    RETURNING id, name, subject, body_html, audience, status, sent_at, created_at
  `) as any[];
  return new Response(JSON.stringify({ campaign: rows[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
