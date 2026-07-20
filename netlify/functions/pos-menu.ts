// GET /api/pos/menu — POS catalog read.
//
// Returns the active, POS-visible product catalog plus the category index for
// the caller's Client. `sale_price_cents` is COALESCEd onto `price_cents` so
// products without a sale override expose their base price directly. The hero
// image is returned as the storage key; the FE composes a viewable URL.
//
// Gating:
//   • bucket-user session required (401 otherwise)
//   • Client must have both `products` and `pos` enabled (412 otherwise)
//   • caller's level must hold `pos.menu.view` (403 otherwise)

import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';
import { loadCatalogMenuProducts } from './_shared/catalog-read-model';

export const config = { path: '/api/pos/menu' };

interface CategoryRow {
  id: string;
  name: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const a = await requirePos(req, ['pos.menu.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const products = await loadCatalogMenuProducts(sql, a.ctx.clientId, 'pos');

  const cats = (await sql`
    SELECT id, name FROM public.product_categories
    WHERE client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
    ORDER BY sort_order, name
  `) as CategoryRow[];
  const variants = (await sql`
    SELECT id, product_id, title,
           COALESCE(CASE WHEN sale_price_cents IS NOT NULL AND (sale_starts_at IS NULL OR sale_starts_at <= now()) AND (sale_ends_at IS NULL OR sale_ends_at > now()) THEN sale_price_cents END, price_cents) AS sale_price_cents
    FROM public.product_variants
    WHERE client_id = ${a.ctx.clientId}::uuid AND status = 'active' AND pos_visible = true
      AND availability NOT IN ('out_of_stock', 'discontinued')
    ORDER BY title
  `) as Array<{ id: string; product_id: string; title: string; sale_price_cents: number | string | null }>;
  const variantsByProduct = new Map<string, Array<{ id: string; title: string; salePriceCents: number | string | null }>>();
  for (const variant of variants) variantsByProduct.set(variant.product_id, [...(variantsByProduct.get(variant.product_id) ?? []), { id: variant.id, title: variant.title, salePriceCents: variant.sale_price_cents }]);

  return jsonOk({
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      productCount: products.filter((p) => p.category_id === c.id).length,
    })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      categoryId: p.category_id,
      salePriceCents: Number(p.sale_price_cents),
      thumbKey: p.hero_image_key,
      ...(variantsByProduct.has(p.id) ? { variants: variantsByProduct.get(p.id)!.map((variant) => ({ ...variant, salePriceCents: Number(variant.salePriceCents ?? p.sale_price_cents) })) } : {}),
    })),
  });
}
