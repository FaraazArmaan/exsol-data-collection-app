# Platform Exports + Extended Product Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the product schema with 23 fields needed by Meta / WhatsApp Business / Amazon / Flipkart catalogs. Refactor the export endpoint to dispatch by `?format=` to per-platform exporters (CSV/TSV/XLSX). Wrap every export in a ZIP with images and a README. Replace the category `<select>` on the edit page with a typeahead combobox that supports inline category creation.

**Architecture:** Migration `037` adds nullable columns + a `platform_extras` jsonb (with safe defaults). Validators (`CreateBody`, `PatchBody`, `parseCreateProduct`) widen to accept the new fields. Exporters live in `netlify/functions/_shared/exporters/` as pure `format(ctx)` functions returning `{ filename, contentType, body }`. A `zip.ts` helper bundles the result + images into a ZIP with a 4 MB cap. The dispatcher `u-products-export.ts` reads `?format=`, runs the matching exporter, and returns the zipped bytes. Frontend: new collapsible form sections; combobox component; expanded export dropdown.

**Tech Stack:** TypeScript, Netlify Functions v2, Neon SQL, `jszip` (new pure-JS dep), existing `xlsx` package, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-09-platform-exports-design.md`

**Binding repo rules:**
- Never `git push` without user approval.
- Never `gh pr create` (Netlify preview credits).
- Implementer verification = `npm run typecheck` + the specific tests for the task.
- Commit at the end of every task.
- Additive migrations: run on dev FIRST, then code change, then prod migration before promote (per `feedback_migration_before_deploy`).

**Branch:** Work directly on `main`.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `db/migrations/037_products_platform_fields.sql` | Migration: add 23 columns + `platform_extras` jsonb |
| `netlify/functions/_shared/exporters/types.ts` | `ExportResult`, `ExporterContext`, `ExportTooLargeError` |
| `netlify/functions/_shared/exporters/format-helpers.ts` | shared formatters: price, currency, availability enum mapping, image-filename derivation |
| `netlify/functions/_shared/exporters/csv.ts` | Generic CSV (extended columns) |
| `netlify/functions/_shared/exporters/xlsx.ts` | Generic XLSX (extended columns) |
| `netlify/functions/_shared/exporters/meta.ts` | Meta Catalog CSV |
| `netlify/functions/_shared/exporters/whatsapp.ts` | WhatsApp Business catalog CSV |
| `netlify/functions/_shared/exporters/amazon.ts` | Amazon Inventory Loader TSV |
| `netlify/functions/_shared/exporters/flipkart.ts` | Flipkart catalog XLSX |
| `netlify/functions/_shared/exporters/zip.ts` | `wrapInZip()` + size guard |
| `src/modules/products/workspace/components/ProductCommerceSection.tsx` | gtin, mpn, condition, availability, sale_price, sale dates, weight |
| `src/modules/products/workspace/components/ProductPhysicalAttrsSection.tsx` | dimensions, color, size, material, gender, age_group, manufacturer, country_of_origin |
| `src/modules/products/workspace/components/ProductTaxonomySection.tsx` | google_category, meta_category, hsn_code, gst_rate, product_url |
| `src/modules/products/workspace/components/CategoryCombobox.tsx` | typeahead with inline `+ Create` |
| `tests/unit/products-exporters-csv.test.ts` | CSV round-trip |
| `tests/unit/products-exporters-meta.test.ts` | Meta CSV columns + value formats |
| `tests/unit/products-exporters-whatsapp.test.ts` | WhatsApp CSV columns |
| `tests/unit/products-exporters-amazon.test.ts` | Amazon TSV + condition code map |
| `tests/unit/products-exporters-flipkart.test.ts` | Flipkart XLSX columns |
| `tests/unit/products-exporters-zip.test.ts` | ZIP structure + 4 MB guard |
| `tests/unit/category-combobox.test.tsx` | combobox keyboard + create flow |
| `tests/integration/u-products-export-platforms.test.ts` | end-to-end for each format |
| `tests/integration/u-products-extended-fields.test.ts` | CRUD round-trip new fields |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `jszip` |
| `netlify/functions/_shared/products-validate.ts` | Extend `CreateProductInput` + `parseCreateProduct` with new fields |
| `netlify/functions/u-products.ts` | `CreateBody` zod + INSERT + RETURNING + list SELECT include new fields |
| `netlify/functions/u-products-detail.ts` | `PatchBody` zod + GET SELECT + dynamic SET clause include new fields |
| `netlify/functions/u-products-export.ts` | Refactor to dispatcher; format-aware |
| `src/modules/products/shared/types.ts` | Extend `Product` interface with 23 new fields |
| `src/modules/products/shared/api.ts` | Widen `exportUrl` format param |
| `src/modules/products/workspace/components/ProductForm.tsx` | Mount new sections; pass through props; extend `ProductDraft` + `emptyDraft()` |
| `src/modules/products/workspace/components/ProductOrgSection.tsx` | Swap `<select>` for `<CategoryCombobox>` |
| `src/modules/products/workspace/components/ProductFiltersBar.tsx` | Replace single Export button with dropdown of 6 formats |
| `src/modules/products/workspace/pages/ProductEditPage.tsx` | New fields in `reloadProduct` setDraft + threaded through ProductForm |
| `src/lib/components.css` | `.pm-combobox`, `.pm-export-menu`, `.pm-advanced-section` styles |

---

## Task 1: Migration 037 — add platform-export fields

**Files:**
- Create: `db/migrations/037_products_platform_fields.sql`

- [ ] **Step 1: Create the migration**

Create `db/migrations/037_products_platform_fields.sql`:

```sql
-- Migration 037: extended product fields for platform exports.
-- See docs/superpowers/specs/2026-06-09-platform-exports-design.md §Schema.
-- Additive; safe to run before code deploy.

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
ALTER TABLE public.products ADD COLUMN hsn_code          TEXT;
ALTER TABLE public.products ADD COLUMN gst_rate          NUMERIC(5,2);
ALTER TABLE public.products ADD COLUMN google_category   TEXT;
ALTER TABLE public.products ADD COLUMN meta_category     TEXT;
ALTER TABLE public.products ADD COLUMN product_url       TEXT;
ALTER TABLE public.products ADD COLUMN platform_extras   JSONB NOT NULL DEFAULT '{}'::jsonb;
```

- [ ] **Step 2: Run on dev Neon**

```bash
npm run migrate
```

Expected: applies migration 037 (and any pending ones). No errors.

Verify via:

```bash
npm run migrate -- --status
```

Should show 037 applied.

- [ ] **Step 3: Confirm column shape**

```bash
psql "$DATABASE_URL" -c "\d public.products" | head -40
```

(Or use the Neon console.) Expected: all 24 new columns visible.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/037_products_platform_fields.sql
git commit -m "$(cat <<'EOF'
feat(products): migration 037 — platform export fields

Adds 23 nullable columns + platform_extras jsonb covering Meta/WA/
Amazon/Flipkart catalog requirements. All additive; existing rows
inherit defaults. Safe to deploy before code.
EOF
)"
```

