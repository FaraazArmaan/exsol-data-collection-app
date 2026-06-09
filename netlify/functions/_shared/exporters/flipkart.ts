import * as XLSX from 'xlsx';
import type { ExporterContext, ExportResult } from './types';
import { imageFilename, plainPrice } from './format-helpers';

const HEADERS = [
  'Listing ID', 'Selling Price', 'MRP', 'Stock',
  'Procurement Type', 'Procurement SLA (days)',
  'Country of Origin', 'Shipping Provider',
  'Product ID', 'Brand', 'Color', 'Model Name', 'Description',
  'Main Image URL',
  'Other Image URL 1', 'Other Image URL 2', 'Other Image URL 3', 'Other Image URL 4',
  'Other Image URL 5', 'Other Image URL 6', 'Other Image URL 7', 'Other Image URL 8',
  'HSN Code', 'GST Rate', 'Manufacturer Name',
  'Country of Origin (Duplicate?)', 'Manufacturer Address',
] as const;

export function format(ctx: ExporterContext): ExportResult {
  const aoa: Array<Array<string | number | null>> = [HEADERS.slice() as unknown as string[]];
  for (const row of ctx.rows) {
    const otherImages: string[] = [];
    for (let i = 1; i <= 8; i++) {
      otherImages.push(row.images.length > i ? imageFilename(row, i) : '');
    }
    const country = row.country_of_origin ?? 'India';
    aoa.push([
      row.sku ?? row.id,
      plainPrice(row.price_cents),
      plainPrice(row.price_cents),
      row.stock_qty ?? 0,
      'REGULAR',
      2,
      country,
      'FLIPKART',
      row.gtin ?? '',
      row.brand ?? '',
      row.color ?? '',
      row.name,
      row.description ?? '',
      row.images.length > 0 ? imageFilename(row, 0) : '',
      ...otherImages,
      row.hsn_code ?? '',
      row.gst_rate != null ? String(row.gst_rate) : '',
      row.manufacturer ?? '',
      country,
      '',
    ]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Catalog');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    filename: 'products.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: buf,
    platformLabel: 'Flipkart Catalog',
  };
}
