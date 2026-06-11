import { describe, it, expect } from 'vitest';
import { computeSalePrice } from '../../src/modules/products/shared/discount';

describe('FE computeSalePrice (mirror of backend)', () => {
  it('returns null when discount is null', () => {
    expect(computeSalePrice(10000, null)).toBeNull();
  });
  it('computes 20% off 100.00 as 8000 cents', () => {
    expect(computeSalePrice(10000, 20)).toBe(8000);
  });
});
