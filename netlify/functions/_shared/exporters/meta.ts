import type { ExporterContext, ExportResult } from './types';
import {
  csvEscape, imageFilename, metaAvailability, metaPrice, metaSaleDateRange,
} from './format-helpers';

const HEADERS = [
  'id', 'title', 'description', 'availability', 'condition', 'price', 'link',
  'image_link', 'brand', 'additional_image_link',
  'sale_price', 'sale_price_effective_date',
  'gtin', 'mpn', 'color', 'size', 'gender', 'age_group', 'material',
  'google_product_category', 'fb_product_category',
] as const;

export function format(ctx: ExporterContext): ExportResult {
  const lines: string[] = [HEADERS.join(',')];
  for (const row of ctx.rows) {
    const additional = row.images.length > 1
      ? row.images.slice(1).map((_, i) => imageFilename(row, i + 1)).join(',')
      : '';
    const title = row.name.length > 200 ? row.name.slice(0, 200) : row.name;
    const cells: Array<string | number | null | undefined> = [
      row.id,
      title,
      row.description,
      metaAvailability(row.availability),
      row.condition,
      metaPrice(row.price_cents, row.currency),
      row.product_url ?? '',
      row.images.length > 0 ? imageFilename(row, 0) : '',
      row.brand,
      additional,
      row.sale_price_cents != null ? metaPrice(row.sale_price_cents, row.currency) : '',
      metaSaleDateRange(row.sale_starts_at, row.sale_ends_at) ?? '',
      row.gtin,
      row.mpn,
      row.color,
      row.size,
      row.gender,
      row.age_group,
      row.material,
      row.google_category,
      row.meta_category,
    ];
    lines.push(cells.map(csvEscape).join(','));
  }
  return {
    filename: 'products.csv',
    contentType: 'text/csv',
    body: lines.join('\n'),
    platformLabel: 'Meta / Facebook Catalog',
  };
}
