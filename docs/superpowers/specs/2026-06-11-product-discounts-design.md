# Product Discounts (Discount %) — Design

**Status:** Design accepted; ready for implementation plan.
**Date:** 2026-06-11
**Predecessors:** `2026-06-09-platform-exports-design.md` (Phase B sale_price_cents + window), `2026-06-10-csv-import-phase-b-design.md` (Phase B import).
**Successor:** implementation plan at `docs/superpowers/plans/2026-06-11-product-discounts.md`.

## Problem

The Phase B work added an absolute `sale_price_cents` column and a sale window. Merchants asked for the missing entry mode: "set 20% off this product and let the system compute the sale price." Currency support (INR/AED/etc.) and a `flat_discount_amount` field were also requested but are deferred to future slices; this spec covers only Discount % and the auto-computed Discounted Price.

## Goals

- A merchant can set `discount_percent = 20` on a product and the system computes + persists `sale_price_cents` consistently.
- Editing the MRP (`price_cents`) on a discounted product automatically recomputes `sale_price_cents` server-side.
- Existing Phase B freeform `sale_price_cents` flows are preserved unchanged (backward compat).
- CSV/XLSX import + the generic Catalog export round-trip the new `discount_percent` field.
- Platform exporters (Meta, WhatsApp, Amazon, Flipkart) keep emitting the absolute `sale_price` — no platform changes.

## Non-goals

- Multi-currency support. Phase B locked to USD; that constraint carries forward.
- Flat discount amount as a separate field. The current `sale_price_cents` already covers the "I just want to type a sale price" workflow.
- `discount_type: 'percent' | 'flat'` enum. Single percentage column is sufficient for what was asked.
- Tiered discounts, time-of-day promotions, coupon codes. Out of scope.
- Auto-applied discounts on cart/checkout. The product table only stores the catalog state.

## Key decisions

1. **Application-enforced invariant, not a DB CHECK.** When `discount_percent IS NOT NULL`, `sale_price_cents = round(price_cents × (1 − discount_percent / 100))`. The constraint lives in handler code + parser code, not in Postgres. Reason: keeps the existing Phase B freeform `sale_price_cents` use case alive (when `discount_percent IS NULL`, the column is freeform).
2. **Discount % is canonical when set.** UI disables the sale-price input. PATCH that sets `sale_price_cents` while `discount_percent` is non-null is rejected with `400 sale_price_locked_by_discount`. POST/import that supplies both silently override the sale price with the computed value (and emit a warning on import).
3. **No generated stored column.** Generated columns can't ALSO be freeform — adopting one would regress Phase B. The application-enforced invariant is the cost we accept for keeping both use cases.
4. **Range: 0 < discount_percent < 100.** Exclusive endpoints. A discount of 0 is meaningless (use NULL); 100 is a free product (use a separate "free" flag if needed later — not in this slice).
5. **No new currency, exporter, or UI route.** Single file changes for FE + one migration + a handful of handler edits.

## Schema

### Migration 038 (`db/migrations/038_products_discount_percent.sql`)

```sql
ALTER TABLE public.products
  ADD COLUMN discount_percent NUMERIC(5,2)
  CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent < 100));
```

Additive, no destructive ordering concerns. Apply to dev first, then prod.

### State machine

| `discount_percent` | `sale_price_cents` | Meaning |
| ------------------ | ------------------ | ------------------------------------------------------------------------------ |
| `NULL`             | `NULL`             | No sale. Existing behavior. |
| `NULL`             | non-null           | Phase B freeform sale price. Unchanged. |
| non-null           | derived            | Discount-driven sale; `sale_price_cents` is read-only in UI and recomputed server-side on every write that touches `price_cents` or `discount_percent`. |
| non-null           | `NULL`             | **Forbidden.** Handlers must never persist this combination. |

### Rounding

`Math.round(price_cents × (1 − discount_percent / 100))` — round-half-up, same convention used in `_shared/products-import-parse.ts` for price parsing.

## API contract

