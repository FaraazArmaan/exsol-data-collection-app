// GET /api/public/menu/:slug — public, unauthenticated storefront menu.
//
// Handler order (spec §5.1): rate-limit → resolve+guard slug → load the
// storefront-visible active catalog. The internal client id is never exposed;
// the FE keys its guest cart by slug and the submit endpoint re-resolves the id
// server-side. Flat file + explicit config.method per the Netlify deploy traps.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveStorefront } from './_pub-authz';
import { checkLimit, clientIp } from './_pub-ratelimit';
import { loadBundles } from './_shared/bundles';
import { loadCatalogMenuProducts } from './_shared/catalog-read-model';

export const config = { path: '/api/public/menu/:slug', method: 'GET' };

function slugFromUrl(req: Request): string {
  const segs = new URL(req.url).pathname.split('/').filter(Boolean);
  return decodeURIComponent(segs[segs.length - 1] ?? '');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const rl = await checkLimit(clientIp(req), 'menu', { perMinute: 60 });
  if (!rl.ok) return jsonError(429, rl.code);

  const tenant = await resolveStorefront(slugFromUrl(req));
  if (!tenant) return jsonError(404, 'storefront_unavailable');

  const sql = db();
  const products = await loadCatalogMenuProducts(sql, tenant.clientId, 'storefront');

  const cats = (await sql`
    SELECT id, name FROM public.product_categories
    WHERE client_id = ${tenant.clientId}::uuid AND deleted_at IS NULL
    ORDER BY sort_order, name
  `) as Array<{ id: string; name: string }>;
  const variants = (await sql`
    SELECT id, product_id, title,
           COALESCE(CASE WHEN sale_price_cents IS NOT NULL AND (sale_starts_at IS NULL OR sale_starts_at <= now()) AND (sale_ends_at IS NULL OR sale_ends_at > now()) THEN sale_price_cents END, price_cents) AS sale_price_cents
    FROM public.product_variants
    WHERE client_id = ${tenant.clientId}::uuid AND status = 'active' AND storefront_visible = true
      AND availability NOT IN ('out_of_stock', 'discontinued')
    ORDER BY title
  `) as Array<{ id: string; product_id: string; title: string; sale_price_cents: number | string | null }>;
  const variantsByProduct = new Map<string, Array<{ id: string; title: string; salePriceCents: number | string | null }>>();
  for (const variant of variants) variantsByProduct.set(variant.product_id, [...(variantsByProduct.get(variant.product_id) ?? []), { id: variant.id, title: variant.title, salePriceCents: variant.sale_price_cents }]);

  const bundles = await loadBundles(sql, tenant.clientId, products.map((p) => p.id));

  // Published storefront CMS (hero + banners), if any.
  const cmsRows = (await sql`
    SELECT sections FROM public.storefront_cms
    WHERE client_id = ${tenant.clientId}::uuid AND published = true
  `) as Array<{ sections: unknown }>;
  const cms = cmsRows[0]?.sections ?? null;

  return jsonOk(
    {
      tenant: { name: tenant.name },
      ...(cms ? { cms } : {}),
      categories: cats.map((c) => ({
        id: c.id,
        name: c.name,
        productCount: products.filter((p) => p.category_id === c.id).length,
      })),
      products: products.map((p) => {
        const b = bundles.get(p.id);
        return {
          id: p.id,
          name: p.name,
          categoryId: p.category_id,
          salePriceCents: Number(p.sale_price_cents),
          thumbKey: p.hero_image_key,
          ...(variantsByProduct.has(p.id) ? { variants: variantsByProduct.get(p.id)!.map((variant) => ({ ...variant, salePriceCents: Number(variant.salePriceCents ?? p.sale_price_cents) })) } : {}),
          ...(b ? { isBundle: true, bundleInStock: b.inStock, bundleComponents: b.components.map((c) => ({ name: c.name, qty: c.qty })) } : {}),
        };
      }),
    },
    { headers: { 'Cache-Control': 'public, max-age=30' } },
  );
}
