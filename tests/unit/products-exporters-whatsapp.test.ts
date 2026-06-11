import { describe, it, expect } from 'vitest';
import { format } from '../../netlify/functions/_shared/exporters/whatsapp';
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

describe('whatsapp exporter', () => {
  it('returns the right shape', () => {
    const r = format(ctx([mkRow()]));
    expect(r.filename).toBe('products.csv');
    expect(r.contentType).toBe('text/csv');
    expect(r.platformLabel).toBe('WhatsApp Business Catalog');
  });

  it('emits the WhatsApp subset header', () => {
    const r = format(ctx([]));
    const header = (r.body as string).split('\n')[0];
    expect(header).toBe(
      'id,title,description,availability,condition,price,link,image_link,brand',
    );
  });

  it('maps mapped fields like Meta', () => {
    const r = format(ctx([mkRow({
      availability: 'out_of_stock', condition: 'used', price_cents: 5000, currency: 'inr',
    })]));
    const line = (r.body as string).split('\n')[1]!;
    expect(line).toContain('out of stock');
    expect(line).toContain('used');
    expect(line).toContain('50.00 INR');
  });

  it('escapes commas in description', () => {
    const r = format(ctx([mkRow({ description: 'has, comma' })]));
    const line = (r.body as string).split('\n')[1]!;
    expect(line).toContain('"has, comma"');
  });
});
