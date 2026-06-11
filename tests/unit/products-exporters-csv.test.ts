import { describe, it, expect } from 'vitest';
import { format } from '../../netlify/functions/_shared/exporters/csv';
import type { ExportProductRow, ExporterContext } from '../../netlify/functions/_shared/exporters/types';

function mkRow(overrides: Partial<ExportProductRow> = {}): ExportProductRow {
  return {
    id: 'p-1',
    type: 'physical',
    name: 'Widget',
    description: null,
    category_name: null,
    brand: null,
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

describe('csv exporter', () => {
  it('returns the right shape', () => {
    const r = format(ctx([mkRow()]));
    expect(r.filename).toBe('products.csv');
    expect(r.contentType).toBe('text/csv');
    expect(r.platformLabel).toBe('Generic CSV');
    expect(typeof r.body).toBe('string');
  });

  it('emits the canonical 41-column header', () => {
    const r = format(ctx([]));
    const header = (r.body as string).split('\n')[0]!;
    expect(header).toBe(
      'id,type,name,description,category,brand,tags,price,currency,sku,stock_qty,unit,status,gtin,mpn,condition,availability,sale_price,discount_percent,sale_starts_at,sale_ends_at,weight_grams,length_mm,width_mm,height_mm,color,size,material,gender,age_group,manufacturer,country_of_origin,hsn_code,gst_rate,google_category,meta_category,product_url,image_main,images_additional,created_at,updated_at',
    );
    expect(header.split(',').length).toBe(41);
  });

  it('maps row fields correctly', () => {
    const row = mkRow({
      id: 'p-42',
      name: 'Cool Widget',
      tags: ['featured', 'new'],
      price_cents: 1999,
      currency: 'usd',
      brand: 'Acme',
      images: [
        { id: 'i1', blob_key: 'a', sort_order: 0 },
        { id: 'i2', blob_key: 'b', sort_order: 1 },
      ],
    });
    const r = format(ctx([row]));
    const dataLine = (r.body as string).split('\n')[1]!;
    const cells = dataLine.split(',');
    expect(cells[0]).toBe('p-42');
    expect(cells[2]).toBe('Cool Widget');
    expect(cells[5]).toBe('Acme');
    expect(cells[6]).toBe('featured|new');
    expect(cells[7]).toBe('19.99');
    expect(cells[8]).toBe('usd');
    // image_main = images/W-1_main.jpg (sku-stem)
    expect(dataLine).toContain('images/W-1_main.jpg');
    expect(dataLine).toContain('images/W-1_1.jpg');
  });

  it('escapes commas in name', () => {
    const row = mkRow({ name: 'Hello, World' });
    const r = format(ctx([row]));
    const dataLine = (r.body as string).split('\n')[1]!;
    expect(dataLine).toContain('"Hello, World"');
  });

  it('emits discount_percent value in the correct column', () => {
    const row = mkRow({ discount_percent: 15, sale_price_cents: 8500 });
    const r = format(ctx([row]));
    const headerLine = (r.body as string).split('\n')[0]!;
    const dataLine = (r.body as string).split('\n')[1]!;
    const headers = headerLine.split(',');
    const discIdx = headers.indexOf('discount_percent');
    expect(discIdx).toBeGreaterThan(-1);
    const cells = dataLine.split(',');
    expect(cells[discIdx]).toBe('15');
  });
});
