import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCsvBytes,
  parseDecimal, parseIntCell, parseTimestamp, parseEnum,
} from '../../netlify/functions/_shared/products-import-parse';
import type { FieldError } from '../../netlify/functions/_shared/products-validate';

describe('parseCsvBytes', () => {
  it('parses the valid fixture into 3 rows', () => {
    const bytes = readFileSync(join(__dirname, '../fixtures/products/import-valid.csv'));
    const r = parseCsvBytes(bytes);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]!.name).toBe('Wireless Headphones');
    expect(r.rows[0]!.price_cents).toBe(12900);
    expect(r.rows[1]!.type).toBe('service');
    expect(r.rows[1]!.stock_qty).toBeNull();
  });

  it('flags negative price + service-with-stock errors', () => {
    const bytes = readFileSync(join(__dirname, '../fixtures/products/import-mixed-errors.csv'));
    const r = parseCsvBytes(bytes);
    const errorRows = r.rows.filter((row) => row.errors.length > 0);
    expect(errorRows.length).toBeGreaterThanOrEqual(2);
    expect(errorRows.some((e) => e.errors.some((er) => er.field === 'price'))).toBe(true);
    expect(errorRows.some((e) => e.errors.some((er) => er.field === 'stock_qty'))).toBe(true);
  });
});

describe('parseDecimal', () => {
  it('parses a plain decimal', () => {
    const errs: FieldError[] = [];
    expect(parseDecimal('18.5', errs, { field: 'gst_rate', min: 0, max: 100 })).toBe(18.5);
    expect(errs).toEqual([]);
  });
  it('returns null for empty when allowNull', () => {
    const errs: FieldError[] = [];
    expect(parseDecimal(null, errs, { field: 'gst_rate', allowNull: true })).toBeNull();
    expect(errs).toEqual([]);
  });
  it('errors on out-of-range', () => {
    const errs: FieldError[] = [];
    expect(parseDecimal('120', errs, { field: 'gst_rate', max: 100 })).toBeNull();
    expect(errs).toEqual([{ field: 'gst_rate', message: 'must be <= 100' }]);
  });
  it('errors on non-numeric', () => {
    const errs: FieldError[] = [];
    parseDecimal('abc', errs, { field: 'gst_rate' });
    expect(errs).toEqual([{ field: 'gst_rate', message: 'not a number' }]);
  });
});

