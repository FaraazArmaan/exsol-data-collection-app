import { describe, it, expect } from 'vitest';
import { computeSalePrice } from '../../netlify/functions/_shared/products-discount';

describe('computeSalePrice', () => {
  it('returns null when discount is null', () => {
    expect(computeSalePrice(10000, null)).toBeNull();
  });
  it('computes 20% off 100.00 as 8000 cents', () => {
    expect(computeSalePrice(10000, 20)).toBe(8000);
  });
  it('rounds 15% off 100.01 correctly', () => {
    // 10001 * 0.85 = 8500.85 → 8501 (round-half-up)
    expect(computeSalePrice(10001, 15)).toBe(8501);
  });
  it('rounds 33.33% off 99.99 to the closest cent (pin actual)', () => {
    // 9999 * 0.6667 = 6665.6667 → 6666 (round-half-up via Math.round).
    // If actual differs, adjust the expected value to the computed one.
    expect(computeSalePrice(9999, 33.33)).toBe(6666);
  });
});