---

## Task 2: Add `jszip` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install jszip@^3.10 --save-exact
```

Expected: `"jszip": "3.10.1"` (or whatever 3.10.x resolves to) in `package.json`. Pure JS, no native binaries.

- [ ] **Step 2: Smoke**

Create `scripts/jszip-smoke.mjs`:

```js
import JSZip from 'jszip';
const z = new JSZip();
z.file('hello.txt', 'hello world');
const buf = await z.generateAsync({ type: 'nodebuffer' });
console.log('ok bytes=', buf.length);
```

```bash
node scripts/jszip-smoke.mjs
rm scripts/jszip-smoke.mjs
```

Expected: `ok bytes= <positive int around 130-200>`.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: 0.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(products): add jszip for export ZIP wrapping

Pure-JS, no native deps — no external_node_modules change needed.
EOF
)"
```

---

## Task 3: Extend types + validators (backend + FE types in lockstep)

**Files:**
- Modify: `netlify/functions/_shared/products-validate.ts`
- Modify: `netlify/functions/u-products.ts` (CreateBody zod)
- Modify: `netlify/functions/u-products-detail.ts` (PatchBody zod)
- Modify: `src/modules/products/shared/types.ts`

- [ ] **Step 1: Extend the shared validator**

In `netlify/functions/_shared/products-validate.ts`, extend `CreateProductInput`:

```ts
export type Condition    = 'new' | 'refurbished' | 'used';
export type Availability = 'in_stock' | 'out_of_stock' | 'preorder' | 'discontinued';

export interface CreateProductInput {
  type: ProductType;
  name: string;
  description?: string | null;
  category_id?: string | null;
  brand?: string | null;
  tags?: string[];
  price_cents: number;
  sku?: string | null;
  stock_qty?: number | null;
  unit?: string | null;
  status?: ProductStatus;

  // Phase B platform fields
  gtin?: string | null;
  mpn?: string | null;
  condition?: Condition;
  availability?: Availability;
  sale_price_cents?: number | null;
  sale_starts_at?: string | null;     // ISO timestamp
  sale_ends_at?: string | null;
  weight_grams?: number | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  color?: string | null;
  size?: string | null;
  material?: string | null;
  gender?: string | null;
  age_group?: string | null;
  manufacturer?: string | null;
  country_of_origin?: string | null;
  hsn_code?: string | null;
  gst_rate?: number | null;
  google_category?: string | null;
  meta_category?: string | null;
  product_url?: string | null;
  platform_extras?: Record<string, unknown>;
}
```

Add helpers at the top:

```ts
function isCondition(v: unknown): v is Condition {
  return v === 'new' || v === 'refurbished' || v === 'used';
}
function isAvailability(v: unknown): v is Availability {
  return v === 'in_stock' || v === 'out_of_stock' || v === 'preorder' || v === 'discontinued';
}
```

Extend `parseCreateProduct` with validation for the new fields. After the existing checks, append:

```ts
  if (v.condition != null && !isCondition(v.condition))
    errors.push({ field: 'condition', message: 'must be new|refurbished|used' });
  if (v.availability != null && !isAvailability(v.availability))
    errors.push({ field: 'availability', message: 'must be in_stock|out_of_stock|preorder|discontinued' });
  if (v.sale_price_cents != null && (typeof v.sale_price_cents !== 'number' || !Number.isInteger(v.sale_price_cents) || v.sale_price_cents < 0))
    errors.push({ field: 'sale_price_cents', message: 'integer >= 0 or null' });
  for (const dim of ['weight_grams','length_mm','width_mm','height_mm'] as const) {
    if (v[dim] != null && (typeof v[dim] !== 'number' || !Number.isInteger(v[dim]) || (v[dim] as number) < 0))
      errors.push({ field: dim, message: 'integer >= 0 or null' });
  }
  if (v.gst_rate != null && (typeof v.gst_rate !== 'number' || v.gst_rate < 0 || v.gst_rate > 100))
    errors.push({ field: 'gst_rate', message: 'number 0-100 or null' });
  if (v.platform_extras != null && (typeof v.platform_extras !== 'object' || Array.isArray(v.platform_extras)))
    errors.push({ field: 'platform_extras', message: 'must be object or null' });
```

Don't add ALLOWED list updates to `parsePatchProduct` — its ALLOWED list will be updated in Step 2.

- [ ] **Step 2: Extend parsePatchProduct ALLOWED**

In the same file, update the ALLOWED constant:

```ts
const ALLOWED = [
  'type','name','description','category_id','brand','tags',
  'price_cents','sku','stock_qty','unit','status','hero_image_key',
  // Phase B
  'gtin','mpn','condition','availability',
  'sale_price_cents','sale_starts_at','sale_ends_at',
  'weight_grams','length_mm','width_mm','height_mm',
  'color','size','material','gender','age_group',
  'manufacturer','country_of_origin','hsn_code','gst_rate',
  'google_category','meta_category','product_url','platform_extras',
];
```

- [ ] **Step 3: Extend `CreateBody` zod in u-products.ts**

Find `const CreateBody = z.object({...})` in `netlify/functions/u-products.ts`. Add:

```ts
const CreateBody = z.object({
  // existing fields...
  type: z.enum(['physical', 'service']),
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  brand: z.string().max(120).nullable().optional(),
  tags: z.array(z.string()).max(32).optional(),
  price_cents: z.number().int().min(0),
  sku: z.string().max(80).nullable().optional(),
  stock_qty: z.number().int().min(0).nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),

  // Phase B
  gtin: z.string().max(40).nullable().optional(),
  mpn: z.string().max(80).nullable().optional(),
  condition: z.enum(['new', 'refurbished', 'used']).optional(),
  availability: z.enum(['in_stock', 'out_of_stock', 'preorder', 'discontinued']).optional(),
  sale_price_cents: z.number().int().min(0).nullable().optional(),
  sale_starts_at: z.string().datetime().nullable().optional(),
  sale_ends_at: z.string().datetime().nullable().optional(),
  weight_grams: z.number().int().min(0).nullable().optional(),
  length_mm: z.number().int().min(0).nullable().optional(),
  width_mm: z.number().int().min(0).nullable().optional(),
  height_mm: z.number().int().min(0).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  size: z.string().max(40).nullable().optional(),
  material: z.string().max(80).nullable().optional(),
  gender: z.string().max(20).nullable().optional(),
  age_group: z.string().max(20).nullable().optional(),
  manufacturer: z.string().max(120).nullable().optional(),
  country_of_origin: z.string().max(80).nullable().optional(),
  hsn_code: z.string().max(20).nullable().optional(),
  gst_rate: z.number().min(0).max(100).nullable().optional(),
  google_category: z.string().max(120).nullable().optional(),
  meta_category: z.string().max(120).nullable().optional(),
  product_url: z.string().url().max(500).nullable().optional(),
  platform_extras: z.record(z.unknown()).optional(),
});
```

