// Shared currency util — the single place money is formatted, client AND server
// (imported by React components and Netlify functions alike). Amounts are stored
// throughout the app as integer MINOR units (paise / cents); pass a client's
// clients.base_currency (migration 137) as the code.

export interface CurrencyMeta {
  code: string;
  symbol: string;
  decimals: number; // minor-unit exponent: INR/USD = 2, JPY = 0
}

export const DEFAULT_CURRENCY = 'INR';

const REGISTRY: Record<string, CurrencyMeta> = {
  INR: { code: 'INR', symbol: '₹', decimals: 2 },
  USD: { code: 'USD', symbol: '$', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', decimals: 2 },
  AED: { code: 'AED', symbol: 'AED ', decimals: 2 }, // ASCII symbol — PDF/WinAnsi-safe
  JPY: { code: 'JPY', symbol: '¥', decimals: 0 },
};

export function currencyMeta(code?: string | null): CurrencyMeta {
  const c = (code ?? DEFAULT_CURRENCY).toUpperCase();
  return REGISTRY[c] ?? { code: c, symbol: `${c} `, decimals: 2 };
}

export function isSupportedCurrency(code: string): boolean {
  return code.toUpperCase() in REGISTRY;
}

export function listCurrencies(): CurrencyMeta[] {
  return Object.values(REGISTRY);
}

function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format integer minor units (paise/cents) as a currency string.
 * formatMoney(62000, 'INR') → "₹620.00"; formatMoney(1234567, 'USD') → "$12,345.67";
 * formatMoney(620, 'JPY') → "¥620"; formatMoney(-5000, 'INR') → "-₹50.00".
 * Unknown codes fall back to a "<CODE> " prefix with 2 decimals.
 */
export function formatMoney(minorUnits: number, code?: string | null): string {
  const meta = currencyMeta(code);
  const negative = minorUnits < 0;
  const abs = Math.abs(Math.round(minorUnits));
  const divisor = 10 ** meta.decimals;
  const whole = Math.floor(abs / divisor);
  const frac = abs % divisor;
  const fracStr = meta.decimals > 0 ? `.${String(frac).padStart(meta.decimals, '0')}` : '';
  return `${negative ? '-' : ''}${meta.symbol}${groupThousands(String(whole))}${fracStr}`;
}