### `_shared/products-validate.ts`

- Add `discount_percent?: number | null` to `CreateProductInput` and to `PatchProductInput`.
- Append `'discount_percent'` to the `ALLOWED` list in `parsePatchProduct`.
- Validation rule in `parseCreateProduct` and `parsePatchProduct`:
  ```ts
  if (v.discount_percent != null && (
    typeof v.discount_percent !== 'number' ||
    v.discount_percent <= 0 ||
    v.discount_percent >= 100
  )) {
    errors.push({ field: 'discount_percent', message: 'must be > 0 and < 100 or null' });
  }
  ```

### `u-products` (POST/create)

When the request body has `discount_percent IS NOT NULL`:
- Compute `sale_price_cents` = `Math.round(price_cents × (1 − discount_percent / 100))`.
- Override any caller-supplied `sale_price_cents` in the request with the computed value (silent — log nothing extra).
- INSERT both columns.

When `discount_percent IS NULL`: existing Phase B behavior — `sale_price_cents` is whatever the caller provided (nullable).

### `u-products-detail` (PATCH)

Five distinct shapes:

1. **`{discount_percent: 20}`** — fetch existing `price_cents`, compute new `sale_price_cents`, write both columns in one statement.
2. **`{price_cents: 11000}`** — fetch existing `discount_percent`. If non-null, recompute `sale_price_cents` and include it in the UPDATE SET list. If null, leave `sale_price_cents` alone.
3. **`{discount_percent: 20, price_cents: 11000}`** — compute new sale price from the new values, write all three columns.
4. **`{discount_percent: null}`** — write `discount_percent = NULL`. Do NOT touch `sale_price_cents` — the previous derived value becomes the freeform value. The caller can clear `sale_price_cents` in a separate (or same) PATCH if they want.
5. **`{sale_price_cents: 8500}`** — alone, no `discount_percent` key in the payload — when the row currently has `discount_percent IS NOT NULL`, reject with `400` and body `{ error: 'sale_price_locked_by_discount', message: 'clear discount_percent before editing sale_price_cents' }`. The caller must either include `discount_percent: null` in the same PATCH (to clear it before freeform-editing the sale price) or use the next edge case.

**Edge: PATCH includes BOTH `discount_percent` and `sale_price_cents`.** Two sub-cases:
- `{discount_percent: 20, sale_price_cents: 8500}` — discount wins, sale price silently overridden by the computed value from the new discount. Response body returns the computed value. Consistent with POST.
- `{discount_percent: null, sale_price_cents: 8500}` — discount cleared, sale price honored as freeform 8500. The merged result is a freeform-priced row.

The unified rule: rule #5 fires only when the payload contains `sale_price_cents` without `discount_percent`, AND after applying the patch the row would still have `discount_percent IS NOT NULL`. Otherwise the merge resolves cleanly via compute or via freeform.

**Audit:** `products.updated` audit detail gains optional `discount_percent_changed_from` and `discount_percent_changed_to` keys when the column changes.

## Import

### `_shared/products-import-parse.ts`

- Append `'discount_percent'` to the `PHASE_B_HEADERS` constant (it becomes the 24th entry).
- Add `discount_percent: number | null` to `ParsedImportRow`.
- In `parseRow`, after the existing `gst_rate` parse:
  ```ts
  const discount_percent = present.has('discount_percent')
    ? parseDecimal(trimStr(raw, present, 'discount_percent'), errors, {
        field: 'discount_percent', min: 0.01, max: 99.99, allowNull: true,
      })
    : null;
  ```
  (The `min: 0.01` / `max: 99.99` enforce the exclusive 0..100 range without a separate check.)
- Append `discount_percent` to the return object.

### `u-products-import.ts`

Inside the per-row commit loop, before the INSERT/UPDATE statement (after `category_id` is resolved):

