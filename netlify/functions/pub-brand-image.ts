// GET /api/public/brand/:slug/image/:key — public, ownership-validated brand
// image stream. The key path segment carries slashes (brand/<clientId>/<kind>);
// everything after "/image/" is the key. See branding spec §5.5.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveClientBySlug, brandStore, isAllowedBrandKey, sniffImageMime } from './_shared/brand';
import { clientIp, checkLimit } from './_pub-ratelimit';

export const config = { path: '/api/public/brand/:slug/image/*', method: 'GET' };

function parts(req: Request): { slug: string; key: string } {
  const path = new URL(req.url).pathname;
  const marker = '/image/';
  const segs = path.split('/').filter(Boolean); // api, public, brand, <slug>, image, brand, <clientId>, <kind>
  const slug = decodeURIComponent(segs[3] ?? '');
  const i = path.indexOf(marker);
  const key = i >= 0 ? decodeURIComponent(path.slice(i + marker.length)) : '';
  return { slug, key };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const rl = await checkLimit(clientIp(req), 'brand-image', { perMinute: 60 });
  if (!rl.ok) return jsonError(429, rl.code ?? 'rate_limited');

  const { slug, key } = parts(req);
  const tenant = await resolveClientBySlug(slug);
  if (!tenant) return jsonError(404, 'not_found');

  // Structural guard first (no blob enumeration on malformed keys).
  if (!isAllowedBrandKey(key)) return jsonError(404, 'not_found');
  // Known-prefix routing (defense-in-depth). Currently redundant — the
  // structural guard's regex already anchors on `^brand/` — but kept so the
  // store-routing invariant survives if isAllowedBrandKey is ever loosened.
  if (!key.startsWith('brand/')) return jsonError(404, 'not_found');

  const sql = db();
  const owner = (await sql`
    SELECT 1 FROM public.clients WHERE id = ${tenant.clientId}::uuid
      AND (brand_logo_key = ${key} OR brand_logo_alt_key = ${key} OR brand_favicon_key = ${key}
           OR brand_app_icon_key = ${key} OR brand_social_key = ${key}
           OR ${key} = ANY(brand_hero_keys))
    LIMIT 1
  `) as unknown[];
  if (owner.length === 0) return jsonError(404, 'not_found');

  const bytes = (await brandStore().get(key, { type: 'arrayBuffer' })) as ArrayBuffer | null;
  if (!bytes) return jsonError(404, 'not_found');

  const mime = sniffImageMime(bytes) ?? 'application/octet-stream';
  return new Response(bytes, { status: 200, headers: { 'content-type': mime, 'cache-control': 'public, max-age=86400' } });
}
