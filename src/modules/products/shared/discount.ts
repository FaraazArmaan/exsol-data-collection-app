// Client-side mirror of the backend computeSalePrice helper.
// MUST stay byte-identical to netlify/functions/_shared/products-discount.ts.
// See docs/superpowers/specs/2026-06-11-product-discounts-design.md.

export function computeSalePrice(
  priceCents: number,
  discountPct: number | null,
): number | null {
  if (discountPct == null) return null;
  return Math.round(priceCents * (1 - discountPct / 100));
}
