import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';
import { campaignAbStats } from '../../src/modules/marketing/lib/ab';

// GET /api/marketing/campaigns/:id/ab — per-variant open/click compare.
export const config = { path: '/api/marketing/campaigns/:id/ab', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.view']);
  if (!a.ok) return a.res;
  // path: /api/marketing/campaigns/<id>/ab → id is the second-to-last segment.
  const parts = new URL(req.url).pathname.split('/');
  const id = parts[parts.length - 2] ?? '';
  const sql = db();
  const camp = (await sql`
    SELECT is_ab, subject, subject_b, ab_split FROM public.marketing_campaigns
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `) as Array<{ is_ab: boolean; subject: string; subject_b: string | null; ab_split: number }>;
  if (!camp[0]) return jsonError(404, 'not_found');

  const variants = await campaignAbStats(sql, a.ctx.clientId, id);
  return new Response(JSON.stringify({
    is_ab: camp[0].is_ab,
    subject_a: camp[0].subject,
    subject_b: camp[0].subject_b,
    ab_split: camp[0].ab_split,
    variants,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
