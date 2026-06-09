import type { ExporterContext, ExportResult } from './types';
import { csvEscape, imageFilename, plainPrice } from './format-helpers';

const HEADERS = [
  'id', 'type', 'name', 'description', 'category', 'brand', 'tags',
  'price', 'currency', 'sku', 'stock_qty', 'unit', 'status',
  'gtin', 'mpn', 'condition', 'availability',
  'sale_price', 'sale_starts_at', 'sale_ends_at',
  'weight_grams', 'length_mm', 'width_mm', 'height_mm',
  'color', 'size', 'material', 'gender', 'age_group',
  'manufacturer', 'country_of_origin', 'hsn_code', 'gst_rate',
  'google_category', 'meta_category', 'product_url',
  'image_main', 'images_additional',
  'created_at', 'updated_at',
] as const;

export function format(ctx: ExporterContext): ExportResult {
  const lines: string[] = [HEADERS.join(',')];
  for (const row of ctx.rows) {
    const mainImg = row.images.length > 0 ? imageFilename(row, 0) : '';
    const additional = row.images.length > 1
      ? row.images.slice(1).map((_, i) => imageFilename(row, i + 1)).join('|')
      : '';
    const r = row as unknown as Record<string, unknown>;
    const cells: Array<string | number | null | undefined> = [
      row.id,
      row.type,
      row.name,
      row.description,
      row.category_name,
      row.brand,
      row.tags.join('|'),
      plainPrice(row.price_cents),
      row.currency,
      row.sku,
      row.stock_qty,
      row.unit,
      row.status,
      row.gtin,
      row.mpn,
      row.condition,
      row.availability,
      row.sale_price_cents != null ? plainPrice(row.sale_price_cents) : '',
      row.sale_starts_at,
      row.sale_ends_at,
      row.weight_grams,
      row.length_mm,
      row.width_mm,
      row.height_mm,
      row.color,
      row.size,
      row.material,
      row.gender,
      row.age_group,
      row.manufacturer,
      row.country_of_origin,
      row.hsn_code,
      row.gst_rate,
      row.google_category,
      row.meta_category,
      row.product_url,
      mainImg,
      additional,
      (r['created_at'] as string | null | undefined) ?? '',
      (r['updated_at'] as string | null | undefined) ?? '',
    ];
    lines.push(cells.map(csvEscape).join(','));
  }
  return {
    filename: 'products.csv',
    contentType: 'text/csv',
    body: lines.join('\n'),
    platformLabel: 'Generic CSV',
  };
}
