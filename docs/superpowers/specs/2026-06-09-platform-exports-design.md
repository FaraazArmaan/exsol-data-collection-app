# Platform Exports + Extended Product Schema — Design

**Date:** 2026-06-09
**Module:** Product Manager (Phase B)
**Status:** Approved
**Predecessor specs:** `docs/superpowers/specs/2026-06-08-product-manager-design.md`
**Sibling spec:** `docs/superpowers/specs/2026-06-09-admin-product-manager-view-design.md`

---

## Problem

The Product Manager today supports generic CSV/XLSX export, but the workspace owner ultimately needs to upload catalogs to Meta Catalog (which also powers WhatsApp Business catalogs), Amazon Seller Central, and Flipkart. Each platform has its own column shape and required fields. The current schema also lacks fields that those platforms require (gtin, condition, availability, weight, etc.), so even with the right output format, the data isn't there.

Additionally, two quality-of-life issues surfaced in prod smoke:
- The "Manage categories" page requires leaving the product form to add a category. Owners want to add categories inline.
- The CSV export downloads a bare CSV, but the user wants a ZIP wrapper so it composes naturally with the (forthcoming) image bundle.

## Non-goals

- Product **variants** (parent product with child SKUs for size/color combos). Phase B is "one product = one SKU". A red-S T-shirt and a blue-M T-shirt are separate product rows. Adding variants is a separate, larger spec.
- Auto-uploading catalogs to platforms via their APIs. We export files; the user uploads.
- Public/signed image URLs for image hosting. Phase B bundles images into the ZIP locally; users host elsewhere and fill in `image_link` after upload.
- Fully spec-conformant Amazon category-specific templates. We ship the generic Amazon "Inventory Loader" flat file that works for most categories. Category-specific Inventory File Templates are a separate effort.
- Flipkart category-specific templates. We ship a generic Flipkart XLSX with the common columns; Flipkart's per-category templates differ and would need per-category mappings.
- Background/async exports with email delivery. Phase B is synchronous; large catalogs return 413 with guidance.
- Editing the new fields via CSV import (existing import only handles the current schema). Importing the extended fields is a follow-up.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Variants model | One product = one SKU | Smaller scope; matches workspace owners' actual practice for now. |
| New columns | Full set (~22 cols + jsonb) | Covers all 4 platforms in this Phase B. jsonb `platform_extras` absorbs anything per-platform unique. |
| Migration shape | Additive (`ALTER TABLE … ADD COLUMN`) with DEFAULTs | Safe to run before code deploy per `feedback_destructive_migration_order` (this migration is additive, so normal order). |
| Export endpoint | One endpoint, `?format=` selector | Mirrors the existing CSV/XLSX pattern; keeps client-side surface tiny. |
| ZIP library | `jszip` (pure JS) | No native deps; same posture as `sharp` was supposed to have. Lightweight. |
| Image bundling | Inline (in the ZIP) | User asked for it; lets the user upload images separately and reference filenames. |
| Size limit | 4 MB assembled ZIP → 413 with guidance | Netlify Functions sync response cap is 6 MB; 4 MB ZIP leaves headroom for the JSON error envelope path. Reasonable for small catalogs. |
| Inline category create | Typeahead combobox with `+ Create "X"` row | Single-flow UX; no modal; keeps the existing "Manage categories" page for bulk edit. |
| Existing CSV/XLSX outputs | ZIP-wrapped going forward | Consistency; user asked. Filename `products-{date}.zip` contains `products.csv` (or `.xlsx`) + `images/`. |
| Field auth on PATCH/CREATE | Existing `products.products.edit`/`.create` | No new gates; new fields ride existing permissions. |
| `availability` enum | `in_stock` / `out_of_stock` / `preorder` / `discontinued` | Mirrors Meta's vocabulary. Maps cleanly to Amazon (`InStock`/`OutOfStock`) and Flipkart (boolean). |
| `condition` enum | `new` / `refurbished` / `used` | Meta's vocabulary; Amazon needs `1`/`2-11`; mapped at export time. |

## Schema changes

Migration `037_products_platform_fields.sql` (additive only):

