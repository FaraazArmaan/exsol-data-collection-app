// GET /api/public/catalog/:slug — public, unauthenticated product catalog.
// Like pub-menu but gated on the `catalog` product (NOT storefront_enabled/pos)
// and with no cart. Exposes the tenant name + contact details for the CTA.
// All "unavailable" reasons collapse to one 404 (anti-enumeration parity).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { checkLimit, clientIp } from './_pub-ratelimit';
import { loadBundles } from './_shared/bundles';
import { loadCatalogMenuProducts } from './_shared/catalog-read-model';

export const config = { path: '/api/public/catalog/:slug', method: 'GET' };

function slugFromUrl(req: Request): string {
  const segs = new URL(req.url).pathname.split('/').filter(Boolean);
  return decodeURIComponent(segs[segs.length - 1] ?? '');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const rl = await checkLimit(clientIp(req), 'catalog', { perMinute: 60 });
  if (!rl.ok) return jsonError(429, rl.code);

  const slug = slugFromUrl(req);
  if (!slug) return jsonError(404, 'catalog_unavailable');

  const sql = db();
  const clientRows = (await sql`
    SELECT id, name, contact_phone, contact_email
    FROM public.clients WHERE slug = ${slug} LIMIT 1
  `) as Array<{ id: string; name: string; contact_phone: string | null; contact_email: string | null }>;
  const c = clientRows[0];
  if (!c) return jsonError(404, 'catalog_unavailable');

  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products WHERE client_id = ${c.id}::uuid
  `) as Array<{ product_key: string }>;
  if (!enabled.some((e) => e.product_key === 'catalog')) return jsonError(404, 'catalog_unavailable');

  const products = await loadCatalogMenuProducts(sql, c.id, 'catalog');

  const cats = (await sql`
    SELECT id, name FROM public.product_categories
    WHERE client_id = ${c.id}::uuid AND deleted_at IS NULL
    ORDER BY sort_order, name
  `) as Array<{ id: string; name: string }>;

  const bundles = await loadBundles(sql, c.id, products.map((p) => p.id));

  return jsonOk(
    {
      tenant: { name: c.name, contactPhone: c.contact_phone, contactEmail: c.contact_email },
      categories: cats.map((cat) => ({
        id: cat.id,
        name: cat.name,
        productCount: products.filter((p) => p.category_id === cat.id).length,
      })),
      products: products.map((p) => {
        const b = bundles.get(p.id);
        return {
          id: p.id,
          name: p.name,
          categoryId: p.category_id,
          salePriceCents: Number(p.sale_price_cents),
          thumbKey: p.hero_image_key,
          ...(b ? { isBundle: true, bundleInStock: b.inStock, bundleComponents: b.components.map((c) => ({ name: c.name, qty: c.qty })) } : {}),
        };
      }),
    },
    { headers: { 'Cache-Control': 'public, max-age=30' } },
  );
}
