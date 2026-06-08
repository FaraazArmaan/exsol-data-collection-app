import { describe, it, expect } from 'vitest';
import {
  parseCreateProduct, parsePatchProduct, validateTypeFields,
} from '../../netlify/functions/_shared/products-validate';

describe('parseCreateProduct', () => {
  it('accepts a valid physical product', () => {
    const r = parseCreateProduct({
      type: 'physical', name: 'Widget', price_cents: 1500,
      sku: 'W-1', stock_qty: 10, unit: 'each',
      category_id: '00000000-0000-0000-0000-000000000001',
      status: 'draft',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects service rows that include stock_qty', () => {
    const r = parseCreateProduct({
      type: 'service', name: 'Repair', price_cents: 8000, stock_qty: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.field).toBe('stock_qty');
  });

  it('rejects negative prices', () => {
    const r = parseCreateProduct({ type: 'physical', name: 'X', price_cents: -1 });
    expect(r.ok).toBe(false);
  });

  it('rejects names over 120 chars', () => {
    const r = parseCreateProduct({ type: 'physical', name: 'x'.repeat(121), price_cents: 0 });
    expect(r.ok).toBe(false);
  });
});

describe('parsePatchProduct', () => {
  it('rejects empty patch', () => {
    const r = parsePatchProduct({});
    expect(r.ok).toBe(false);
  });

  it('accepts a single-field patch', () => {
    const r = parsePatchProduct({ name: 'Renamed' });
    expect(r.ok).toBe(true);
  });
});

describe('validateTypeFields', () => {
  it('null SKU/stock/unit on service: ok', () => {
    expect(validateTypeFields({ type: 'service' })).toEqual([]);
  });
  it('SKU on service: error', () => {
    expect(validateTypeFields({ type: 'service', sku: 'X' })[0]!.field).toBe('sku');
  });
});
