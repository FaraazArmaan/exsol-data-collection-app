import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { audienceCount, type Audience } from '../../src/modules/marketing/lib/audience';

export const config = { path: '/api/marketing/audience-count', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.view']);
  if (!a.ok) return a.res;
  const raw = new URL(req.url).searchParams.get('audience');
  const audience: Audience = raw === 'recent_30d' ? 'recent_30d' : 'all';
  const count = await audienceCount(db(), a.ctx.clientId, audience);
  return new Response(JSON.stringify({ audience, count }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