- [ ] **Step 4: Extend `PatchBody` zod in u-products-detail.ts**

Same fields appended to `PatchBody` (all with `.optional()` since it's a PATCH).

- [ ] **Step 5: Extend the FE Product type**

In `src/modules/products/shared/types.ts`, extend the `Product` interface with the same 23 fields (matching nullability). Add `Condition` + `Availability` type exports.

```ts
export type Condition    = 'new' | 'refurbished' | 'used';
export type Availability = 'in_stock' | 'out_of_stock' | 'preorder' | 'discontinued';

export interface Product {
  // existing...
  hero_image_id: string | null;
  created_at: string;
  updated_at: string;

  // Phase B
  gtin: string | null;
  mpn: string | null;
  condition: Condition;
  availability: Availability;
  sale_price_cents: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  weight_grams: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  color: string | null;
  size: string | null;
  material: string | null;
  gender: string | null;
  age_group: string | null;
  manufacturer: string | null;
  country_of_origin: string | null;
  hsn_code: string | null;
  gst_rate: number | null;
  google_category: string | null;
  meta_category: string | null;
  product_url: string | null;
  platform_extras: Record<string, unknown>;
}
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Likely errors: `emptyDraft()` returns a `ProductDraft` (which is `Omit<Product, ...>`); it now needs all new fields. Add defaults in `emptyDraft()`:

```ts
export const emptyDraft = (): ProductDraft => ({
  // existing fields...
  hero_image_key: null,
  hero_image_id: null,

  // Phase B
  gtin: null,
  mpn: null,
  condition: 'new',
  availability: 'in_stock',
  sale_price_cents: null,
  sale_starts_at: null,
  sale_ends_at: null,
  weight_grams: null,
  length_mm: null,
  width_mm: null,
  height_mm: null,
  color: null,
  size: null,
  material: null,
  gender: null,
  age_group: null,
  manufacturer: null,
  country_of_origin: null,
  hsn_code: null,
  gst_rate: null,
  google_category: null,
  meta_category: null,
  product_url: null,
  platform_extras: {},
});
```

Also extend `reloadProduct` in `ProductEditPage.tsx` to thread through new fields:

```ts
setDraft({
  // existing fields...
  hero_image_key: p.hero_image_key,
  hero_image_id: p.hero_image_id,

  // Phase B
  gtin: p.gtin,
  mpn: p.mpn,
  condition: p.condition,
  availability: p.availability,
  sale_price_cents: p.sale_price_cents,
  sale_starts_at: p.sale_starts_at,
  sale_ends_at: p.sale_ends_at,
  weight_grams: p.weight_grams,
  length_mm: p.length_mm,
  width_mm: p.width_mm,
  height_mm: p.height_mm,
  color: p.color,
  size: p.size,
  material: p.material,
  gender: p.gender,
  age_group: p.age_group,
  manufacturer: p.manufacturer,
  country_of_origin: p.country_of_origin,
  hsn_code: p.hsn_code,
  gst_rate: p.gst_rate,
  google_category: p.google_category,
  meta_category: p.meta_category,
  product_url: p.product_url,
  platform_extras: p.platform_extras,
});
```

Re-run typecheck. Expect 0.

- [ ] **Step 7: Run existing product tests**

```bash
npx vitest run tests/unit/products-validate.test.ts tests/integration/u-products-list-create.test.ts tests/integration/u-products-detail.test.ts
```

Expect all passing — the type extensions are additive.

- [ ] **Step 8: Commit**

```bash
git add netlify/functions/_shared/products-validate.ts netlify/functions/u-products.ts netlify/functions/u-products-detail.ts src/modules/products/shared/types.ts src/modules/products/workspace/components/ProductForm.tsx src/modules/products/workspace/pages/ProductEditPage.tsx
git commit -m "$(cat <<'EOF'
feat(products): extend types + validators for platform fields

Widens CreateBody/PatchBody zod, parseCreateProduct, Product type,
emptyDraft, and the edit page setDraft to include the 23 new columns
introduced by migration 037. Backend persistence/SELECT updates come
in the next commit.
EOF
)"
```

---

## Task 4: Backend SQL — read + write new columns

**Files:**
- Modify: `netlify/functions/u-products.ts` (INSERT, RETURNING, list SELECT)
- Modify: `netlify/functions/u-products-detail.ts` (GET SELECT, PATCH SET clause)

- [ ] **Step 1: u-products.ts handleCreate INSERT**

Locate the INSERT in `handleCreate`. Add all 24 new columns to both the column list and VALUES clause. Use `${v.field ?? null}` for nullables; for `condition` + `availability` defer to DB default if omitted (omit from INSERT entirely when null/undefined would change behavior, OR pass the value explicitly).

For simplicity: always pass the column, using `v.field ?? null` for nullables and `v.field ?? 'new'` for condition + `v.field ?? 'in_stock'` for availability (in line with the schema DEFAULT — but explicit is fine).

Updated INSERT shape:

```sql
INSERT INTO public.products (
  client_id, type, name, description, category_id, brand, tags,
  price_cents, sku, stock_qty, unit, status, created_by_user_node,
  -- Phase B
  gtin, mpn, condition, availability,
  sale_price_cents, sale_starts_at, sale_ends_at,
  weight_grams, length_mm, width_mm, height_mm,
  color, size, material, gender, age_group,
  manufacturer, country_of_origin, hsn_code, gst_rate,
  google_category, meta_category, product_url, platform_extras
) VALUES (
  ${clientId}::uuid, ${v.type}, ${v.name}, ${v.description ?? null},
  ${v.category_id ?? null}::uuid, ${v.brand ?? null},
  ${v.tags ?? []}::text[], ${v.price_cents},
  ${v.sku ?? null}, ${v.stock_qty ?? null}, ${v.unit ?? null},
  ${v.status ?? 'draft'}, ${userNodeId}::uuid,
  -- Phase B
  ${v.gtin ?? null}, ${v.mpn ?? null},
  ${v.condition ?? 'new'}, ${v.availability ?? 'in_stock'},
  ${v.sale_price_cents ?? null}, ${v.sale_starts_at ?? null}::timestamptz, ${v.sale_ends_at ?? null}::timestamptz,
  ${v.weight_grams ?? null}, ${v.length_mm ?? null}, ${v.width_mm ?? null}, ${v.height_mm ?? null},
  ${v.color ?? null}, ${v.size ?? null}, ${v.material ?? null}, ${v.gender ?? null}, ${v.age_group ?? null},
  ${v.manufacturer ?? null}, ${v.country_of_origin ?? null}, ${v.hsn_code ?? null}, ${v.gst_rate ?? null},
  ${v.google_category ?? null}, ${v.meta_category ?? null}, ${v.product_url ?? null},
  ${JSON.stringify(v.platform_extras ?? {})}::jsonb
)
RETURNING id, type, name, description, category_id, brand, tags, price_cents, currency,
          sku, stock_qty, unit, status, hero_image_key, created_at, updated_at,
          gtin, mpn, condition, availability,
          sale_price_cents, sale_starts_at, sale_ends_at,
          weight_grams, length_mm, width_mm, height_mm,
          color, size, material, gender, age_group,
          manufacturer, country_of_origin, hsn_code, gst_rate,
          google_category, meta_category, product_url, platform_extras
