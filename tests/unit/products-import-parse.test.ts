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