```ts
let effectiveSalePriceCents = r.sale_price_cents;
if (r.discount_percent != null) {
  const computed = Math.round(r.price_cents * (1 - r.discount_percent / 100));
  if (r.sale_price_cents != null && r.sale_price_cents !== computed) {
    warnings.push({
      row: r.row_index,
      message: 'sale_price overridden by discount_percent',
    });
  }
  effectiveSalePriceCents = computed;
}
```

Use `effectiveSalePriceCents` in both the INSERT value list and the UPDATE CASE-WHEN for `sale_price_cents`.

INSERT also needs `discount_percent` added (35th + 36th columns become 36 + 37 with the new column; the matching VALUES entry is `${r.discount_percent}`). UPDATE adds one new CASE-WHEN clause:

```sql
discount_percent  = CASE WHEN ${present.has('discount_percent')}::boolean THEN ${r.discount_percent} ELSE discount_percent END,
```

**The Phase B warning "sale price set but no sale window — will apply immediately"** must also fire when `discount_percent` is set without `sale_starts_at`. Update the warning condition to:
```ts
if ((r.sale_price_cents != null || r.discount_percent != null) && r.sale_starts_at == null) { ... }
```

### Backward compat for import

- Old CSV without `discount_percent` header → no behavior change (header absent → column not touched).
- Old product with existing `discount_percent` value → preserved by the dynamic CASE-WHEN UPDATE.
- Old product with only `sale_price_cents` set (Phase B freeform) → unchanged.

## Export

### Generic `csv.ts` and `xlsx.ts`

Append a `Discount %` column at the end of the header row. Value per row: `row.discount_percent ?? ''`.

### Platform exporters: NO changes

`meta.ts`, `whatsapp.ts`, `amazon.ts`, `flipkart.ts` already emit `sale_price` from the absolute `sale_price_cents`. The computed value is already in that column, so the platform exporters Just Work.

### `exporters/types.ts`

Add `discount_percent: number | null` to `ExportProductRow`.

### `u-products-export.ts`

The SELECT statement gains `discount_percent`. The 4 MB ceiling and ZIP wrapper logic are unchanged.

## UI

### `ProductCommerceSection.tsx`

Single-file change. Layout above the existing dates row:

```
┌────────────────────────────────────────────────────────────┐
│  Sale & promotions                                         │
├────────────────────────────────────────────────────────────┤
│  Discount %         Sale price (USD)                       │
│  ┌─────────┐        ┌──────────────┐  (auto-calculated)   │
│  │ 20.00   │        │ $79.20       │ ← disabled when % set │
│  └─────────┘        └──────────────┘                       │
│  [ Clear discount ]                                        │
│                                                            │
│  Sale starts at      Sale ends at                          │
│  ┌──────────────┐    ┌──────────────┐                      │
│  └──────────────┘    └──────────────┘                      │
└────────────────────────────────────────────────────────────┘
```

### Field states

- **`discount_percent IS NULL`** → discount % input empty/editable; sale price input is the existing freeform input; no Clear button. Identical to today.
- **`discount_percent IS NOT NULL`** → discount % input shows the value (editable, 0 < x < 100); sale price input is `disabled` with the computed cents formatted; tooltip "Auto-calculated from MRP × (1 − discount %)"; "Clear discount" button visible. Clicking Clear sets `discount_percent = null` only (does not touch sale_price_cents).
- **Editing discount %** — live client-side compute updates the sale price field while typing.
- **Editing MRP (`price_cents`)** while `discount_percent` is set — the sale price field also live-updates client-side.
- **Invalid discount % on blur** (≤ 0, ≥ 100, non-numeric) → inline per-field error, keep value visible, don't auto-clear.

### Client-side helper

```ts
function computeSalePrice(priceCents: number, discountPct: number | null): number | null {
  if (discountPct == null) return null;
  return Math.round(priceCents * (1 - discountPct / 100));
}
```

Shared between the discount-% input handler and the MRP-edit handler so the math is in one place.

### Admin view

`/clients/:clientId/products/.../edit` inherits the same `ProductCommerceSection` via `useProductsScope()`. No separate admin-side UI work.

## Testing

### Unit tests