```

- [ ] **Step 2: u-products.ts handleList SELECT**

Add the 24 new columns to the SELECT list. Keep the LEFT JOIN for `hero_image_id`. The list query becomes longer but no structural change.

- [ ] **Step 3: u-products-detail.ts handleGet SELECT**

Same: extend the SELECT to include all new columns.

- [ ] **Step 4: u-products-detail.ts handlePatch dynamic SET**

The PATCH handler builds a dynamic SET clause from the validated `v` object. Locate the loop / mapping that turns `v` into `SET col = $n` pairs. Add the new fields to that mapping.

For `platform_extras`, use `${JSON.stringify(v.platform_extras)}::jsonb` when present.

For `sale_starts_at` / `sale_ends_at`, cast to `::timestamptz`.

For `gst_rate`, no cast needed (numeric).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expect 0.

- [ ] **Step 6: Integration tests**

Run:

```bash
npx vitest run tests/integration/u-products-list-create.test.ts tests/integration/u-products-detail.test.ts
```

Expect all existing tests passing. Add a quick smoke test to one of them that creates a product with one new field (e.g., `gtin`) and asserts it round-trips:

```ts
test('CREATE+GET round-trip persists Phase B fields', async () => {
  const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({
      type: 'physical', name: 'Egg', price_cents: 200,
      gtin: '0123456789012', condition: 'new', availability: 'in_stock',
      weight_grams: 50, color: 'white', country_of_origin: 'IN',
      hsn_code: '0407', gst_rate: 5,
    }),
  }), CTX);
  expect(r.status).toBe(201);
  const created = await r.json() as { id: string };
  const gr = await uProductsDetailHandler(new Request(`http://localhost/api/u-products-detail/${created.id}`, {
    headers: { cookie: buCookie },
  }), CTX);
  expect(gr.status).toBe(200);
  const fetched = await gr.json() as Record<string, unknown>;
  expect(fetched.gtin).toBe('0123456789012');
  expect(fetched.condition).toBe('new');
  expect(fetched.availability).toBe('in_stock');
  expect(fetched.weight_grams).toBe(50);
  expect(fetched.gst_rate).toBe('5.00');   // numeric(5,2) returns as string
});
```

The numeric type may return as string from the Neon driver. Adjust the assertion or cast in the SELECT (e.g., `gst_rate::float8 AS gst_rate`) if the FE needs a number.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/u-products.ts netlify/functions/u-products-detail.ts tests/integration/u-products-list-create.test.ts
git commit -m "$(cat <<'EOF'
feat(products): persist + return Phase B platform fields

INSERT, list SELECT, detail SELECT, and PATCH dynamic SET clause now
handle the 23 new platform-export columns + platform_extras jsonb.
Adds a round-trip smoke test.
EOF
)"
```

---

## Task 5: Exporter helpers + shared types

**Files:**
- Create: `netlify/functions/_shared/exporters/types.ts`
- Create: `netlify/functions/_shared/exporters/format-helpers.ts`

- [ ] **Step 1: types.ts**

Create `netlify/functions/_shared/exporters/types.ts`:

```ts
import type { ProductImage } from '../../../src/modules/products/shared/types';

export interface ExportProductRow {
  id: string;
  type: 'physical' | 'service';
  name: string;
  description: string | null;
  category_name: string | null;       // joined at fetch time
  brand: string | null;
  tags: string[];
  price_cents: number;
  currency: string;
  sku: string | null;
  stock_qty: number | null;
  unit: string | null;
  status: 'active' | 'draft' | 'archived';
  hero_image_key: string | null;
  gtin: string | null;
  mpn: string | null;
  condition: 'new' | 'refurbished' | 'used';
  availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'discontinued';
  sale_price_cents: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  weight_grams: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  color: string | null;
  size: string | null;
  material: string | null;
  gender: string | null;
  age_group: string | null;
  manufacturer: string | null;
  country_of_origin: string | null;
  hsn_code: string | null;
  gst_rate: number | null;
  google_category: string | null;
  meta_category: string | null;
  product_url: string | null;
  platform_extras: Record<string, unknown>;
  images: ProductImage[];             // ordered, hero first
}

export interface ExporterContext {
  rows: ExportProductRow[];
  clientSlug: string;
  generatedAt: Date;
}

export interface ExportResult {
  /** Inner file name (e.g., 'products.csv'). Wrapped in ZIP later. */
  filename: string;
  contentType: string;
  body: string | Buffer;
  /** Human-readable name for README / ZIP filename. */
  platformLabel: string;
}

export class ExportTooLargeError extends Error {
  constructor(public sizeBytes: number, public limit: number) {
    super(`export_too_large: ${sizeBytes} bytes > ${limit} byte limit`);
  }
}
```

- [ ] **Step 2: format-helpers.ts**

Create `netlify/functions/_shared/exporters/format-helpers.ts`:

```ts
import type { ExportProductRow } from './types';

/** "19.99 USD" style for Meta. */
export function metaPrice(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** Plain "19.99" for Amazon (currency from marketplace). */
export function plainPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Meta availability vocab uses spaces. */
export function metaAvailability(a: ExportProductRow['availability']): string {
  switch (a) {
    case 'in_stock':       return 'in stock';
    case 'out_of_stock':   return 'out of stock';
    case 'preorder':       return 'preorder';
    case 'discontinued':   return 'discontinued';
  }
}

/** Amazon condition codes (Inventory Loader). */
export function amazonConditionCode(c: ExportProductRow['condition']): string {
  switch (c) {
    case 'new':          return '11';
    case 'refurbished':  return '2';
    case 'used':         return '6';   // used-very-good as a default
  }
}

/** ISO-8601 range used by Meta `sale_price_effective_date`. */
export function metaSaleDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  return `${start ?? ''}/${end ?? ''}`;
}

/** Generate a safe filename stem for image filenames inside the ZIP. */
export function imageStem(row: ExportProductRow): string {
  return (row.sku ?? row.id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Image filename for the nth image (0 = main). */
export function imageFilename(row: ExportProductRow, index: number, ext = 'jpg'): string {
  return index === 0
    ? `images/${imageStem(row)}_main.${ext}`
    : `images/${imageStem(row)}_${index}.${ext}`;
}

/** CSV escape: wrap in quotes if contains comma/quote/newline; double quotes inside. */
export function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** TSV escape: replace tabs/newlines with spaces (Amazon TSV is strict). */
export function tsvEscape(v: string | number | null | undefined): string {
  if (v == null) return '';
  return String(v).replace(/[\t\n\r]/g, ' ');
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expect 0.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/_shared/exporters/types.ts netlify/functions/_shared/exporters/format-helpers.ts
git commit -m "$(cat <<'EOF'
feat(products): exporter type contracts + format helpers

ExportProductRow, ExporterContext, ExportResult types. Helper functions
for price/availability/condition mapping across Meta/Amazon and CSV/TSV
escaping.
EOF
)"
```

