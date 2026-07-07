// Currency-aware minor-unit conversion for finance forms. Uses the shared
// currency util's per-currency decimals (JPY = 0, INR/USD = 2).
import { currencyMeta } from '../../../lib/currency';

// Major-unit string → integer minor units. '' / bad input → NaN.
export function toMinor(amountStr: string, currency: string): number {
  const n = Number(amountStr);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 10 ** currencyMeta(currency).decimals);
}

// Integer minor units → major-unit string (for prefilling inputs).
export function fromMinor(minor: number, currency: string): string {
  return (minor / 10 ** currencyMeta(currency).decimals).toString();
}
