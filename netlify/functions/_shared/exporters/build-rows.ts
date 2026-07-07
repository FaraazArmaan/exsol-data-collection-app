// Builds ExportProductRow[] for the STOREFRONT catalog (storefront-visible,
// active products) so the marketplace-feed endpoint can reuse the same platform
// formatters (amazon/flipkart/meta) as u-products-export. Kept separate from
// u-products-export's builder, which serves the full authenticated product
// export with its own dynamic filters + image ZIP; this one is scoped to the
// public catalog and returns just the rows (no image bytes). Shared mapping is
// acknowledged debt vs u-products-export — consolidate if a third caller appears.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { ExportProductRow } from './types';

export async function buildStorefrontExportRows(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
): Promise<{ rows: ExportProductRow[]; clientSlug: string }> {
  const clientRows = (await sql`
    SELECT slug FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ slug: string | null }>;
  const clientSlug = clientRows[0]?.slug ?? clientId.slice(0, 8);

  const productRows = (await sql`
    SELECT p.id, p.type, p.name, p.description, p.brand, p.tags,
           p.price_cents, p.currency, p.sku, p.stock_qty, p.unit, p.status,
           p.hero_image_key, p.created_at, p.updated_at,
           p.gtin, p.mpn, p.condition, p.availability,
           p.discount_percent, p.sale_price_cents, p.sale_starts_at, p.sale_ends_at,
           p.weight_grams, p.length_mm, p.width_mm, p.height_mm,
           p.color, p.size, p.material, p.gender, p.age_group,
           p.manufacturer, p.country_of_origin, p.hsn_code, p.gst_rate,
           p.google_category, p.meta_category, p.product_url, p.platform_extras,
           c.name AS category_name
    FROM public.products p
    LEFT JOIN public.product_categories c ON c.id = p.category_id AND c.deleted_at IS NULL
    WHERE p.client_id = ${clientId}::uuid
      AND p.deleted_at IS NULL
      AND p.status = 'active'
      AND p.storefront_visible = true
    ORDER BY p.created_at DESC
  `) as Array<Record<string, unknown>>;

  const productIds = productRows.map((r) => r['id'] as string);
  const imageRows = productIds.length === 0
    ? []
    : ((await sql`
        SELECT id, product_id, blob_key, sort_order
        FROM public.product_images
        WHERE product_id = ANY(${productIds}::uuid[])
        ORDER BY product_id, sort_order ASC, created_at ASC
      `) as Array<{ id: string; product_id: string; blob_key: string; sort_order: number }>);

  const imagesByProduct = new Map<string, Array<{ id: string; blob_key: string; sort_order: number }>>();
  for (const ir of imageRows) {
    const list = imagesByProduct.get(ir.product_id) ?? [];
    list.push({ id: ir.id, blob_key: ir.blob_key, sort_order: ir.sort_order });
    imagesByProduct.set(ir.product_id, list);
  }

  const rows: ExportProductRow[] = productRows.map((r) => {
    const id = r['id'] as string;
    const gstRaw = r['gst_rate'] as string | number | null;
    return {
      id,
      type: r['type'] as 'physical' | 'service',
      name: r['name'] as string,
      description: (r['description'] as string | null) ?? null,
      category_name: (r['category_name'] as string | null) ?? null,
      brand: (r['brand'] as string | null) ?? null,
      tags: (r['tags'] as string[] | null) ?? [],
      price_cents: Number(r['price_cents']),
      currency: r['currency'] as string,
      sku: (r['sku'] as string | null) ?? null,
      stock_qty: r['stock_qty'] == null ? null : Number(r['stock_qty']),
      unit: (r['unit'] as string | null) ?? null,
      status: r['status'] as 'active' | 'draft' | 'archived',
      hero_image_key: (r['hero_image_key'] as string | null) ?? null,
      gtin: (r['gtin'] as string | null) ?? null,
      mpn: (r['mpn'] as string | null) ?? null,
      condition: (r['condition'] as 'new' | 'refurbished' | 'used') ?? 'new',
      availability: (r['availability'] as 'in_stock' | 'out_of_stock' | 'preorder' | 'discontinued') ?? 'in_stock',
      discount_percent: r['discount_percent'] == null ? null : Number(r['discount_percent']),
      sale_price_cents: r['sale_price_cents'] == null ? null : Number(r['sale_price_cents']),
      sale_starts_at: (r['sale_starts_at'] as string | null) ?? null,
      sale_ends_at: (r['sale_ends_at'] as string | null) ?? null,
      weight_grams: r['weight_grams'] == null ? null : Number(r['weight_grams']),
      length_mm: r['length_mm'] == null ? null : Number(r['length_mm']),
      width_mm: r['width_mm'] == null ? null : Number(r['width_mm']),
      height_mm: r['height_mm'] == null ? null : Number(r['height_mm']),
      color: (r['color'] as string | null) ?? null,
      size: (r['size'] as string | null) ?? null,
      material: (r['material'] as string | null) ?? null,
      gender: (r['gender'] as string | null) ?? null,
      age_group: (r['age_group'] as string | null) ?? null,
      manufacturer: (r['manufacturer'] as string | null) ?? null,
      country_of_origin: (r['country_of_origin'] as string | null) ?? null,
      hsn_code: (r['hsn_code'] as string | null) ?? null,
      gst_rate: gstRaw == null ? null : Number(gstRaw),
      google_category: (r['google_category'] as string | null) ?? null,
      meta_category: (r['meta_category'] as string | null) ?? null,
      product_url: (r['product_url'] as string | null) ?? null,
      platform_extras: (r['platform_extras'] as Record<string, unknown>) ?? {},
      images: imagesByProduct.get(id) ?? [],
      ...{ created_at: r['created_at'], updated_at: r['updated_at'] },
    } as ExportProductRow;
  });

  return { rows, clientSlug };
}