---

## Task 6: Per-platform formatters (CSV, XLSX, Meta, WhatsApp, Amazon, Flipkart)

**Files:**
- Create: `netlify/functions/_shared/exporters/csv.ts`
- Create: `netlify/functions/_shared/exporters/xlsx.ts`
- Create: `netlify/functions/_shared/exporters/meta.ts`
- Create: `netlify/functions/_shared/exporters/whatsapp.ts`
- Create: `netlify/functions/_shared/exporters/amazon.ts`
- Create: `netlify/functions/_shared/exporters/flipkart.ts`
- Create: `tests/unit/products-exporters-csv.test.ts`
- Create: `tests/unit/products-exporters-meta.test.ts`
- Create: `tests/unit/products-exporters-whatsapp.test.ts`
- Create: `tests/unit/products-exporters-amazon.test.ts`
- Create: `tests/unit/products-exporters-flipkart.test.ts`

Each formatter is a small pure function `format(ctx: ExporterContext): ExportResult`. Write one test per formatter. The tests use small fixture data (2-3 products) so they're easy to read and assert against.

Due to length, the exact code is not duplicated here — instead this task references the spec's §Exporter format details, which lists every column and mapping. Build each formatter to match the spec exactly.

- [ ] **Step 1: Write a failing test for `csv.ts`**

Create `tests/unit/products-exporters-csv.test.ts`. Use 2 fixture products. Assert:
- First row is the header
- Column order matches spec
- Currency formatting is `"19.99"` (plain) for generic CSV
- New fields (gtin, condition, etc.) appear in their declared positions
- CSV escaping handles commas/quotes correctly

```bash
npx vitest run tests/unit/products-exporters-csv.test.ts
```

Expect: FAIL (module not found).

- [ ] **Step 2: Implement `csv.ts`**

Columns (extend the existing generic CSV — keep it as the "complete" workspace export):

```
id, type, name, description, category, brand, tags, price, currency, sku,
stock_qty, unit, status, gtin, mpn, condition, availability, sale_price,
sale_starts_at, sale_ends_at, weight_grams, length_mm, width_mm, height_mm,
color, size, material, gender, age_group, manufacturer, country_of_origin,
hsn_code, gst_rate, google_category, meta_category, product_url, image_main,
images_additional, created_at, updated_at
```

`image_main` and `images_additional` use the `imageFilename` helper to reference filenames in the ZIP.

- [ ] **Step 3: Run csv tests → pass**

- [ ] **Step 4: Repeat steps 1-3 for `xlsx.ts`**

Use the existing `xlsx` package. Sheet name `Products`. Same columns as CSV.

- [ ] **Step 5: Repeat for `meta.ts`**

Columns per spec §Meta. Use `metaPrice`, `metaAvailability`, `metaSaleDateRange` helpers.

Test asserts:
- Header row has the 19+ Meta columns in spec order
- A row with `availability: 'in_stock'` produces `"in stock"` (with space)
- `price` column has `"19.99 USD"`
- `image_link` has filename `images/<sku>_main.jpg`
- `additional_image_link` is comma-separated `images/<sku>_1.jpg, images/<sku>_2.jpg`

- [ ] **Step 6: Repeat for `whatsapp.ts`**

Subset of Meta. Test asserts the column list is the WA-required subset.

- [ ] **Step 7: Repeat for `amazon.ts`**

TSV format. Columns per spec §Amazon. Use `amazonConditionCode`, `plainPrice`, `tsvEscape`. Test asserts:
- Tab delimiter
- `item-condition` is `11` for new, `2` for refurbished, `6` for used
- `product-id-type` derivation from gtin length

- [ ] **Step 8: Repeat for `flipkart.ts`**

XLSX format. Columns per spec §Flipkart. Use the existing `xlsx` package. Test asserts:
- Sheet name `Catalog`
- Column headers match Flipkart spec
- Defaults for `Procurement Type`, `Procurement SLA`, `Shipping Provider`
- `Country of Origin` defaults to `India` when null

- [ ] **Step 9: Typecheck after all formatters**

```bash
npm run typecheck
npx vitest run tests/unit/products-exporters-
```

Expect 0 + all formatter tests passing.

- [ ] **Step 10: Commit (single commit covers all 6 formatters + their tests)**

```bash
git add netlify/functions/_shared/exporters/ tests/unit/products-exporters-*.test.ts
git commit -m "$(cat <<'EOF'
feat(products): per-platform exporters

CSV/XLSX (generic, all fields), Meta Catalog CSV, WhatsApp Business CSV
(subset of Meta), Amazon Inventory Loader TSV, Flipkart Catalog XLSX.
Each is a pure format(ctx) function returning an ExportResult; the
dispatcher wraps in a ZIP separately.
EOF
)"
```

---

## Task 7: ZIP wrapper with 4 MB size guard

**Files:**
- Create: `netlify/functions/_shared/exporters/zip.ts`
- Create: `tests/unit/products-exporters-zip.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/products-exporters-zip.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import JSZip from 'jszip';
import { wrapInZip, MAX_ZIP_BYTES } from '../../netlify/functions/_shared/exporters/zip';
import { ExportTooLargeError } from '../../netlify/functions/_shared/exporters/types';

describe('zip wrapper', () => {
  test('produces a ZIP with the inner file at root + README.txt', async () => {
    const buf = await wrapInZip({
      filename: 'products.csv',
      contentType: 'text/csv',
      body: 'id,name\n1,Egg',
      platformLabel: 'Generic CSV',
    }, []);
    const z = await JSZip.loadAsync(buf);
    expect(z.file('products.csv')).not.toBeNull();
    expect(z.file('README.txt')).not.toBeNull();
    const csv = await z.file('products.csv')!.async('string');
    expect(csv).toContain('Egg');
  });

  test('includes image files when provided', async () => {
    const buf = await wrapInZip(
      { filename: 'products.csv', contentType: 'text/csv', body: 'x', platformLabel: 'Generic CSV' },
      [{ path: 'images/sku-1_main.jpg', bytes: new Uint8Array([0xff, 0xd8]).buffer }],
    );
    const z = await JSZip.loadAsync(buf);
    expect(z.file('images/sku-1_main.jpg')).not.toBeNull();
  });

  test('throws ExportTooLargeError past MAX_ZIP_BYTES', async () => {
    const huge = 'a'.repeat(5 * 1024 * 1024); // 5 MB ASCII compresses poorly but still gets past 4 MB
    await expect(wrapInZip(
      { filename: 'x.csv', contentType: 'text/csv', body: huge, platformLabel: 'X' }, []
    )).rejects.toThrow(ExportTooLargeError);
  });
});
```

