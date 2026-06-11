// GET /api/u-products-export?format=csv|xlsx|meta|whatsapp|amazon|flipkart&[filters]
//
// Dispatches to a per-platform formatter, then wraps the result + product
// images + a README.txt in a ZIP. 4 MB cap (4xx 413 when exceeded). Uses
// the same filter set as the list endpoint (minus paging).

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { productImagesStore } from './_shared/products-storage';
import { exporters, type ExportPlatform } from './_shared/exporters';
import type { ExportProductRow } from './_shared/exporters/types';
import { ExportTooLargeError } from './_shared/exporters/types';
import { wrapInZip, type ZipImage } from './_shared/exporters/zip';
import { imageFilename } from './_shared/exporters/format-helpers';

const ALLOWED_FORMATS = new Set<ExportPlatform>([
  'csv', 'xlsx', 'meta', 'whatsapp', 'amazon', 'flipkart',
]);

function isExportPlatform(v: string): v is ExportPlatform {
  return (ALLOWED_FORMATS as Set<string>).has(v);
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const auth = await authenticateForPermission(req, 'products.products.view');
  if (auth instanceof Response) return auth;
  const session = auth;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const url = new URL(req.url);
  const formatParam = url.searchParams.get('format') ?? 'csv';
  if (!isExportPlatform(formatParam)) return jsonError(400, 'unknown_format');
  const format: ExportPlatform = formatParam;

  // Same filter parsing as u-products handleList.
  const status      = url.searchParams.get('status');
  const type        = url.searchParams.get('type');
  const category_id = url.searchParams.get('category_id');
  const brand       = url.searchParams.get('brand');
  const q           = url.searchParams.get('q');
  const tags        = url.searchParams.getAll('tag');
  const qLike       = q ? `%${q.toLowerCase()}%` : null;
  const statusFilter = status === 'all' || !status ? null : status;
  const tagArr = tags.length === 0 ? null : tags;

  if (type && type !== 'physical' && type !== 'service') return jsonError(400, 'invalid_type');
  if (statusFilter && statusFilter !== 'active' && statusFilter !== 'draft' && statusFilter !== 'archived') {
    return jsonError(400, 'invalid_status');
  }

  const sql = db();

  // Look up client slug for the ZIP filename.
  const clientRows = (await sql`
    SELECT slug FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ slug: string | null }>;
  const clientSlug = clientRows[0]?.slug ?? clientId.slice(0, 8);

  // Fetch products with full Phase B field set + category name.
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
    LEFT JOIN public.product_categories c
      ON c.id = p.category_id AND c.deleted_at IS NULL
    WHERE p.client_id = ${clientId}::uuid
      AND p.deleted_at IS NULL
      AND (${type}::product_type IS NULL OR p.type = ${type}::product_type)
      AND (${category_id}::uuid IS NULL OR p.category_id = ${category_id}::uuid)
      AND (${brand}::text IS NULL OR p.brand = ${brand}::text)
      AND (${qLike}::text IS NULL OR (
        lower(p.name) LIKE ${qLike} OR
        lower(coalesce(p.sku, '')) LIKE ${qLike} OR
        lower(coalesce(p.brand, '')) LIKE ${qLike}
      ))
      AND (${tagArr}::text[] IS NULL OR p.tags @> ${tagArr}::text[])
      AND (${statusFilter}::product_status IS NULL OR p.status = ${statusFilter}::product_status)
    ORDER BY p.created_at DESC
  `) as Array<Record<string, unknown>>;

  // Fetch the ordered product_images rows for these products (one query, then group).
  const productIds = productRows.map((r) => r['id'] as string);
  const imageRows = productIds.length === 0
    ? []
    : (await sql`
        SELECT id, product_id, blob_key, sort_order
        FROM public.product_images
        WHERE product_id = ANY(${productIds}::uuid[])
        ORDER BY product_id, sort_order ASC, created_at ASC
      `) as Array<{ id: string; product_id: string; blob_key: string; sort_order: number }>;

  const imagesByProduct = new Map<string, Array<{ id: string; blob_key: string; sort_order: number }>>();
  for (const ir of imageRows) {
    const list = imagesByProduct.get(ir.product_id) ?? [];
    list.push({ id: ir.id, blob_key: ir.blob_key, sort_order: ir.sort_order });
    imagesByProduct.set(ir.product_id, list);
  }

  // Build ExportProductRow[] from SQL rows.
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
      // Keep created_at/updated_at accessible to formatters that read them via index.
      ...{ created_at: r['created_at'], updated_at: r['updated_at'] },
    } as ExportProductRow;
  });

  const ctx = {
    rows,
    clientSlug,
    generatedAt: new Date(),
  };

  const result = exporters[format](ctx);

  // Fetch image bytes from the product-images blob store. Filenames must match
  // the references the formatter wrote (so use the same imageFilename helper).
  const store = productImagesStore();
  const zipImages: ZipImage[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.images.length; i++) {
      const img = row.images[i]!;
      const bytes = await store.get(img.blob_key, { type: 'arrayBuffer' });
      if (!bytes) continue;
      zipImages.push({ path: imageFilename(row, i), bytes });
    }
  }

  let zipBytes: Buffer;
  try {
    zipBytes = await wrapInZip(result, zipImages);
  } catch (e: unknown) {
    if (e instanceof ExportTooLargeError) {
      return jsonError(413, 'export_too_large', {
        size_bytes: e.sizeBytes,
        limit: e.limit,
        suggestion: 'Filter the catalog by status or category, then export each subset.',
      });
    }
    throw e;
  }

  const today = new Date().toISOString().slice(0, 10);
  const zipFilename = `products-${clientSlug}-${today}.zip`;

  // Node Buffer isn't accepted directly by undici's Response constructor types;
  // copy into a clean ArrayBuffer (same pattern as u-products-image-thumb).
  const ab = zipBytes.buffer.slice(
    zipBytes.byteOffset,
    zipBytes.byteOffset + zipBytes.byteLength,
  ) as ArrayBuffer;
  return new Response(ab, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipFilename}"`,
      'Cache-Control': 'no-store',
    },
  });
};
