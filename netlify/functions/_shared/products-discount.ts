// Single source of truth for the discount-percent → sale-price computation.
// Used by:
//   - u-products.ts (POST)         — compute sale_price_cents at INSERT
//   - u-products-detail.ts (PATCH) — recompute on price or discount change
//   - u-products-import.ts         — recompute per imported row
//   - ProductCommerceSection.tsx   — live preview while editing
//
// Rounding: Math.round (round-half-up). Matches parsePrice's existing convention.

export function computeSalePrice(
  priceCents: number,
  discountPct: number | null,
): number | null {
  if (discountPct == null) return null;
  return Math.round(priceCents * (1 - discountPct / 100));
}