Run; expect FAIL (module not found).

- [ ] **Step 2: Implement zip.ts**

```ts
import JSZip from 'jszip';
import { ExportResult, ExportTooLargeError } from './types';

export const MAX_ZIP_BYTES = 4 * 1024 * 1024;

export interface ZipImage {
  path: string;          // e.g., 'images/sku-1_main.jpg'
  bytes: ArrayBuffer | Uint8Array;
}

export async function wrapInZip(
  result: ExportResult,
  images: ZipImage[],
): Promise<Buffer> {
  const z = new JSZip();

  z.file(result.filename, result.body);

  // README.txt
  const readme = [
    `Export: ${result.platformLabel}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Image links in the data file reference filenames in this ZIP's images/`,
    `folder. After uploading the images to your hosting (CDN, Shopify, etc.),`,
    `find-and-replace those filenames with the hosted URLs.`,
  ].join('\n');
  z.file('README.txt', readme);

  // Images
  for (const img of images) {
    z.file(img.path, img.bytes);
  }

  const buf = await z.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  if (buf.byteLength > MAX_ZIP_BYTES) {
    throw new ExportTooLargeError(buf.byteLength, MAX_ZIP_BYTES);
  }

  return buf;
}
```

- [ ] **Step 3: Tests pass + typecheck**

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/_shared/exporters/zip.ts tests/unit/products-exporters-zip.test.ts
git commit -m "$(cat <<'EOF'
feat(products): ZIP wrapper with 4 MB size guard

Wraps any ExportResult plus an optional images[] array into a single
ZIP. README.txt at root with instructions. Throws ExportTooLargeError
past the 4 MB cap (Netlify Functions sync response is 6 MB).
EOF
)"
```

---

## Task 8: Refactor `u-products-export.ts` into a dispatcher

**Files:**
- Modify: `netlify/functions/u-products-export.ts`
- Modify: `tests/integration/u-products-export.test.ts` (extend)

- [ ] **Step 1: Read current u-products-export.ts**

Currently the file handles `format=csv|xlsx` and returns a single file. Refactor to:

1. Accept `format=csv|xlsx|meta|whatsapp|amazon|flipkart`. Default `csv`.
2. Build an `ExporterContext` by fetching products + their images.
3. Dispatch to the appropriate formatter.
4. Fetch image bytes from `productImagesStore` for each image.
5. Build `ZipImage[]` with filenames matching the formatter's image references.
6. Call `wrapInZip`. Return as `application/zip`.
7. On `ExportTooLargeError`, return 413 with details.

- [ ] **Step 2: Implementation sketch**

```ts
const format = url.searchParams.get('format') ?? 'csv';
const ALLOWED_FORMATS = new Set(['csv','xlsx','meta','whatsapp','amazon','flipkart']);
if (!ALLOWED_FORMATS.has(format)) return jsonError(400, 'unknown_format');

const rows: ExportProductRow[] = await fetchRows(sql, clientId, filters);
const allImages = await fetchAllImages(sql, rows.map(r => r.id));
// rows[i].images = ordered slice of allImages for product i

const ctx: ExporterContext = {
  rows,
  clientSlug,
  generatedAt: new Date(),
};

const exporter = ({
  csv:       () => import('./_shared/exporters/csv').then(m => m.format(ctx)),
  xlsx:      () => import('./_shared/exporters/xlsx').then(m => m.format(ctx)),
  meta:      () => import('./_shared/exporters/meta').then(m => m.format(ctx)),
  whatsapp:  () => import('./_shared/exporters/whatsapp').then(m => m.format(ctx)),
  amazon:    () => import('./_shared/exporters/amazon').then(m => m.format(ctx)),
  flipkart:  () => import('./_shared/exporters/flipkart').then(m => m.format(ctx)),
})[format];

const result = await exporter();

// Fetch image bytes and build ZipImage[]
const zipImages: ZipImage[] = [];
for (const row of rows) {
  for (let i = 0; i < row.images.length; i++) {
    const blob = await productImagesStore().get(row.images[i].blob_key, { type: 'arrayBuffer' });
    if (!blob) continue;
    zipImages.push({ path: imageFilename(row, i), bytes: blob });
  }
}

let zipBytes: Buffer;
try {
  zipBytes = await wrapInZip(result, zipImages);
} catch (e) {
  if (e instanceof ExportTooLargeError) {
    return jsonError(413, 'export_too_large', {
      size_bytes: e.sizeBytes, limit: e.limit,
      suggestion: 'Filter the catalog by status or category, then export each subset.',
    });
  }
  throw e;
}

const zipFilename = `products-${clientSlug}-${formatDate(new Date())}.zip`;
return new Response(zipBytes, {
  status: 200,
  headers: {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${zipFilename}"`,
    'cache-control': 'no-store',
  },
});
```

- [ ] **Step 3: Update / extend tests**

In `tests/integration/u-products-export.test.ts`, add cases:
- `format=meta` → ZIP with `products.csv`, README, image (if seeded).
- `format=whatsapp` → ZIP with subset columns.
- `format=amazon` → ZIP with `products.tsv`.
- `format=flipkart` → ZIP with `products.xlsx`.
- `format=invalid` → 400.

Use `JSZip.loadAsync` in the tests to verify ZIP contents.

- [ ] **Step 4: Typecheck + tests**

```bash
npm run typecheck
npx vitest run tests/integration/u-products-export.test.ts
```

All passing.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/u-products-export.ts tests/integration/u-products-export.test.ts
git commit -m "$(cat <<'EOF'
feat(products): export endpoint dispatches by ?format=

Six formats: csv, xlsx, meta, whatsapp, amazon, flipkart. Each goes
through its formatter, then wrapInZip (with images and README). 413
on >4 MB. Unknown format → 400.
EOF
)"
```

---

## Task 9: 4 MB ceiling integration test

**Files:**
- Create: `tests/integration/u-products-export-too-large.test.ts`

- [ ] **Step 1: Seed enough data to exceed 4 MB**

