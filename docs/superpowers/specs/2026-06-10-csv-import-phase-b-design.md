# CSV / XLSX Import — Phase B Field Coverage

**Status:** Design accepted, ready for implementation plan.
**Date:** 2026-06-10
**Predecessors:** `2026-06-09-platform-exports-design.md` (defined the Phase B columns and the export side of the round-trip); `u-products-import.ts` and `_shared/products-import-parse.ts` (Phase A import for 12 columns).
**Successor:** implementation plan at `docs/superpowers/plans/2026-06-10-csv-import-phase-b.md`.

## Problem

`POST /api/u-products-import` accepts only the 12 original columns (`sku, name, type, category, brand, price, currency, stock_qty, unit, status, tags, description`). The Platform Exports Phase B work added 23 new product columns to the schema (`gtin, mpn, condition, availability, sale_price_cents, sale_starts_at, sale_ends_at, weight_grams, length_mm, width_mm, height_mm, color, size, material, gender, age_group, manufacturer, country_of_origin, hsn_code, gst_rate, google_category, meta_category, product_url`) plus a `platform_extras` JSONB. Exports emit them; imports ignore them. This slice closes that gap.

## Goals

- A user who exports their catalog (any of the 6 formats), edits the CSV/XLSX, and re-imports gets a faithful round-trip for the 23 new columns where the format allows it.
- A user with an old 12-column CSV continues to get exactly the same behavior they get today — Phase B columns on existing products are NEVER silently wiped.
- The validation, type coercion, and error reporting follow the same shape (per-row `errors` and `warnings`) the existing import already uses.

## Non-goals

- `platform_extras` import. CSV is a flat format; nested JSON-in-cell is the wrong abstraction. Power users use the PATCH API.
- A column-config UI ("select which columns to include in this import"). Out of scope for this slice.
- A "Download template" button in the import modal. Acknowledged as a future polish.
- Currency support beyond USD. Phase A locked to USD; that constraint carries forward to `sale_price`.

## Key decisions

1. **`platform_extras` skipped in v1.** The CSV format doesn't try to represent it. Documented in the import-modal copy.
2. **Header-presence semantics on UPDATE.** Only columns whose header appears in the uploaded file participate in the UPDATE. Within those, an empty cell clears the column (sets NULL). Effect: old CSVs are safe; deliberate clears are still possible.
3. **Enum coercion is normalize-then-match.** Lowercase, replace `[\s-]` with `_`, then match the whitelist. Failures emit row errors; no silent defaulting.
4. **One parser, not two.** Existing `_shared/products-import-parse.ts` is extended in place. No header-sniffing routing or parallel parsers.
5. **`sale_price` is the CSV header, NUMERIC(5,2) for `gst_rate` is the storage type.** Header naming matches existing style (`price`, not `price_cents`); storage stays consistent with the rest of the products table.

## Column map

23 new optional headers. Snake_case to match the existing 12. **Header matching is case-insensitive and trim-tolerant** — `GTIN`, `  gtin  `, and `gtin` all reach the same parser path. The normalized lowercase form is what `present_columns` holds.

| CSV header                       | DB column            | Parser output                  | Validation / coercion                                                                                       |
| -------------------------------- | -------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `gtin`                           | `gtin`               | `string \| null`               | trim; empty → null                                                                                          |
| `mpn`                            | `mpn`                | `string \| null`               | trim; empty → null                                                                                          |
| `condition`                      | `condition`          | `'new'\|'refurbished'\|'used'` | normalize, whitelist; mismatch → row error                                                                  |
| `availability`                   | `availability`       | enum                           | normalize, whitelist (`in_stock,out_of_stock,preorder,discontinued`); mismatch → row error                  |
| `sale_price`                     | `sale_price_cents`   | `number \| null` (cents)       | parse as decimal; empty → null (valid); ×100 rounded; negative → row error                                  |
| `sale_starts_at`                 | `sale_starts_at`     | ISO string \| null             | accept `YYYY-MM-DD` (→ midnight UTC), full ISO `…T…Z`, or Excel-serial number; output normalized ISO        |
| `sale_ends_at`                   | `sale_ends_at`       | ISO string \| null             | same                                                                                                        |
| `weight_grams`                   | `weight_grams`       | `int \| null`                  | integer ≥ 0 or row error                                                                                    |
| `length_mm`, `width_mm`, `height_mm` | same             | `int \| null`                  | integer ≥ 0 or row error                                                                                    |
| `color`, `size`, `material`, `gender`, `age_group` | same | `string \| null`              | trim                                                                                                        |
| `manufacturer`, `country_of_origin`, `hsn_code`   | same | `string \| null`              | trim                                                                                                        |
| `gst_rate`                       | `gst_rate`           | `number \| null` (decimal)     | decimal 0–100; persisted as `NUMERIC(5,2)`                                                                  |
| `google_category`, `meta_category`, `product_url` | same | `string \| null`              | trim; no URL validation                                                                                     |

Plus the existing 12 columns — behavior unchanged.

## Cross-field validation

- If both `sale_starts_at` and `sale_ends_at` are present and start > end → row error on `sale_ends_at`.
- If `sale_price` is set but `sale_starts_at` is absent or null → row warning ("sale price set but no sale window — will apply immediately").

## Parser changes — `_shared/products-import-parse.ts`