describe('parseIntCell', () => {
  it('parses a positive integer', () => {
    const errs: FieldError[] = [];
    expect(parseIntCell('150', errs, { field: 'weight_grams', min: 0 })).toBe(150);
  });
  it('rejects a decimal', () => {
    const errs: FieldError[] = [];
    parseIntCell('12.7', errs, { field: 'length_mm', min: 0 });
    expect(errs).toEqual([{ field: 'length_mm', message: 'must be an integer' }]);
  });
  it('rejects negative', () => {
    const errs: FieldError[] = [];
    parseIntCell('-1', errs, { field: 'weight_grams', min: 0 });
    expect(errs[0]!.message).toMatch(/>= 0/);
  });
  it('returns null on empty when allowNull', () => {
    const errs: FieldError[] = [];
    expect(parseIntCell(null, errs, { field: 'weight_grams', min: 0, allowNull: true })).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('parses YYYY-MM-DD as midnight UTC', () => {
    const errs: FieldError[] = [];
    expect(parseTimestamp('2026-07-15', errs, { field: 'sale_starts_at' }))
      .toBe('2026-07-15T00:00:00.000Z');
  });
  it('passes ISO through normalized', () => {
    const errs: FieldError[] = [];
    expect(parseTimestamp('2026-07-15T14:30:00Z', errs, { field: 'sale_starts_at' }))
      .toBe('2026-07-15T14:30:00.000Z');
  });
  it('returns null on empty', () => {
    const errs: FieldError[] = [];
    expect(parseTimestamp(null, errs, { field: 'sale_starts_at' })).toBeNull();
  });
  it('errors on garbage', () => {
    const errs: FieldError[] = [];
    parseTimestamp('not-a-date', errs, { field: 'sale_starts_at' });
    expect(errs[0]!.message).toMatch(/invalid date/i);
  });
});

describe('parseEnum', () => {
  const COND = ['new', 'refurbished', 'used'] as const;
  it('normalizes spacing and case', () => {
    const errs: FieldError[] = [];
    expect(parseEnum('In-Stock', ['in_stock', 'out_of_stock'] as const, errs, { field: 'availability' }))
      .toBe('in_stock');
    expect(parseEnum('NEW', COND, errs, { field: 'condition' })).toBe('new');
    expect(parseEnum('refurbished', COND, errs, { field: 'condition' })).toBe('refurbished');
    expect(errs).toEqual([]);
  });
  it('errors on mismatch', () => {
    const errs: FieldError[] = [];
    parseEnum('sometimes', ['always', 'never'] as const, errs, { field: 'cadence' });
    expect(errs[0]!.message).toMatch(/must be/);
  });
  it('returns null on empty when allowNull', () => {
    const errs: FieldError[] = [];
    expect(parseEnum(null, COND, errs, { field: 'condition', allowNull: true })).toBeNull();
  });
});

describe('parseCsvBytes header normalization', () => {
  it('exposes present_columns for the CSV header row (lowercased + trimmed)', () => {
    const csv = `SKU, name , type, gtin\nW-1,Widget,physical,1234`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.present_columns.has('sku')).toBe(true);
    expect(r.present_columns.has('name')).toBe(true);
    expect(r.present_columns.has('gtin')).toBe(true);
    // Existing columns absent from header should NOT be in the set
    expect(r.present_columns.has('brand')).toBe(false);
  });

  it('matches headers case-insensitively when reading row values', () => {
    const csv = `SKU,Name,Type,Price\nW-1,Widget,physical,12.50`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.rows[0]!.name).toBe('Widget');
    expect(r.rows[0]!.price_cents).toBe(1250);
  });
});

