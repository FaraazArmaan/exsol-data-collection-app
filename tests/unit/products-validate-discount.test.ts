import { describe, it, expect } from 'vitest';
import { parseCreateProduct } from '../../netlify/functions/_shared/products-validate';

describe('parseCreateProduct discount_percent', () => {
  const base = { type: 'physical' as const, name: 'X', price_cents: 1000 };

  it('accepts a valid discount_percent', () => {
    const r = parseCreateProduct({ ...base, discount_percent: 20 });
    expect(r.ok).toBe(true);
  });
  it('rejects 0', () => {
    const r = parseCreateProduct({ ...base, discount_percent: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === 'discount_percent')).toBe(true);
  });
  it('rejects 100', () => {
    const r = parseCreateProduct({ ...base, discount_percent: 100 });
    expect(r.ok).toBe(false);
  });
  it('rejects -5', () => {
    const r = parseCreateProduct({ ...base, discount_percent: -5 });
    expect(r.ok).toBe(false);
  });
  it('accepts null', () => {
    const r = parseCreateProduct({ ...base, discount_percent: null });
    expect(r.ok).toBe(true);
  });
});
