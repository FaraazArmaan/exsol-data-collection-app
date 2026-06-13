import { describe, it, expect } from 'vitest';
import { formatRupees, formatOrderNo } from '../lib/money';

describe('formatRupees', () => {
  it('formats zero', () => expect(formatRupees(0)).toBe('₹0'));
  it('formats whole rupees', () => expect(formatRupees(22000)).toBe('₹220'));
  it('formats fractional with comma grouping (Indian numbering)', () =>
    expect(formatRupees(128050)).toBe('₹1,280.50'));
  it('formats large whole', () => expect(formatRupees(2864000)).toBe('₹28,640'));
  it('formats negative', () => expect(formatRupees(-128050)).toBe('-₹1,280.50'));
});

describe('formatOrderNo', () => {
  it('pads to 5 digits with S- prefix', () => {
    expect(formatOrderNo(1)).toBe('S-00001');
    expect(formatOrderNo(42)).toBe('S-00042');
    expect(formatOrderNo(99999)).toBe('S-99999');
  });
  it('does not truncate past 5 digits', () => {
    expect(formatOrderNo(100000)).toBe('S-100000');
  });
});
