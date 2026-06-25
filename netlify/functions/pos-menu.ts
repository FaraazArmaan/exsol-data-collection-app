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

export const config = { path: '/api/pos/menu' };

interface ProductRow {
  id: string;
  name: string;
  category_id: string | null;
  sale_price_cents: number;
  hero_image_key: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const a = await requirePos(req, ['pos.menu.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const products = (await sql`
    SELECT id,
           name,
           category_id,
           COALESCE(sale_price_cents, price_cents) AS sale_price_cents,
           hero_image_key
    FROM public.products
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND pos_visible = true
      AND deleted_at IS NULL
      AND status = 'active'
    ORDER BY category_id NULLS LAST, name
  `) as ProductRow[];

  const cats = (await sql`
    SELECT id, name FROM public.product_categories
    WHERE client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
    ORDER BY sort_order, name
  `) as CategoryRow[];

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
    })),
  });
}
