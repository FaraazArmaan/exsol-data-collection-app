// GET /api/public/brand/:slug — public, module-agnostic brand payload.
// Every customer-facing surface (POS storefront, Booking, …) fetches this and
// wraps its pages in <BrandShell>. See branding spec §5.4 + §9.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveClientBySlug } from './_shared/brand';
import { clientIp, checkLimit } from './_pub-ratelimit';

export const config = { path: '/api/public/brand/:slug', method: 'GET' };

function slugFromUrl(req: Request): string {
  const segs = new URL(req.url).pathname.split('/').filter(Boolean); // /api/public/brand/<slug>
  return decodeURIComponent(segs[segs.length - 1] ?? '');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const rl = await checkLimit(clientIp(req), 'brand', { perMinute: 60 });
  if (!rl.ok) return jsonError(429, rl.code ?? 'rate_limited');

  const slug = slugFromUrl(req);
  const tenant = await resolveClientBySlug(slug);
  if (!tenant) return jsonError(404, 'not_found');

  const sql = db();
  const rows = (await sql`
    SELECT brand_logo_key, brand_logo_alt_key, brand_favicon_key, brand_app_icon_key,
           brand_social_key, brand_hero_keys, brand_accent, brand_theme,
           brand_font_heading, brand_font_body
    FROM public.clients WHERE id = ${tenant.clientId}::uuid LIMIT 1
  `) as Array<{
    brand_logo_key: string | null; brand_logo_alt_key: string | null; brand_favicon_key: string | null;
    brand_app_icon_key: string | null; brand_social_key: string | null; brand_hero_keys: string[];
    brand_accent: string | null; brand_theme: 'dark' | 'light';
    brand_font_heading: string | null; brand_font_body: string | null;
  }>;
  const r = rows[0]!;
  const url = (key: string | null) => key ? `/api/public/brand/${encodeURIComponent(slug)}/image/${key}` : null;

  const payload = {
    name: tenant.name,
    logoUrl:    url(r.brand_logo_key),
    logoAltUrl: url(r.brand_logo_alt_key),
    faviconUrl: url(r.brand_favicon_key),
    appIconUrl: url(r.brand_app_icon_key),
    socialUrl:  url(r.brand_social_key),
    heroUrls:   (r.brand_hero_keys ?? []).map((k) => url(k)!).filter(Boolean),
    accent:     r.brand_accent,
    theme:      r.brand_theme,
    fontHeading: r.brand_font_heading,
    fontBody:    r.brand_font_body,
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
  });
}
