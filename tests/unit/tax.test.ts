import { describe, it, expect } from 'vitest';
import { computeTax, type TaxConfig } from '../../netlify/functions/_shared/tax';

const cfg = (over: Partial<TaxConfig> = {}): TaxConfig => ({ enabled: true, rate_bps: 1800, label: 'GST', inclusive: false, ...over });

describe('computeTax', () => {
  it('adds exclusive tax on top', () => {
    // 18% of 10000 = 1800
    expect(computeTax(10000, cfg())).toEqual({ taxCents: 1800, addToTotalCents: 1800 });
  });

  it('extracts inclusive tax without changing the total', () => {
    // 11800 incl 18% → base 10000, tax 1800, total unchanged
    expect(computeTax(11800, cfg({ inclusive: true }))).toEqual({ taxCents: 1800, addToTotalCents: 0 });
  });

  it('rounds to the nearest paisa', () => {
    // 18% of 999 = 179.82 → 180
    expect(computeTax(999, cfg()).taxCents).toBe(180);
  });

  it('is zero when disabled, zero-rate, or non-positive taxable', () => {
    expect(computeTax(10000, cfg({ enabled: false }))).toEqual({ taxCents: 0, addToTotalCents: 0 });
    expect(computeTax(10000, cfg({ rate_bps: 0 }))).toEqual({ taxCents: 0, addToTotalCents: 0 });
    expect(computeTax(0, cfg())).toEqual({ taxCents: 0, addToTotalCents: 0 });
    expect(computeTax(10000, null)).toEqual({ taxCents: 0, addToTotalCents: 0 });
  });
});