describe('parseRow Phase B fields', () => {
  function rowFromCsv(csv: string) {
    const r = parseCsvBytes(Buffer.from(csv));
    return r.rows[0]!;
  }

  it('reads gtin/mpn/color/size as trimmed strings', () => {
    const csv = `sku,name,type,price,gtin,mpn,color,size\nW,Widget,physical,1,  9876  ,M-1,Red,Medium`;
    const r = rowFromCsv(csv);
    expect(r.gtin).toBe('9876');
    expect(r.mpn).toBe('M-1');
    expect(r.color).toBe('Red');
    expect(r.size).toBe('Medium');
  });

  it('reads condition + availability via normalized enum', () => {
    const csv = `sku,name,type,price,condition,availability\nW,Widget,physical,1,Refurbished,Out-of-Stock`;
    const r = rowFromCsv(csv);
    expect(r.condition).toBe('refurbished');
    expect(r.availability).toBe('out_of_stock');
    expect(r.errors).toEqual([]);
  });

  it('errors on invalid condition', () => {
    const csv = `sku,name,type,price,condition\nW,Widget,physical,1,broken`;
    const r = rowFromCsv(csv);
    expect(r.errors.some((e) => e.field === 'condition')).toBe(true);
  });

  it('reads sale_price as cents', () => {
    const csv = `sku,name,type,price,sale_price\nW,Widget,physical,1,9.50`;
    const r = rowFromCsv(csv);
    expect(r.sale_price_cents).toBe(950);
  });

  it('sale_price empty cell is null (not 0)', () => {
    const csv = `sku,name,type,price,sale_price\nW,Widget,physical,1,`;
    const r = rowFromCsv(csv);
    expect(r.sale_price_cents).toBeNull();
    expect(r.errors).toEqual([]);
  });

  it('reads dimensions as integers', () => {
    const csv = `sku,name,type,price,weight_grams,length_mm,width_mm,height_mm\nW,Widget,physical,1,250,200,180,80`;
    const r = rowFromCsv(csv);
    expect(r.weight_grams).toBe(250);
    expect(r.length_mm).toBe(200);
    expect(r.width_mm).toBe(180);
    expect(r.height_mm).toBe(80);
  });

  it('reads gst_rate as decimal', () => {
    const csv = `sku,name,type,price,gst_rate\nW,Widget,physical,1,18.5`;
    const r = rowFromCsv(csv);
    expect(r.gst_rate).toBe(18.5);
  });

  it('reads sale dates as ISO strings', () => {
    const csv = `sku,name,type,price,sale_starts_at,sale_ends_at\nW,Widget,physical,1,2026-07-01,2026-07-31T23:59:59Z`;
    const r = rowFromCsv(csv);
    expect(r.sale_starts_at).toBe('2026-07-01T00:00:00.000Z');
    expect(r.sale_ends_at).toBe('2026-07-31T23:59:59.000Z');
  });

  it('reads discount_percent as decimal in (0, 100)', () => {
    const csv = `sku,name,type,price,discount_percent\nW,Widget,physical,10.00,15.5`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.rows[0]!.discount_percent).toBe(15.5);
    expect(r.rows[0]!.errors).toEqual([]);
  });

  it('errors on discount_percent <= 0 or >= 100', () => {
    for (const bad of ['0', '100', '-5']) {
      const csv = `sku,name,type,price,discount_percent\nW,Widget,physical,10.00,${bad}`;
      const r = parseCsvBytes(Buffer.from(csv));
      expect(r.rows[0]!.errors.some((e) => e.field === 'discount_percent')).toBe(true);
    }
  });

  it('absent discount_percent header → field is null, no error', () => {
    const csv = `sku,name,type,price\nW,Widget,physical,10.00`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.rows[0]!.discount_percent).toBeNull();
    expect(r.rows[0]!.errors).toEqual([]);
  });

  it('parses the full Phase B fixture without errors', () => {
    const bytes = readFileSync(join(__dirname, '../fixtures/products/import-phase-b-full.csv'));
    const r = parseCsvBytes(bytes);
    expect(r.rows).toHaveLength(3);
    expect(r.meta.error).toBe(0);
    expect(r.rows[0]!.gtin).toBe('1234567890123');
    expect(r.rows[0]!.gst_rate).toBe(18);
    expect(r.rows[0]!.country_of_origin).toBe('India');
  });

  it('absent Phase B header → field is null and not in present_columns', () => {
    const csv = `sku,name,type,price\nW,Widget,physical,1`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.present_columns.has('gtin')).toBe(false);
    expect(r.rows[0]!.gtin).toBeNull();
  });

  it('invalid sale_price → row error AND sale_price_cents stays null (not 0)', () => {
    const csv = `sku,name,type,price,sale_price\nW,Widget,physical,1,not-a-number`;
    const r = parseCsvBytes(Buffer.from(csv));
    const row = r.rows[0]!;
    expect(row.sale_price_cents).toBeNull();
    expect(row.errors.some((e) => e.field === 'sale_price')).toBe(true);
  });
});

describe('parseRow cross-field validation', () => {
  it('errors when sale_starts_at > sale_ends_at', () => {
    const csv = `sku,name,type,price,sale_starts_at,sale_ends_at\nW,Widget,physical,1,2026-08-01,2026-07-15`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.rows[0]!.errors.some((e) => e.field === 'sale_ends_at' && /before sale_starts_at/.test(e.message))).toBe(true);
  });
});

describe('XLSX date serial', () => {
  it('parses Excel date cells to ISO timestamps', () => {
    const bytes = readFileSync(join(__dirname, '../fixtures/products/import-phase-b-dates.xlsx'));
    const r = parseCsvBytes(bytes);
    expect(r.rows[0]!.sale_starts_at).toMatch(/^2026-08-01T/);
    expect(r.rows[0]!.sale_ends_at).toMatch(/^2026-08-31T/);
    expect(r.rows[0]!.errors.filter((e) => e.field.startsWith('sale_'))).toEqual([]);
  });
});
