// Finance FX helpers — convert an entry-currency amount to the client's base
// currency for P&L aggregation. Consumes the shared currency util (decimals per
// currency) so JPY (0 decimals) vs INR/USD (2) is handled correctly.
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { currencyMeta, DEFAULT_CURRENCY } from '../../src/lib/currency';

type SQL = NeonQueryFunction<false, false>;

/**
 * Convert `amountCents` (minor units of `entryCurrency`) into minor units of
 * `baseCurrency`. `fxRate` is base MAJOR units per 1 entry MAJOR unit
 * (e.g. USD→INR ≈ 83). Same-currency short-circuits to the input (rate ignored).
 */
export function computeBaseCents(
  amountCents: number,
  entryCurrency: string,
  baseCurrency: string,
  fxRate: number,
): number {
  if (entryCurrency.toUpperCase() === baseCurrency.toUpperCase()) return amountCents;
  const entryDec = currencyMeta(entryCurrency).decimals;
  const baseDec = currencyMeta(baseCurrency).decimals;
  const entryMajor = amountCents / 10 ** entryDec;
  const baseMajor = entryMajor * fxRate;
  return Math.round(baseMajor * 10 ** baseDec);
}

/** The client's base currency (clients.base_currency), defaulting to INR. */
export async function fetchBaseCurrency(sql: SQL, clientId: string): Promise<string> {
  const rows = (await sql`
    SELECT base_currency FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ base_currency: string }>;
  return rows[0]?.base_currency ?? DEFAULT_CURRENCY;
}

export interface CurrencyFields {
  currency: string;
  fx_rate: number;
  amount_base_cents: number;
}

/**
 * Resolve the stored currency triple for an expense. Entry currency defaults to
 * the client base (rate 1, base == entry amount). A foreign currency requires a
 * positive fx_rate — returns { error: 'fx_rate_required' } otherwise so the
 * handler can 400. Shared by create / patch / recurring materialization.
 */
export function resolveCurrency(
  amountCents: number,
  base: string,
  entryCurrency: string | undefined,
  fxRate: number | undefined,
): CurrencyFields | { error: 'fx_rate_required' } {
  const currency = (entryCurrency ?? base).toUpperCase();
  if (currency === base.toUpperCase()) {
    return { currency, fx_rate: 1, amount_base_cents: amountCents };
  }
  if (!(fxRate && fxRate > 0)) return { error: 'fx_rate_required' };
  return {
    currency,
    fx_rate: fxRate,
    amount_base_cents: computeBaseCents(amountCents, currency, base, fxRate),
  };
}