- `parseDecimal` for `discount_percent`: parses `20`, `15.5`, `99.99`; errors on `0`, `100`, `-5`, `abc`.
- `parseRow` Phase B reads `discount_percent` only when header present.
- Cross-field: `discount_percent` set + `sale_starts_at` absent → warning emitted.
- `computeSalePrice` helper: `10000 × 80% = 8000`; `9999 × 33.33% = 6666` (round-half-up); null discount returns null.

### Integration tests

**Import** (`tests/integration/u-products-import.test.ts`):
1. `discount_percent` column alone → both columns persisted.
2. `discount_percent` + `sale_price` both present, disagreeing → warning emitted, DB has computed value.
3. Legacy CSV (no `discount_percent` header) on a row with existing discount → both columns preserved.

**API** (`tests/integration/u-products.test.ts`, `tests/integration/u-products-detail.test.ts`):
4. POST `{discount_percent: 20, price_cents: 10000}` → DB has `discount_percent=20.00`, `sale_price_cents=8000`.
5. PATCH `{discount_percent: 20}` on `price_cents=10000` → DB has both columns.
6. PATCH `{price_cents: 11000}` on a row with `discount_percent=20` → `sale_price_cents` recomputes to 8800.
7. PATCH `{discount_percent: null}` → discount cleared, sale_price unchanged.
8. PATCH `{sale_price_cents: 7500}` on a discounted row → 400 `sale_price_locked_by_discount`.
9. POST `{discount_percent: 20, sale_price_cents: 9999}` → sale price silently overridden to 8000 in response.

**Export** (`tests/integration/u-products-export.test.ts`):
10. CSV export includes `Discount %` column with the row's value.
11. Meta/WhatsApp/Amazon/Flipkart exports emit no new column; existing `sale_price` field shows the computed value.

### FE tests

If a jsdom test runner exists for `ProductCommerceSection`:
12. Render with `price_cents=10000`, type `25` in discount % → sale price input shows formatted `75.00`.
13. With `discount_percent=20`, sale price input is `disabled`.
14. Clicking Clear with `discount_percent=20` calls `onChange({discount_percent: null})` only.

### Manual smoke

- Add 20% discount on a real product; save; reload; confirm both fields persist.
- Edit MRP on that product without touching %; save; confirm `sale_price_cents` updates server-side.
- Export catalog CSV; confirm `Discount %` column; reimport same file; confirm DB unchanged.

## Migration & deployment

- One DB migration (038). Additive, no destructive ordering.
- Code can deploy before or after migration — old code ignores the new column, new code handles `discount_percent IS NULL` rows gracefully (= existing Phase B behavior).
- No new dependency, no env var, no permissions axis.

## Open risks

- **PATCH semantics nuance**: rule #4 (clearing discount leaves sale_price untouched) may surprise users who expect both to clear together. The UI's "Clear discount" button signals the boundary; the API contract is documented in the PATCH section above.
- **Rounding visibility**: `round(10000 × 0.85) = 8500` is clean, but `round(9999 × 0.8) = 7999.2 → 7999` may surprise users expecting `7999.20`. Acceptable: cents truncate, and the displayed value matches what gets saved.
- **CSV `discount_percent` + `sale_price` conflict warning** depends on the parser-time `r.sale_price_cents` vs the per-row computed value. If a future change moves the warning emission, ensure it still has access to both values at the same scope.

## Plan-completion summary

When the implementation lands:
- 1 new migration (additive).
- 1 new DB column.
- 1 new validator field + range check.
- 1 new helper (`computeSalePrice`) shared between FE and import handler.
- 2 handler edits (POST create + PATCH detail), with a third on import.
- 1 new INSERT column + 1 new dynamic UPDATE CASE-WHEN clause.
- Generic CSV/XLSX exporters gain one column each; platform exporters unchanged.
- One UI section file gets disabled-state logic + a Clear button.
- ~3 unit + ~8 integration + ~3 FE tests.

No new dependency. No new permission. No new endpoint.