```sql
ALTER TABLE public.products ADD COLUMN gtin              TEXT;
ALTER TABLE public.products ADD COLUMN mpn               TEXT;
ALTER TABLE public.products ADD COLUMN condition         TEXT NOT NULL DEFAULT 'new'
  CHECK (condition IN ('new','refurbished','used'));
ALTER TABLE public.products ADD COLUMN availability      TEXT NOT NULL DEFAULT 'in_stock'
  CHECK (availability IN ('in_stock','out_of_stock','preorder','discontinued'));
ALTER TABLE public.products ADD COLUMN sale_price_cents  INT
  CHECK (sale_price_cents IS NULL OR sale_price_cents >= 0);
ALTER TABLE public.products ADD COLUMN sale_starts_at    TIMESTAMPTZ;
ALTER TABLE public.products ADD COLUMN sale_ends_at      TIMESTAMPTZ;
ALTER TABLE public.products ADD COLUMN weight_grams      INT
  CHECK (weight_grams IS NULL OR weight_grams >= 0);
ALTER TABLE public.products ADD COLUMN length_mm         INT;
ALTER TABLE public.products ADD COLUMN width_mm          INT;
ALTER TABLE public.products ADD COLUMN height_mm         INT;
ALTER TABLE public.products ADD COLUMN color             TEXT;
ALTER TABLE public.products ADD COLUMN size              TEXT;
ALTER TABLE public.products ADD COLUMN material          TEXT;
ALTER TABLE public.products ADD COLUMN gender            TEXT;
ALTER TABLE public.products ADD COLUMN age_group         TEXT;
ALTER TABLE public.products ADD COLUMN manufacturer      TEXT;
ALTER TABLE public.products ADD COLUMN country_of_origin TEXT;
ALTER TABLE public.products ADD COLUMN hsn_code          TEXT;        -- India tax classification (Flipkart, Amazon IN)
ALTER TABLE public.products ADD COLUMN gst_rate          NUMERIC(5,2);
ALTER TABLE public.products ADD COLUMN google_category   TEXT;        -- Google Product Taxonomy ID/path
ALTER TABLE public.products ADD COLUMN meta_category     TEXT;        -- Facebook product taxonomy
ALTER TABLE public.products ADD COLUMN product_url       TEXT;        -- Override deep link for platform 'link' field
ALTER TABLE public.products ADD COLUMN platform_extras   JSONB NOT NULL DEFAULT '{}'::jsonb;
```

No migration on `client_products` or other tables. No backfill required — defaults cover existing rows.

## Backend changes

### Validation

`netlify/functions/_shared/products-validate.ts` — extend `CreateProductInput` + `parseCreateProduct`:

- Add the 23 new optional fields to the type.
- New enums: `Condition`, `Availability`.
- Number checks for `sale_price_cents`, `weight_grams`, `length_mm`, `width_mm`, `height_mm`, `gst_rate`.
- ISO timestamp checks for `sale_starts_at`, `sale_ends_at`.
- Jsonb passthrough for `platform_extras` (validate it's an object; deeper validation deferred).

`netlify/functions/u-products.ts` — extend `CreateBody` zod schema with all new optional fields.

`netlify/functions/u-products-detail.ts` — extend `PatchBody` zod schema with the same.

### SQL

`u-products.ts` `handleCreate` INSERT — include all new columns with default-applying spreads.
`u-products.ts` `handleList` SELECT — include all new columns.
`u-products-detail.ts` `handleGet` SELECT — include all new columns.
`u-products-detail.ts` `handlePatch` dynamic SET clause — handle all new columns.

### Exporter module

New directory `netlify/functions/_shared/exporters/`:

| File | Responsibility |
|---|---|
| `types.ts` | `ExportResult` shape: `{ filename, contentType, body, images: ProductImage[][] }`. `ExporterContext`: products array + images-by-product-id map + client metadata. |
| `csv.ts` | Refactor of existing CSV writer. Adds all new columns. Returns plain CSV bytes (still wrapped in ZIP). |
| `xlsx.ts` | Existing XLSX (refactored). |
| `meta.ts` | Meta Catalog CSV. Columns: `id, title, description, availability, condition, price, link, image_link, brand, additional_image_link, sale_price, sale_price_effective_date, gtin, mpn, color, size, gender, age_group, material, google_product_category, fb_product_category`. |
| `whatsapp.ts` | WhatsApp Business catalog CSV. Same as Meta but subset: `id, title, description, availability, condition, price, link, image_link, brand`. |
| `amazon.ts` | Amazon Inventory Loader TSV. Columns: `sku, product-id, product-id-type, price, minimum-seller-allowed-price, maximum-seller-allowed-price, item-condition, quantity, add-delete, will-ship-internationally, expedited-shipping, item-note, item-is-marketplace, product_tax_code, product-name, brand, product-description, item-type, manufacturer, main-image-url, other-image-url1-8, bullet-point1-5`. Tab-separated. Condition mapped to Amazon's `1`-`11` codes. |
| `flipkart.ts` | Flipkart catalog XLSX. Columns: `Listing ID, Selling Price, MRP, Stock, Procurement Type, Procurement SLA (days), Country of Origin, Shipping Provider, Product ID, Brand, Color, Model Name, Description, Main Image URL, Other Image URL 1-8, HSN Code, GST Rate, Tax Code, Manufacturer Name, Manufacturer Address`. |
| `zip.ts` | `wrapInZip(result, images)`: returns `Buffer` with `<filename>` at root + `images/` folder + `README.txt`. Uses `jszip`. Throws `ExportTooLargeError` if assembled size exceeds 4 MB. |

Each exporter exposes a pure function `format(ctx: ExporterContext): ExportResult` (excluding zip wrapping).

`netlify/functions/u-products-export.ts` — refactor into a dispatcher:

```ts
const format = url.searchParams.get('format') ?? 'csv';
const rows = await fetchProducts(...);
const images = await fetchImagesForProducts(rows.map(r => r.id));
const ctx = { rows, images, client };
const result = match(format, {
  csv:       () => csv.format(ctx),
  xlsx:      () => xlsx.format(ctx),
  meta:      () => meta.format(ctx),
  whatsapp:  () => whatsapp.format(ctx),
  amazon:    () => amazon.format(ctx),
  flipkart:  () => flipkart.format(ctx),
});
const zip = await zip.wrapInZip(result, images);
return new Response(zip, {
  status: 200,
  headers: {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${result.filename.replace(/\.[^.]+$/, '')}.zip"`,
  },
});
```

### Size guard

In `zip.ts`:

```ts
const MAX_ZIP_BYTES = 4 * 1024 * 1024;
if (buffer.byteLength > MAX_ZIP_BYTES) {
  throw new ExportTooLargeError(buffer.byteLength);
}
```

Dispatcher catches `ExportTooLargeError` and returns `413 export_too_large` with details (number of products, size, suggested action).

## Frontend changes

### Form sections

`src/modules/products/workspace/components/ProductForm.tsx` — accept and pass through new fields. Add two new sections:

- `ProductCommerceSection.tsx` — gtin, mpn, condition (select), availability (select), sale_price + sale_starts_at + sale_ends_at, weight_grams.
- `ProductPhysicalAttrsSection.tsx` — length_mm, width_mm, height_mm, color, size, material, gender, age_group, manufacturer, country_of_origin.
- `ProductTaxonomySection.tsx` — google_category (free text for now), meta_category, hsn_code, gst_rate, product_url.

Collapsible by default (default-closed) so the form doesn't overwhelm. Use a `<details>` element with summary "Advanced — for platform exports".

### Typeahead category combobox

Replace the `<select>` in `ProductOrgSection.tsx` with a combobox:
- `<input>` with own dropdown menu
- Filters categories by typed text (case-insensitive contains)
- If no exact match and the user has `canManageCategories`, last item is `+ Create "<typed-text>"`
- Selecting creates the category (calls `categoriesApi.create`), then sets it as `category_id` on the draft
- Keyboard nav: ↑/↓ to navigate, Enter to select, Escape to close
- ARIA: `role="combobox"`, `aria-expanded`, `aria-controls`

Component lives at `src/modules/products/workspace/components/CategoryCombobox.tsx`. ~150 LOC.

### Export dropdown

`ProductFiltersBar.tsx` — replace the single Export button with a dropdown:

```
[ Export ▾ ]
├── Generic CSV
├── Generic XLSX
├── Meta / Facebook Catalog
├── WhatsApp Business Catalog
├── Amazon Inventory Loader
└── Flipkart Catalog
```

Each option triggers `window.location.href = productsApi.exportUrl(filters, format, { clientId })`.

The `exportUrl` helper already takes a `format` argument — just expand the union type.

### API client

`src/modules/products/shared/api.ts`:
- `productsApi.exportUrl(filters, format: 'csv' | 'xlsx' | 'meta' | 'whatsapp' | 'amazon' | 'flipkart', opts?)` — widen the type.
- All other methods unchanged.

### Types

`src/modules/products/shared/types.ts` — extend `Product` with the 23 new fields. `ProductDraft` inherits via `Omit`.

`emptyDraft()` in `ProductForm.tsx` — initialize new fields with sensible defaults (`null` for everything optional; `condition='new'`, `availability='in_stock'`).

## Exporter format details

### Meta Catalog CSV

[Source: https://www.facebook.com/business/help/120325381656392](https://www.facebook.com/business/help/120325381656392)

Required columns: `id`, `title`, `description`, `availability`, `condition`, `price`, `link`, `image_link`, `brand`.
Optional: `additional_image_link`, `sale_price`, `sale_price_effective_date`, `gtin`, `mpn`, `item_group_id`, `color`, `size`, `gender`, `age_group`, `material`, `pattern`, `shipping`, `google_product_category`, `fb_product_category`.

Mappings:
- `id` ← `products.id`
- `title` ← `products.name`
- `availability` ← `products.availability` (vocab matches: `in stock`, `out of stock`, `preorder`, `discontinued` — Meta uses spaces, we use underscores; map at export)
- `condition` ← `products.condition`
- `price` ← `(price_cents / 100).toFixed(2) + " " + currency` (e.g., `"19.99 USD"`)
- `link` ← `products.product_url ?? <fallback workspace link>`
- `image_link` ← `images[0].id` mapped to filename `images/<sku-or-id>_main.<ext>` (user replaces with hosted URL after upload)
- `additional_image_link` ← comma-separated `images[1..].id` mapped to filenames
- `sale_price` ← `(sale_price_cents / 100).toFixed(2) + " " + currency` if set
- `sale_price_effective_date` ← `<sale_starts_at>/<sale_ends_at>` in ISO-8601 format

### WhatsApp Business Catalog CSV

Same shape as Meta but only the WA-required subset: `id, title, description, availability, condition, price, link, image_link, brand`.

### Amazon Inventory Loader TSV

[Source: https://sellercentral.amazon.com/help/hub/reference/G201576400](https://sellercentral.amazon.com/help/hub/reference/G201576400)

Tab-separated. Required: `sku`, `product-id`, `product-id-type`, `price`, `item-condition`, `quantity`, `add-delete`.

Mappings:
- `sku` ← `products.sku ?? products.id` (Amazon requires unique seller SKU)
- `product-id` ← `products.gtin` (UPC/EAN)
- `product-id-type` ← `3` if GTIN looks like UPC (12 digits), `4` if EAN (13 digits), else blank
- `price` ← `(price_cents / 100).toFixed(2)` (just the number, currency inferred from marketplace)
- `item-condition` ← Amazon code: `11` = new (default), `4` = collectible-like-new, `1` = used-like-new... (map condition enum)
- `quantity` ← `products.stock_qty ?? 0`
- `add-delete` ← `"a"` always (add/update)
- `product-name` ← `products.name`
- `brand` ← `products.brand`
- `product-description` ← `products.description`
- `manufacturer` ← `products.manufacturer`
- `main-image-url` ← image filename (user fills hosted URL)
- `bullet-point1..5` ← derived from `products.tags` (first 5)

### Flipkart Catalog XLSX

[Source: https://seller.flipkart.com/index.html#help](https://seller.flipkart.com/index.html#help) — common columns across categories.

XLSX format (uses existing `xlsx` library that's already a dep for the generic XLSX export).

Mappings:
- `Listing ID` ← `products.sku ?? products.id`
- `Selling Price` ← `(price_cents / 100).toFixed(2)`
- `MRP` ← same (or use a separate MRP field if added later)
- `Stock` ← `products.stock_qty ?? 0`
- `Procurement Type` ← `REGULAR` (default)
- `Procurement SLA (days)` ← `2` (default)
- `Country of Origin` ← `products.country_of_origin ?? "India"`
- `Shipping Provider` ← `FLIPKART` (default)
- `Product ID` ← `products.gtin`
- `Brand` ← `products.brand`
- `Color` ← `products.color`
- `Model Name` ← `products.name`
- `Description` ← `products.description`
- `Main Image URL` ← filename
- `HSN Code` ← `products.hsn_code`
- `GST Rate` ← `products.gst_rate`
- `Manufacturer Name` ← `products.manufacturer`
- `Country of Origin` ← `products.country_of_origin`

### ZIP layout

```
products-{client_slug}-{YYYY-MM-DD}.zip
├── products.csv          (or .tsv / .xlsx depending on format)
├── images/
│   ├── {sku-or-id}_main.{ext}
│   ├── {sku-or-id}_1.{ext}
│   └── ...
└── README.txt
```

`README.txt` contains:
- Generated timestamp + workspace slug + format name
- Note: image links in CSV reference filenames in this ZIP. After hosting images, find-and-replace those filenames with the hosted URLs.
- Per-platform upload instructions (link to platform docs).

## Failure handling

| Case | Behavior |
|---|---|
| Catalog has 0 products | 200, empty ZIP with just README.txt explaining "no products to export" |
| Image blob missing for a product | Skip that image, continue; note in README's "issues" section |
| Assembled ZIP > 4 MB | `413 export_too_large` + JSON `{ error: { code, total_bytes, suggestion: "filter by category or status" }}` |
| Unsupported format | `400 unknown_format` |
| Permission denied | Existing `products.products.view` gate; 403 unchanged |
| jszip throw | `500 export_failed` with details |

## Tenant isolation

- All existing tenant gates (`resolveClientId`, `authenticateForPermission`) apply unchanged.
- Image fetch from `productImagesStore` is scoped by `blob_key` which embeds `clientId` — cross-tenant impossible.
- Exports are admin- and workspace-accessible (admin uses `?client=<id>`).

## Testing

### Unit tests

- `tests/unit/products-exporters/csv.test.ts` — round-trip a small catalog; assert column order, escaping, currency formatting.
- `tests/unit/products-exporters/meta.test.ts` — required field presence; price+currency format; availability enum mapping; image filename generation.
- `tests/unit/products-exporters/whatsapp.test.ts` — subset of Meta; columns match WA spec.
- `tests/unit/products-exporters/amazon.test.ts` — TSV format; tab escaping; condition code mapping (`new → 11`, `refurbished → 2`, etc).
- `tests/unit/products-exporters/flipkart.test.ts` — XLSX cell values; HSN/GST defaults; column headers match.
- `tests/unit/products-exporters/zip.test.ts` — ZIP structure (CSV at root, images/ folder, README), size guard throws past 4 MB.
- `tests/unit/category-combobox.test.tsx` — keyboard nav (↑/↓/Enter/Escape); "+ Create" only appears when no exact match AND user has permission; create flow calls categoriesApi.create then sets category_id.

### Integration tests

- `tests/integration/u-products-export-platforms.test.ts` — for each of `csv,xlsx,meta,whatsapp,amazon,flipkart`:
  - Seed 3 products with images.
  - Hit `/api/u-products-export?format=<fmt>` as workspace user.
  - Assert 200, `content-type: application/zip`, parseable ZIP with expected files.
- `tests/integration/u-products-extended-fields.test.ts` — create + update with all new fields; assert round-trip via detail GET.
- `tests/integration/u-products-export-too-large.test.ts` — seed enough products/images to push past 4 MB; assert 413.

### Manual FE smoke

- Open `/c/<slug>/products/new` → "Advanced" section collapsed → expand → fill gtin/condition/availability/etc → Save → reload → fields populated.
- Category combobox: type a new name → "+ Create" appears → click → category appears and is selected.
- Export dropdown shows all 6 options.
- Each export downloads a ZIP. Opening the ZIP shows the right shape.

## Risks & follow-ups

- **6 MB sync response limit** — even with 4 MB ZIP guard, large workspaces will hit this. Phase C: async export → Blobs → signed download link.
- **Public image URLs** — `image_link` in CSV is a filename, not a URL. Some users will be confused. README guidance + UI tooltip should help. Phase C: short-lived signed URLs.
- **Amazon category templates** — Inventory Loader is generic; many categories need category-specific Inventory File Templates with more required fields. Add per-category exporters in Phase C if demand.
- **Flipkart category-specific templates** — same as Amazon; ship generic now, per-category later.
- **CSV import doesn't accept new fields** — Phase B explicitly out of scope; follow-up to extend `u-products-import.ts`.
- **Variants** — see non-goals. Will need a `product_variants` table + UI rework.
- **`platform_extras` jsonb** — no UI for editing it; reserved for power users / future "custom field" feature.
- **HSN/GST default in Flipkart export** — products without these fields export with blanks; Flipkart will reject. Add a "Flipkart export readiness" warning in UI for products missing HSN/GST.

## Plan reference

Implementation plan to be written at `docs/superpowers/plans/2026-06-09-platform-exports.md`.
