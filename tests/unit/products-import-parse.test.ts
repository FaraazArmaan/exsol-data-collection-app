import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvBytes } from '../../netlify/functions/_shared/products-import-parse';

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
