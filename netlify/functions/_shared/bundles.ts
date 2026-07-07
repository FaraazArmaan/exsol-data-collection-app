// Bundle read model — resolves which of a set of products are bundles and
// whether each is fulfillable right now. Shared by pub-menu, pub-catalog (badge
// + sold-out display) and pub-sale-create (checkout guard) so the storefront and
// the charge agree on availability.
//
// A bundle is in stock iff EVERY component is orderable: availability is not
// out_of_stock/discontinued AND (stock_qty is untracked OR covers the line qty).

import type { NeonQueryFunction } from '@neondatabase/serverless';

export interface BundleComponent {
  productId: string;
  name: string;
  qty: number;
}

export interface BundleInfo {
  components: BundleComponent[];
  inStock: boolean;
}

export async function loadBundles(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  productIds: readonly string[],
): Promise<Map<string, BundleInfo>> {
  const map = new Map<string, BundleInfo>();
  if (productIds.length === 0) return map;

  const rows = (await sql`
    SELECT bi.bundle_product_id, bi.qty,
           c.id AS component_id, c.name, c.availability, c.stock_qty, c.status, c.deleted_at
    FROM public.product_bundle_items bi
    JOIN public.products c ON c.id = bi.component_product_id AND c.client_id = ${clientId}::uuid
    WHERE bi.bundle_product_id = ANY(${productIds as string[]}::uuid[])
    ORDER BY bi.bundle_product_id, bi.position
  `) as Array<{
    bundle_product_id: string; qty: number; component_id: string; name: string;
    availability: string; stock_qty: number | null; status: string; deleted_at: string | null;
  }>;

  for (const r of rows) {
    const info = map.get(r.bundle_product_id) ?? { components: [], inStock: true };
    const qty = Number(r.qty);
    const stock = r.stock_qty == null ? null : Number(r.stock_qty);
    const componentOk =
      r.status === 'active' &&
      !r.deleted_at &&
      r.availability !== 'out_of_stock' &&
      r.availability !== 'discontinued' &&
      (stock == null || stock >= qty);
    info.components.push({ productId: r.component_id, name: r.name, qty });
    if (!componentOk) info.inStock = false;
    map.set(r.bundle_product_id, info);
  }
  return map;
}