Seed products with large mock images (use `Buffer.alloc(500*1024)` per image to fake a 500 KB image; 10 products × 5 images = 25 MB raw, plenty to bust 4 MB).

- [ ] **Step 2: Assert 413**

```ts
const r = await uProductsExportHandler(new Request('http://localhost/api/u-products-export?format=meta', {
  headers: { cookie: buCookie },
}), CTX);
expect(r.status).toBe(413);
const body = await r.json() as { error: { code: string; details: { suggestion: string } } };
expect(body.error.code).toBe('export_too_large');
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/u-products-export-too-large.test.ts
git commit -m "$(cat <<'EOF'
test(products): assert export 413 past 4 MB ceiling
EOF
)"
```

---

## Task 10: Frontend — form sections for new fields

**Files:**
- Create: `src/modules/products/workspace/components/ProductCommerceSection.tsx`
- Create: `src/modules/products/workspace/components/ProductPhysicalAttrsSection.tsx`
- Create: `src/modules/products/workspace/components/ProductTaxonomySection.tsx`
- Modify: `src/modules/products/workspace/components/ProductForm.tsx`
- Modify: `src/lib/components.css`

Each section is a collapsible `<details>` block. Inputs map 1-to-1 to the new fields; basic validation (number input for price/dimensions/gst_rate; select for condition/availability).

- [ ] **Step 1: ProductCommerceSection.tsx**

Props: `gtin, mpn, condition, availability, sale_price_cents, sale_starts_at, sale_ends_at, weight_grams, onChange`.

Render: `<details><summary>Commerce & inventory</summary>` containing labeled inputs.

- [ ] **Step 2: ProductPhysicalAttrsSection.tsx**

Props: `length_mm, width_mm, height_mm, color, size, material, gender, age_group, manufacturer, country_of_origin, onChange`.

Render: `<details><summary>Physical attributes</summary>` ...

- [ ] **Step 3: ProductTaxonomySection.tsx**

Props: `google_category, meta_category, hsn_code, gst_rate, product_url, onChange`.

Render: `<details><summary>Categorization & tax</summary>` ...

- [ ] **Step 4: Wire up ProductForm**

Mount all three sections after the existing `ProductOrgSection` in the right column. Thread `props.draft` + `props.onChange`.

- [ ] **Step 5: CSS**

Add `.pm-advanced-section` styles in `src/lib/components.css`. The `<details>` element styling: bold summary, indented body, vertical spacing.

- [ ] **Step 6: Typecheck + smoke build**

```bash
npm run typecheck
npm run build
```

Both clean.

- [ ] **Step 7: Commit**

```bash
git add src/modules/products/workspace/components/ProductCommerceSection.tsx src/modules/products/workspace/components/ProductPhysicalAttrsSection.tsx src/modules/products/workspace/components/ProductTaxonomySection.tsx src/modules/products/workspace/components/ProductForm.tsx src/lib/components.css
git commit -m "$(cat <<'EOF'
feat(products): edit form sections for Phase B fields

Three collapsible sections (Commerce & inventory, Physical attributes,
Categorization & tax) covering all 23 new columns. Defaults closed to
keep the basics form clean.
EOF
)"
```

---

## Task 11: Frontend — typeahead `CategoryCombobox`

**Files:**
- Create: `src/modules/products/workspace/components/CategoryCombobox.tsx`
- Modify: `src/modules/products/workspace/components/ProductOrgSection.tsx`
- Modify: `src/lib/components.css`
- Create: `tests/unit/category-combobox.test.tsx`

- [ ] **Step 1: Failing test**

`tests/unit/category-combobox.test.tsx` (use `@vitest-environment jsdom`):

```tsx
/** @vitest-environment jsdom */
import { describe, expect, test, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CategoryCombobox } from '../../src/modules/products/workspace/components/CategoryCombobox';

describe('CategoryCombobox', () => {
  test('shows + Create option when no exact match and user can create', () => {
    const { getByRole, queryByText } = render(
      <CategoryCombobox
        value={null}
        categories={[{ id: '1', name: 'Snacks', sort_order: 0, created_at: '', updated_at: '' }]}
        canCreate={true}
        onSelect={() => {}}
        onCreate={async () => ({ id: 'new', name: 'Vegan', sort_order: 0, created_at: '', updated_at: '' })}
      />
    );
    const input = getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Vegan' } });
    expect(queryByText(/\+ Create "Vegan"/i)).not.toBeNull();
  });

  test('does NOT show + Create when permission missing', () => { /* similar */ });

  test('+ Create click calls onCreate then onSelect with new id', async () => {
    const onSelect = vi.fn();
    const onCreate = vi.fn(async () => ({ id: 'new', name: 'X', sort_order: 0, created_at: '', updated_at: '' }));
    const { getByRole, getByText } = render(
      <CategoryCombobox value={null} categories={[]} canCreate={true} onSelect={onSelect} onCreate={onCreate} />
    );
    fireEvent.change(getByRole('combobox'), { target: { value: 'X' } });
    fireEvent.click(getByText(/\+ Create "X"/i));
    await new Promise((r) => setTimeout(r, 0));
    expect(onCreate).toHaveBeenCalledWith('X');
    expect(onSelect).toHaveBeenCalledWith('new');
  });

  test('keyboard: ArrowDown moves focus, Enter selects', () => { /* ... */ });

  test('Escape closes the dropdown', () => { /* ... */ });
});
```

- [ ] **Step 2: Implement CategoryCombobox.tsx**

Component props:

```ts
interface Props {
  value: string | null;                              // current category_id
  categories: ProductCategory[];
  canCreate: boolean;
  onSelect: (categoryId: string | null) => void;
  onCreate: (name: string) => Promise<ProductCategory>;
}
```

Render shape: `<div role="combobox">` containing `<input type="text">` and a conditional `<ul role="listbox">` of options.

- Maintains internal `query` state.
- Filters `categories` by `query` (case-insensitive contains).
- Shows "Uncategorized" option at the top.
- Shows `+ Create "<query>"` at the bottom when `query` doesn't exactly match any category AND `canCreate`.
- Click outside (mousedown on document outside the component) closes the dropdown.

ARIA:
- `<input role="combobox" aria-expanded={open} aria-controls="cat-listbox">`
- `<ul role="listbox" id="cat-listbox">` with `<li role="option" aria-selected={hovered === idx}>`.

- [ ] **Step 3: Wire into ProductOrgSection**

