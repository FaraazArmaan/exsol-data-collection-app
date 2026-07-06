import { describe, it, expect } from 'vitest';
import { formatMoney, currencyMeta, isSupportedCurrency, DEFAULT_CURRENCY } from '../../src/lib/currency';

describe('formatMoney', () => {
  it('formats INR minor units with symbol + 2 decimals + grouping', () => {
    expect(formatMoney(62000, 'INR')).toBe('₹620.00');
    expect(formatMoney(1234567, 'INR')).toBe('₹12,345.67');
    expect(formatMoney(0, 'INR')).toBe('₹0.00');
  });
  it('handles other currencies', () => {
    expect(formatMoney(1234567, 'USD')).toBe('$12,345.67');
    expect(formatMoney(5000, 'EUR')).toBe('€50.00');
    expect(formatMoney(5000, 'GBP')).toBe('£50.00');
  });
  it('respects zero-decimal currencies (JPY)', () => {
    expect(formatMoney(620, 'JPY')).toBe('¥620');
    expect(formatMoney(1234567, 'JPY')).toBe('¥1,234,567');
  });
  it('formats negatives', () => {
    expect(formatMoney(-5000, 'INR')).toBe('-₹50.00');
  });
  it('defaults to INR when code is null/undefined', () => {
    expect(formatMoney(5000)).toBe('₹50.00');
    expect(formatMoney(5000, null)).toBe('₹50.00');
    expect(currencyMeta(undefined).code).toBe(DEFAULT_CURRENCY);
  });
  it('falls back gracefully for unknown codes', () => {
    expect(formatMoney(5000, 'ZZZ')).toBe('ZZZ 50.00');
    expect(isSupportedCurrency('ZZZ')).toBe(false);
    expect(isSupportedCurrency('inr')).toBe(true);
  });
});
