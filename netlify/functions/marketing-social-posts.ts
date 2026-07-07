import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';
import { isSocialProvider, PROVIDER_MAX_CHARS } from '../../src/modules/marketing/lib/social';
import { postNow } from './_marketing-social';

// GET    /api/marketing/social-posts            — list (view)
// POST   /api/marketing/social-posts            — create/schedule (create); {action:'post_now',id} posts now (edit)
// DELETE /api/marketing/social-posts?id=...      — cancel a scheduled post (edit)
export const config = { path: '/api/marketing/social-posts' };

export default async function handler(req: Request): Promise<Response> {
  const sql = db();

  if (req.method === 'GET') {
    const a = await requireMarketing(req, ['marketing.customers.view']);
    if (!a.ok) return a.res;
    const rows = await sql`
      SELECT id, provider, content, to_char(scheduled_for, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS scheduled_for,
             status, to_char(posted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS posted_at, provider_ref, error, created_at
      FROM public.marketing_social_posts WHERE client_id = ${a.ctx.clientId}::uuid
      ORDER BY scheduled_for DESC LIMIT 500
    `;
    return new Response(JSON.stringify({ posts: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method === 'POST') {
    const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; provider?: string; content?: string; scheduled_for?: string };

    if (b.action === 'post_now') {
      const a = await requireMarketing(req, ['marketing.customers.edit']);
      if (!a.ok) return a.res;
      if (!b.id) return jsonError(400, 'invalid_input');
      const result = await postNow(sql, a.ctx.clientId, b.id);
      if (result === null) return jsonError(404, 'not_found');
      return new Response(JSON.stringify({ status: result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const a = await requireMarketing(req, ['marketing.customers.create']);
    if (!a.ok) return a.res;
    if (!isSocialProvider(b.provider) || !b.content?.trim() || !b.scheduled_for) return jsonError(400, 'invalid_input');
    if (b.content.trim().length > PROVIDER_MAX_CHARS[b.provider]) return jsonError(400, 'content_too_long', { max: PROVIDER_MAX_CHARS[b.provider] });
    const when = new Date(b.scheduled_for);
    if (Number.isNaN(when.getTime())) return jsonError(400, 'invalid_schedule');
    const rows = (await sql`
      INSERT INTO public.marketing_social_posts (client_id, provider, content, scheduled_for, created_by_user_node)
      VALUES (${a.ctx.clientId}::uuid, ${b.provider}, ${b.content.trim()}, ${when.toISOString()}, ${a.ctx.userNodeId}::uuid)
      RETURNING id, provider, content, to_char(scheduled_for, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS scheduled_for, status, created_at
    `) as any[];
    return new Response(JSON.stringify({ post: rows[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method === 'DELETE') {
    const a = await requireMarketing(req, ['marketing.customers.edit']);
    if (!a.ok) return a.res;
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return jsonError(400, 'invalid_input');
    // Only a still-scheduled post can be cancelled (posted ones are immutable history).
    const rows = (await sql`
      UPDATE public.marketing_social_posts SET status = 'cancelled', updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid AND status = 'scheduled'
      RETURNING id
    `) as Array<{ id: string }>;
    if (!rows[0]) return jsonError(409, 'not_cancellable');
    return new Response(null, { status: 204 });
  }

  return jsonError(405, 'method_not_allowed');
}
