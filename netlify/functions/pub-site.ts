// GET /api/public/site/:slug — public Brand Portfolio Site config.
// Module-agnostic slug resolve (any branded workspace). Returns the section
// config ONLY when published; unpublished/absent → { published: false } so the
// public page can render a graceful "not available yet" state (no dead end).
// The page fetches brand (pub-brand) and products (pub-menu) separately.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveClientBySlug } from './_shared/brand';
import { clientIp, checkLimit } from './_pub-ratelimit';

export const config = { path: '/api/public/site/:slug', method: 'GET' };

function slugFromUrl(req: Request): string {
  const segs = new URL(req.url).pathname.split('/').filter(Boolean); // /api/public/site/<slug>
  return decodeURIComponent(segs[segs.length - 1] ?? '');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const rl = await checkLimit(clientIp(req), 'site', { perMinute: 60 });
  if (!rl.ok) return jsonError(429, rl.code);

  const tenant = await resolveClientBySlug(slugFromUrl(req));
  if (!tenant) return jsonError(404, 'not_found');

  const sql = db();
  const rows = (await sql`
    SELECT sections, published FROM public.brand_site_config
    WHERE client_id = ${tenant.clientId}::uuid LIMIT 1
  `) as Array<{ sections: Record<string, unknown>; published: boolean }>;
  const row = rows[0];

  const headers = { 'cache-control': 'public, max-age=30' };
  if (!row || !row.published) return jsonOk({ published: false }, { headers });
  return jsonOk({ published: true, sections: row.sections }, { headers });
}