- `ParsedImport` gains `present_columns: Set<string>` (per-file, computed once from the XLSX header row).
- `ParsedImportRow` gains 23 nullable fields matching the table above.
- New pure helpers, each `(input: string | null, errors: FieldError[], opts) → parsed | null`:
  - `parseDecimal(s, errors, opts: { field; min?; max?; allowNull: true })` — used by `sale_price` and `gst_rate`.
  - `parseIntCell(s, errors, opts: { field; min: number; allowNull: true })` — used by `weight_grams` and the three dimensions. Named `parseIntCell` to avoid shadowing global `parseInt`.
  - `parseTimestamp(s, errors, opts: { field })` — accepts `YYYY-MM-DD`, full ISO, or Excel-serial number via `XLSX.SSF.parse_date_code`. Output is always a normalized ISO string with `Z` suffix.
  - `parseEnum<T>(s, whitelist: readonly T[], errors, opts: { field; allowNull: true })` — normalize-then-match.
- `parseRow(raw, idx, present)` accepts the present-set so the row-shape it emits only reads fields whose header was in the file. Absent → field is `null` in the row, no errors emitted, and the handler skips that column on UPDATE.

## Handler changes — `u-products-import.ts`

- INSERT remains a single static SQL template; every Phase A and Phase B product column is listed and `null` is sent for any absent / empty field — appropriate because a new product is fully specified by what was provided.
- UPDATE switches to a fragment-composed SET clause walking `present_columns ∩ phase_b_cols`. Sketch:
  ```ts
  const sets = [
    sql`type = ${r.type}::product_type`,
    sql`name = ${r.name}`,
    // …existing 12 always written…
  ];
  if (present.has('gtin')) sets.push(sql`gtin = ${r.gtin}`);
  if (present.has('condition')) sets.push(sql`condition = ${r.condition}::product_condition`);
  // …one push per Phase B column…
  sets.push(sql`updated_at = now()`);
  await sql`UPDATE public.products SET ${sql.join(sets, sql`, `)} WHERE id = ${v.id}::uuid AND client_id = ${clientId}::uuid`;
  ```
  Neon's tagged-template driver supports fragment composition (`sql.join`). If a driver-version issue surfaces during implementation, the fallback is a single static template with `CASE WHEN $present_flag THEN $value ELSE col END` per column — uglier, same semantics.
- Audit payload (`logAudit` call) gains `phase_b_columns_touched: number` in `detail` so a quick `SELECT detail FROM audit_log` shows the Phase B import volume.

Permission gate is unchanged: `products.products.create` to enter, `.edit` checked lazily for UPDATE rows.

## API contract — unchanged

Same endpoint, same `?dry_run=1` flag, same `ImportDryRun` response shape (`{ valid, errors, warnings, summary, committed?, created_ids?, updated_ids? }`). The FE `ProductImportModal` requires no changes for v1.

## Testing

### New fixtures (`tests/fixtures/products/`)

- `import-phase-b-full.csv` — 3 rows, every Phase A + Phase B column populated. Round-trip baseline.
- `import-phase-b-partial.csv` — 3 rows, headers = `sku,name,type,price,condition,gst_rate` (the two Phase B columns being tested are `condition` and `gst_rate`). Confirms absent headers don't blank existing data on UPDATE.
- `import-phase-b-errors.csv` — bad enums (`Refurbish`), negative `weight_grams`, `gst_rate=120`, `sale_starts > sale_ends`, `length_mm=12.7`. Every error class at least once.
- `import-phase-b-dates.xlsx` — one fixture with a real Excel date cell (binary), to cover the SSF-serial path.

### Unit tests (additions to `products-import-parse.test.ts`)

- `present_columns` reflects the actual header row.
- Each helper happy-path + each documented error class.
- Enum normalization: `'In Stock'`, `'in-stock'`, `'IN_STOCK'` all → `'in_stock'`; `'sometimes'` → row error.
- Excel-serial date via the XLSX fixture.
- Cross-field: starts > ends.

### Integration tests (additions to `u-products-import.test.ts`)

- **Backward compat:** seed a product with all Phase B columns populated, import the existing 12-column legacy fixture matching by SKU → Phase B columns unchanged in DB.
- **Phase B happy path:** import `phase-b-full.csv` → all 23 columns written; verify a re-read.
- **Partial UPDATE:** seed a product with all Phase B columns populated; import `phase-b-partial.csv` (whose only Phase B headers are `condition` and `gst_rate`) → those two are overwritten, every other Phase B column unchanged.
- **Empty-cell-clears:** seed `gtin='ABC123'`; import a CSV that includes the `gtin` header with a blank cell → `gtin` becomes NULL in DB.
- **Dry-run unchanged:** `?dry_run=1` returns the planned changes, doesn't touch DB.
- **Sale-window warning surfaces:** `sale_price` without `sale_starts_at` → warnings array gains the expected entry; commit still proceeds.

## Edge cases explicitly NOT solved here

- Stray unrecognized columns → silently ignored (matches current XLSX permissive style). Could be promoted to a warning in a later slice.
- Duplicate SKUs within the same file → last row wins (current behavior). Not changed.
- Locale-formatted decimals (`5,00` for `5.00`) → unsupported. The row-error message will say "not a number" and that's acceptable.
- `gst_rate` precision > 2 decimals → silently rounded by `NUMERIC(5,2)`. Acceptable.
- "Download template" button in the import modal — separate slice.

## Migration / deployment

No DB migration. The 23 columns already exist (migration 037). No new permission, no new endpoint, no new env var, no new dependency. Pure handler + parser change.

Bundle-hash impact: backend-only, no FE change in v1.

## Open risks

- **Driver fragment composition (`sql.join`)** — if the installed Neon driver version doesn't support it, fall back to the `CASE WHEN` template. Implementation plan should probe this in task 1 to fail fast.
- **Excel-serial date precision** — `XLSX.SSF.parse_date_code` returns a `{y,m,d,H,M,S}` struct; we'll construct a UTC ISO string from those fields. If the user's local TZ was applied at workbook authoring time, the parsed value will be off — but the same ambiguity is present in the existing `sale_starts_at` UI input (per the Phase B exports spec) so we're consistent with prior art.
