import { describe, it, expect } from 'vitest';
import { format } from '../../netlify/functions/_shared/exporters/amazon';
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
    currency: 'USD',
    sku: 'W-1',
    stock_qty: 10,
    unit: 'each',
    status: 'active',
    hero_image_key: null,
    gtin: null,
    mpn: null,
    condition: 'new',
    availability: 'in_stock',
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

describe('amazon exporter', () => {
  it('returns the right shape', () => {
    const r = format(ctx([mkRow()]));
    expect(r.filename).toBe('products.tsv');
    expect(r.contentType).toBe('text/tab-separated-values');
    expect(r.platformLabel).toBe('Amazon Inventory Loader');
  });

  it('emits the Amazon header with tabs', () => {
    const r = format(ctx([]));
    const header = (r.body as string).split('\n')[0]!;
    const cols = header.split('\t');
    expect(cols[0]).toBe('sku');
    expect(cols[1]).toBe('product-id');
    expect(cols[2]).toBe('product-id-type');
    expect(cols[4]).toBe('item-condition');
    expect(cols.length).toBe(30);
  });

  it('maps condition to 11 for new, GTIN-13 → product-id-type 4, tags → bullets', () => {
    const r = format(ctx([mkRow({
      gtin: '1234567890123', // 13 digits → EAN
      condition: 'new',
      stock_qty: 5,
      tags: ['feature-a', 'feature-b', 'feature-c'],
    })]));
    const line = (r.body as string).split('\n')[1]!;
    const cells = line.split('\t');
    expect(cells[0]).toBe('W-1');         // sku
    expect(cells[1]).toBe('1234567890123');
    expect(cells[2]).toBe('4');           // EAN
    expect(cells[3]).toBe('19.99');
    expect(cells[4]).toBe('11');          // new
    expect(cells[5]).toBe('5');
    expect(cells[6]).toBe('a');
    expect(cells[10]).toBe('y');
    // bullets start at index 25
    expect(cells[25]).toBe('feature-a');
    expect(cells[26]).toBe('feature-b');
    expect(cells[27]).toBe('feature-c');
    expect(cells[28]).toBe('');
  });

  it('escapes embedded tabs in name', () => {
    const r = format(ctx([mkRow({ name: 'Has\ttab' })]));
    const line = (r.body as string).split('\n')[1]!;
    const cells = line.split('\t');
    // product-name is at index 11; tab should be replaced with space
    expect(cells[11]).toBe('Has tab');
  });
});