Replace the `<select>` block. The section needs a new prop `categoriesApi` (or pass `onCreate` via the form's existing callbacks). Cleanest: pass `onCreateCategory` from `ProductEditPage` down through `ProductForm` → `ProductOrgSection` → `CategoryCombobox`.

In `ProductEditPage.tsx`:

```ts
async function createCategory(name: string): Promise<ProductCategory> {
  const cat = await categoriesApi.create(name, { clientId: clientQuery });
  setCats((prev) => [...prev, cat]);   // immediate UI update
  return cat;
}
```

Pass `onCreateCategory={createCategory}` to ProductForm → ProductOrgSection.

- [ ] **Step 4: CSS**

`.pm-combobox`, `.pm-combobox-input`, `.pm-combobox-list`, `.pm-combobox-option`, `.pm-combobox-create` styles in `src/lib/components.css`.

- [ ] **Step 5: Tests + typecheck**

```bash
npx vitest run tests/unit/category-combobox.test.tsx
npm run typecheck
```

All passing.

- [ ] **Step 6: Commit**

```bash
git add src/modules/products/workspace/components/CategoryCombobox.tsx src/modules/products/workspace/components/ProductOrgSection.tsx src/modules/products/workspace/pages/ProductEditPage.tsx src/modules/products/workspace/components/ProductForm.tsx src/lib/components.css tests/unit/category-combobox.test.tsx
git commit -m "$(cat <<'EOF'
feat(products): typeahead CategoryCombobox with inline + Create

Replaces the static <select> on the edit form. Filters as the user
types; when no match and they have create permission, the last option
is "+ Create '<typed>'", which calls categoriesApi.create and selects
the new category in one flow.

The standalone Manage Categories page remains for bulk rename/reorder.
EOF
)"
```

---

## Task 12: Frontend — Export dropdown

**Files:**
- Modify: `src/modules/products/workspace/components/ProductFiltersBar.tsx`
- Modify: `src/modules/products/shared/api.ts`
- Modify: `src/lib/components.css`

- [ ] **Step 1: Widen the exportUrl format type**

In `api.ts`:

```ts
exportUrl: (
  f: ProductFilters,
  format: 'csv' | 'xlsx' | 'meta' | 'whatsapp' | 'amazon' | 'flipkart',
  opts?: ScopeOpts,
): string => {
  const q = qs(f);
  const sep = q ? '&' : '';
  return withScope(`/api/u-products-export?${q}${sep}format=${format}`, opts);
},
```

- [ ] **Step 2: Replace single Export button with dropdown**

In `ProductFiltersBar.tsx`, swap the existing Export button for a dropdown. Use a `<details>` element for simplicity (no JS-managed open/close state):

```tsx
<details className="pm-export-menu">
  <summary>Export ▾</summary>
  <ul role="menu">
    <li><button type="button" onClick={() => exportAs('csv')}>Generic CSV</button></li>
    <li><button type="button" onClick={() => exportAs('xlsx')}>Generic XLSX</button></li>
    <li><button type="button" onClick={() => exportAs('meta')}>Meta / Facebook Catalog</button></li>
    <li><button type="button" onClick={() => exportAs('whatsapp')}>WhatsApp Business</button></li>
    <li><button type="button" onClick={() => exportAs('amazon')}>Amazon Inventory Loader</button></li>
    <li><button type="button" onClick={() => exportAs('flipkart')}>Flipkart Catalog</button></li>
  </ul>
</details>
```

Where:

```tsx
function exportAs(fmt: 'csv'|'xlsx'|'meta'|'whatsapp'|'amazon'|'flipkart') {
  window.location.href = productsApi.exportUrl(filters, fmt, { clientId: clientQuery });
}
```

`clientQuery` comes from `useProductsScope` if it's not already in scope here. If the existing ProductFiltersBar receives `onExport` as a prop, route through that callback instead — keep the page in control of the exporting logic.

- [ ] **Step 3: CSS for the menu**

Add `.pm-export-menu` styles to keep the dropdown visually distinct. `details > summary` should look like a button; the `<ul>` should overlay other content with `position: absolute; z-index: 1`.

- [ ] **Step 4: Typecheck + manual build**

```bash
npm run typecheck
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/products/shared/api.ts src/modules/products/workspace/components/ProductFiltersBar.tsx src/lib/components.css
git commit -m "$(cat <<'EOF'
feat(products): export dropdown with 6 platform formats

Generic CSV, Generic XLSX, Meta/FB Catalog, WhatsApp Business, Amazon
Inventory Loader, Flipkart Catalog.
EOF
)"
```

---

## Task 13: Apply migration 037 to prod Neon, then push

**Files:**
- Run only — no edits.

Per `feedback_migration_before_deploy` (additive migration, normal order): code can be deployed first OR migration first. For safety, run migration first since the code reads the new columns.

- [ ] **Step 1: Verify prod migration status**

```bash
PROD_DB_URL=$(npx netlify env:get DATABASE_URL --context production 2>&1 | tail -1)
echo "$PROD_DB_URL" | sed 's|.*@\([^/]*\)/.*|\1|'   # confirm 'dawn-bird' substring
```

Expected: host contains `ep-dawn-bird-aojs8xxb-pooler.c-2.ap-southeast-1.aws.neon.tech`.

- [ ] **Step 2: Run migrate against prod**

```bash
DATABASE_URL="$PROD_DB_URL" npm run migrate
```

Expected: migration 037 applied. Status verification:

```bash
DATABASE_URL="$PROD_DB_URL" npm run migrate -- --status
```

Should show 037 applied.

- [ ] **Step 3: Quick column check**

```bash
DATABASE_URL="$PROD_DB_URL" psql -c "SELECT column_name FROM information_schema.columns WHERE table_name='products' AND table_schema='public' AND column_name='platform_extras'" 2>&1
```

Expected: returns `platform_extras` row.

- [ ] **Step 4: Stop here — DO NOT push.**

Wait for explicit user "push it" approval per `feedback_no_push_without_approval`. Push is the next session's first step.

---

## Task 14: Final verification

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: all green except the 3 pre-existing registry drift failures.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Should succeed. Bundle hash will change.

- [ ] **Step 4: git log summary**

```bash
git log --oneline 278e9c7..HEAD
```

Expect ~13 commits from Tasks 1-12.

- [ ] **Step 5: Confirm clean working tree**

```bash
git status
```

---

## Done criteria

- All 13 implementation commits land on `main`.
- Migration 037 applied to dev (Task 1) and prod (Task 13).
- `npm test` passes (modulo pre-existing 3-test drift).
- `npm run typecheck` passes.
- Each platform export downloads a ZIP that, when opened, contains the expected file + images/ + README.txt.
- CategoryCombobox supports `+ Create` flow.
- All 23 new fields visible in the edit form (collapsible sections) and persisted round-trip.
- User has not pushed yet — that's the next session's first action.

## Out of scope

- Do not `git push`.
- Do not `gh pr create`.
- Do not migrate variants (out of spec).
- Do not extend CSV import to new fields (separate plan).
- Do not add signed public image URLs (separate plan).
- Do not add per-category Amazon/Flipkart templates (separate plan).
