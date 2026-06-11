import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { format } from '../../netlify/functions/_shared/exporters/flipkart';
import type { ExportProductRow, ExporterContext } from '../../netlify/functions/_shared/exporters/types';

function mkRow(overrides: Partial<ExportProductRow> = {}): ExportProductRow {
  return {
    id: 'p-1',
    type: 'physical',
    name: 'Widget',
    description: 'desc',
    category_name: null,
    brand: 'Acme',
    tags: [],
    price_cents: 1999,
    currency: 'INR',
    sku: 'W-1',
    stock_qty: 10,
    unit: 'each',
    status: 'active',
    hero_image_key: null,
    gtin: null,
    mpn: null,
    condition: 'new',
    availability: 'in_stock',
    discount_percent: null,
    sale_price_cents: null,
    sale_starts_at: null,
    sale_ends_at: null,
    weight_grams: null,
    length_mm: null,
    width_mm: null,
    height_mm: null,
    color: null,
    size: null,
    material: null,
    gender: null,
    age_group: null,
    manufacturer: null,
    country_of_origin: null,
    hsn_code: null,
    gst_rate: null,
    google_category: null,
    meta_category: null,
    product_url: null,
    platform_extras: {},
    images: [],
    ...overrides,
  };
}

function ctx(rows: ExportProductRow[]): ExporterContext {
  return { rows, clientSlug: 'acme', generatedAt: new Date('2026-06-09T00:00:00Z') };
}

function readSheet(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets['Catalog']!;
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][];
}

describe('flipkart exporter', () => {
  it('returns the right shape', () => {
    const r = format(ctx([mkRow()]));
    expect(r.filename).toBe('products.xlsx');
    expect(r.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(r.platformLabel).toBe('Flipkart Catalog');
    expect(Buffer.isBuffer(r.body)).toBe(true);
  });

  it('emits the Flipkart header in sheet "Catalog"', () => {
    const r = format(ctx([mkRow()]));
    const rows = readSheet(r.body as Buffer);
    const header = rows[0]!;
    expect(header[0]).toBe('Listing ID');
    expect(header[1]).toBe('Selling Price');
    expect(header[2]).toBe('MRP');
    expect(header[3]).toBe('Stock');
    expect(header).toContain('HSN Code');
    expect(header).toContain('GST Rate');
  });

  it('maps row values correctly', () => {
    const r = format(ctx([mkRow({
      sku: 'F-99',
      price_cents: 4999,
      stock_qty: 7,
      country_of_origin: 'India',
      gtin: '1234567890123',
      brand: 'Acme',
      color: 'Red',
    })]));
    const rows = readSheet(r.body as Buffer);
    const dataRow = rows[1]!;
    expect(dataRow[0]).toBe('F-99');
    expect(dataRow[1]).toBe('49.99');
    expect(dataRow[2]).toBe('49.99');
    expect(String(dataRow[3])).toBe('7');
    expect(dataRow[4]).toBe('REGULAR');
    expect(String(dataRow[5])).toBe('2');
    expect(dataRow[6]).toBe('India');
    expect(dataRow[7]).toBe('FLIPKART');
    expect(dataRow[8]).toBe('1234567890123');
    expect(dataRow[9]).toBe('Acme');
    expect(dataRow[10]).toBe('Red');
  });

  it('handles commas in names without breaking the sheet (XLSX is binary)', () => {
    const r = format(ctx([mkRow({ name: 'Hello, World' })]));
    const rows = readSheet(r.body as Buffer);
    // Name → Model Name column (index 11)
    expect(rows[1]![11]).toBe('Hello, World');
  });
});
