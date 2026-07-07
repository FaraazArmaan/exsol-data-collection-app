import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';
import { isSendChannel } from '../../src/modules/marketing/lib/channels';

export const config = { path: '/api/marketing/campaigns', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.create']);
  if (!a.ok) return a.res;
  const b = (await req.json().catch(() => ({}))) as { name?: string; subject?: string; body_html?: string; audience?: string; channel?: string; is_ab?: boolean; subject_b?: string; ab_split?: number };
  if (!b.name?.trim() || !b.subject?.trim() || !b.body_html?.trim()) return jsonError(400, 'invalid_input');
  const audience = b.audience === 'recent_30d' ? 'recent_30d' : 'all';
  const channel = isSendChannel(b.channel) ? b.channel : 'email';
  // A/B requires a variant-B subject; without one it's not a valid experiment.
  const isAb = b.is_ab === true && !!b.subject_b?.trim();
  const subjectB = isAb ? b.subject_b!.trim() : null;
  const abSplit = isAb ? Math.max(0, Math.min(100, Math.round(b.ab_split ?? 50))) : 50;
  const sql = db();
  const rows = (await sql`
    INSERT INTO public.marketing_campaigns (client_id, name, subject, body_html, audience, channel, is_ab, subject_b, ab_split, status, created_by_user_node)
    VALUES (${a.ctx.clientId}::uuid, ${b.name.trim()}, ${b.subject.trim()}, ${b.body_html}, ${audience}, ${channel}, ${isAb}, ${subjectB}, ${abSplit}, 'draft', ${a.ctx.userNodeId}::uuid)
    RETURNING id, name, subject, subject_b, is_ab, ab_split, body_html, audience, channel, status, sent_at, created_at
  `) as any[];
  return new Response(JSON.stringify({ campaign: rows[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
