import type { ExporterContext, ExportResult } from './types';
import {
  amazonConditionCode, imageFilename, plainPrice, tsvEscape,
} from './format-helpers';

const HEADERS = [
  'sku', 'product-id', 'product-id-type', 'price', 'item-condition',
  'quantity', 'add-delete', 'will-ship-internationally',
  'expedited-shipping', 'item-note', 'item-is-marketplace',
  'product-name', 'brand', 'product-description', 'item-type',
  'manufacturer',
  'main-image-url',
  'other-image-url1', 'other-image-url2', 'other-image-url3', 'other-image-url4',
  'other-image-url5', 'other-image-url6', 'other-image-url7', 'other-image-url8',
  'bullet-point1', 'bullet-point2', 'bullet-point3', 'bullet-point4', 'bullet-point5',
] as const;

function productIdType(gtin: string | null): string {
  if (!gtin) return '';
  if (gtin.length === 12) return '3';
  if (gtin.length === 13) return '4';
  return '';
}

export function format(ctx: ExporterContext): ExportResult {
  const lines: string[] = [HEADERS.join('\t')];
  for (const row of ctx.rows) {
    const otherImages: string[] = [];
    for (let i = 1; i <= 8; i++) {
      otherImages.push(row.images.length > i ? imageFilename(row, i) : '');
    }
    const bullets: string[] = [];
    for (let i = 0; i < 5; i++) {
      bullets.push(row.tags[i] ?? '');
    }
    const cells: Array<string | number | null | undefined> = [
      row.sku ?? row.id,
      row.gtin ?? '',
      productIdType(row.gtin),
      plainPrice(row.price_cents),
      amazonConditionCode(row.condition),
      String(row.stock_qty ?? 0),
      'a',
      '',
      '',
      '',
      'y',
      row.name,
      row.brand ?? '',
      row.description ?? '',
      '',
      row.manufacturer ?? '',
      row.images.length > 0 ? imageFilename(row, 0) : '',
      ...otherImages,
      ...bullets,
    ];
    lines.push(cells.map(tsvEscape).join('\t'));
  }
  return {
    filename: 'products.tsv',
    contentType: 'text/tab-separated-values',
    body: lines.join('\n'),
    platformLabel: 'Amazon Inventory Loader',
  };
}
