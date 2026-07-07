// Tax computation — pure, DB-free, shared by the storefront preview and the
// authoritative checkout so they can never disagree on the tax figure.
//
// rate_bps is basis points (1800 = 18%). Two modes:
//   • exclusive — tax is added on top: total = taxable + tax.
//   • inclusive — the taxable amount already contains tax; we extract the tax
//     portion for display, and the total is unchanged (tax adds nothing).

export interface TaxConfig {
  enabled: boolean;
  rate_bps: number;
  label: string;
  inclusive: boolean;
}

export interface TaxResult {
  taxCents: number;
  // Amount to add to the order total. exclusive → taxCents; inclusive → 0.
  addToTotalCents: number;
}

export function computeTax(taxableCents: number, cfg: TaxConfig | null): TaxResult {
  if (!cfg || !cfg.enabled || cfg.rate_bps <= 0 || taxableCents <= 0) {
    return { taxCents: 0, addToTotalCents: 0 };
  }
  if (cfg.inclusive) {
    // taxable already includes tax: tax = taxable − taxable / (1 + rate).
    const base = Math.round((taxableCents * 10000) / (10000 + cfg.rate_bps));
    return { taxCents: taxableCents - base, addToTotalCents: 0 };
  }
  const taxCents = Math.round((taxableCents * cfg.rate_bps) / 10000);
  return { taxCents, addToTotalCents: taxCents };
}
