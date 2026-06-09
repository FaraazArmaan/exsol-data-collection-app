import type { ExporterContext, ExportResult } from './types';
import {
  csvEscape, imageFilename, metaAvailability, metaPrice,
} from './format-helpers';

const HEADERS = [
  'id', 'title', 'description', 'availability', 'condition',
  'price', 'link', 'image_link', 'brand',
] as const;

export function format(ctx: ExporterContext): ExportResult {
  const lines: string[] = [HEADERS.join(',')];
  for (const row of ctx.rows) {
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
    ];
    lines.push(cells.map(csvEscape).join(','));
  }
  return {
    filename: 'products.csv',
    contentType: 'text/csv',
    body: lines.join('\n'),
    platformLabel: 'WhatsApp Business Catalog',
  };
}
