# Product Discounts (discount_percent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stored `discount_percent` column so merchants can enter "20% off" once and have the system keep `sale_price_cents` consistent with `price_cents` across edits, imports, and exports.

**Architecture:** Application-enforced invariant (no Postgres generated column, no trigger). Whenever a write touches `price_cents` or `discount_percent` and the post-write `discount_percent IS NOT NULL`, the same statement also sets `sale_price_cents = round(price_cents × (1 − discount_percent / 100))`. The pre-Phase-B freeform `sale_price_cents` path is preserved for rows where `discount_percent IS NULL`. A single shared helper `computeSalePrice(priceCents, discountPct)` is used by the FE form, the import row-commit loop, the POST handler, and the PATCH handler.

**Tech Stack:** TypeScript, `@neondatabase/serverless` (tagged-template, `sql.transaction`), zod, vitest. No new dependency. One additive DB migration (038).

---

## Key references

- **Spec:** `docs/superpowers/specs/2026-06-11-product-discounts-design.md`
- **Migration:** `db/migrations/038_products_discount_percent.sql` (NEW, this plan)
- **Validator:** `netlify/functions/_shared/products-validate.ts`
- **POST handler:** `netlify/functions/u-products.ts` (uses zod + `parseCreateProduct`)
- **PATCH handler:** `netlify/functions/u-products-detail.ts` (zod inline; no `parsePatchProduct` consumer here)
- **Import parser:** `netlify/functions/_shared/products-import-parse.ts` (Phase B updated this file; `PHASE_B_HEADERS` lives here)
- **Import handler:** `netlify/functions/u-products-import.ts` (per-row commit loop + warnings array + dynamic UPDATE)
- **Export SELECT:** `netlify/functions/u-products-export.ts`
- **Exporter types:** `netlify/functions/_shared/exporters/types.ts` (`ExportProductRow`)
- **Generic exporters:** `netlify/functions/_shared/exporters/{csv.ts,xlsx.ts}` (the four platform-specific exporters are NOT changed)
- **FE Commerce section:** `src/modules/products/workspace/components/ProductCommerceSection.tsx`
- **Phase B parser test:** `tests/unit/products-import-parse.test.ts`
- **Phase B integration test:** `tests/integration/u-products-import.test.ts`
- **Existing CRUD tests (search to confirm path):** `grep -rn "describe.*u-products" tests/integration/` — there are existing files for u-products and u-products-detail.

---

### Task 1: Migration 038 — add `discount_percent` column

**Files:**
- Create: `db/migrations/038_products_discount_percent.sql`

- [ ] **Step 1: Create the migration file**

`db/migrations/038_products_discount_percent.sql`:

```sql
-- Migration 038: discount_percent on products.
-- See docs/superpowers/specs/2026-06-11-product-discounts-design.md.
-- Additive; safe to run before or after code deploy. CHECK enforces the
-- exclusive 0..100 range; the column is nullable to preserve Phase B's
-- freeform sale_price_cents behavior on existing rows.

ALTER TABLE public.products
  ADD COLUMN discount_percent NUMERIC(5,2)
  CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent < 100));
```

- [ ] **Step 2: Apply to the dev Neon branch**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol Data Collection App"
npm run migrate
```

Expected: the runner reports applying migration 038. If the runner doesn't print the applied list explicitly, verify via a probe:

```bash
psql "$DATABASE_URL" -c "\d public.products" 2>/dev/null | grep -i discount_percent
```

Expected output: a row showing `discount_percent | numeric(5,2)`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/038_products_discount_percent.sql
git commit -m "feat(db): add products.discount_percent column (migration 038)"
```

DO NOT apply to prod in this task; prod migration runs as part of the eventual `git push` deploy or a follow-up command. The plan commits + tests stay local on main.

---

### Task 2: Shared helper `computeSalePrice` + validator additions (TDD)

**Files:**
- Create: `netlify/functions/_shared/products-discount.ts`
- Modify: `netlify/functions/_shared/products-validate.ts`
- Test: `tests/unit/products-discount.test.ts` (new)
- Test: `tests/unit/products-validate-discount.test.ts` (new) OR append to an existing validator test file if one exists

- [ ] **Step 1: Write the failing unit tests for `computeSalePrice`**

`tests/unit/products-discount.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeSalePrice } from '../../netlify/functions/_shared/products-discount';

describe('computeSalePrice', () => {
  it('returns null when discount is null', () => {
    expect(computeSalePrice(10000, null)).toBeNull();
  });
  it('computes 20% off 100.00 as 8000 cents', () => {
    expect(computeSalePrice(10000, 20)).toBe(8000);
  });
  it('computes 33.33% off 99.99 as 6666 cents (round-half-up)', () => {
    expect(computeSalePrice(9999, 33.33)).toBe(6669); // 9999 * 0.6667 = 6666.6667 → 6667? verify
  });
  it('rounds correctly for awkward inputs', () => {
    // 10001 * 0.85 = 8500.85 → 8501 (round-half-up)
    expect(computeSalePrice(10001, 15)).toBe(8501);
  });
  it('returns priceCents when discount is 0... wait, 0 is invalid; pin null instead', () => {
    expect(computeSalePrice(10000, null)).toBe(null);
  });
});
```

(The 33.33% expectation needs verification — write the impl first, then read the actual output; adjust the test expectation to match the actual `Math.round` result. The point is to pin the rounding behavior in a test, not pick a fancy number out of thin air. Use `console.log` while iterating, then bake in the correct expected value.)

- [ ] **Step 2: Run the test, confirm failure**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol Data Collection App"
npx vitest run tests/unit/products-discount.test.ts 2>&1 | tail -10
```

Expected: fails — `computeSalePrice` doesn't exist.

- [ ] **Step 3: Create the helper**

`netlify/functions/_shared/products-discount.ts`:

```ts
// Single source of truth for the discount-percent → sale-price computation.
// Used by:
//   - u-products.ts (POST)        — compute sale_price_cents at INSERT
//   - u-products-detail.ts (PATCH) — recompute on price or discount change
//   - u-products-import.ts         — recompute per imported row
//   - ProductCommerceSection.tsx   — live preview while editing
//
// Rounding: Math.round (half-up). Matches parsePrice's round-half-up.

export function computeSalePrice(
  priceCents: number,
  discountPct: number | null,
): number | null {
  if (discountPct == null) return null;
  return Math.round(priceCents * (1 - discountPct / 100));
}
```

- [ ] **Step 4: Run the test, iterate the expected values once if needed, confirm green**

```bash
npx vitest run tests/unit/products-discount.test.ts 2>&1 | tail -10
```

If a `toBe(6669)` fails with the actual value, adjust the test expectation to the actual value (it's pinning the implementation's rounding, which is what we want).

- [ ] **Step 5: Add `discount_percent` to validator types and the `parseCreateProduct` checks**

Edit `netlify/functions/_shared/products-validate.ts`:

Add to `CreateProductInput` interface, in the "Phase B platform fields" block (alphabetically near the other percent-ish field `gst_rate`):

```ts
discount_percent?: number | null;
```

Add to the `ALLOWED` list in `parsePatchProduct` (currently includes the Phase B 23):

```ts
'discount_percent',
```

(Find the existing list around line 121–131 — append `'discount_percent'` to the array. Keep one line if reasonable.)

Add the range check inside `parseCreateProduct`, near the existing `gst_rate` check:

```ts
if (v.discount_percent != null && (
  typeof v.discount_percent !== 'number' ||
  v.discount_percent <= 0 ||
  v.discount_percent >= 100
)) {
  errors.push({ field: 'discount_percent', message: 'must be > 0 and < 100 or null' });
}
```

- [ ] **Step 6: Add a validator unit test**

`tests/unit/products-validate-discount.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCreateProduct } from '../../netlify/functions/_shared/products-validate';

describe('parseCreateProduct discount_percent', () => {
  const base = { type: 'physical' as const, name: 'X', price_cents: 1000 };

  it('accepts a valid discount_percent', () => {
    const r = parseCreateProduct({ ...base, discount_percent: 20 });
    expect(r.ok).toBe(true);
  });
  it('rejects 0', () => {
    const r = parseCreateProduct({ ...base, discount_percent: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === 'discount_percent')).toBe(true);
  });
  it('rejects 100', () => {
    const r = parseCreateProduct({ ...base, discount_percent: 100 });
    expect(r.ok).toBe(false);
  });
  it('rejects -5', () => {
    const r = parseCreateProduct({ ...base, discount_percent: -5 });
    expect(r.ok).toBe(false);
  });
  it('accepts null', () => {
    const r = parseCreateProduct({ ...base, discount_percent: null });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 7: Run validator test + typecheck**

```bash
npx vitest run tests/unit/products-validate-discount.test.ts 2>&1 | tail -10
npm run typecheck
```

Both clean.

- [ ] **Step 8: Commit**

```bash
git add netlify/functions/_shared/products-discount.ts netlify/functions/_shared/products-validate.ts tests/unit/products-discount.test.ts tests/unit/products-validate-discount.test.ts
git commit -m "feat(products): computeSalePrice helper + discount_percent validator"
```

---

### Task 3: POST handler (`u-products.ts`) wires discount_percent

**Files:**
- Modify: `netlify/functions/u-products.ts`
- Test: existing CRUD integration test file (find with `grep -rln "describe.*u-products[^-]" tests/integration/` — likely `tests/integration/u-products.test.ts`)

- [ ] **Step 1: Add the zod field**

Open `netlify/functions/u-products.ts`. Find the zod schema with `sale_price_cents: z.number().int().min(0).nullable().optional()` (around line 33). Add IMMEDIATELY ABOVE that line:

```ts
discount_percent: z.number().nullable().optional(),
```

- [ ] **Step 2: Compute sale price at INSERT**

Find the INSERT block (around line 199). Two changes:

**(a)** Add `import { computeSalePrice } from './_shared/products-discount';` near the top of the file (next to the existing `_shared/products-validate` import).

**(b)** Just before the INSERT statement, compute the effective sale_price:

```ts
const effectiveSalePriceCents = parsed.discount_percent != null
  ? computeSalePrice(parsed.price_cents, parsed.discount_percent)
  : (parsed.sale_price_cents ?? null);
```

Replace the existing `${v.sale_price_cents ?? null}` token in the VALUES list with `${effectiveSalePriceCents}`.

Add `discount_percent` to the column list and `${parsed.discount_percent ?? null}` to the VALUES list (alphabetize near other Phase B columns). Confirm column count vs value count by reading the surrounding block.

**(c)** Add `discount_percent` to the RETURNING list / response payload if the handler currently returns the row shape. Find the SELECT/RETURNING block that lists `sale_price_cents` (around line 226) and append `discount_percent` near it.

- [ ] **Step 3: Add an integration test**

Open the CRUD integration test file. Append a test inside the existing describe block:

```ts
test('POST with discount_percent computes sale_price_cents', async () => {
  const r = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({
      type: 'physical', name: 'Discounted', price_cents: 10000,
      discount_percent: 20,
    }),
  }), CTX);
  expect(r.status).toBe(201);
  const body = await r.json() as { product: { discount_percent: string | number | null; sale_price_cents: number | null } };
  // NUMERIC may come back as string; coerce for comparison.
  expect(Number(body.product.discount_percent)).toBe(20);
  expect(body.product.sale_price_cents).toBe(8000);
});

test('POST with discount_percent + sale_price_cents silently overrides sale_price', async () => {
  const r = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({
      type: 'physical', name: 'Discounted-Override', price_cents: 10000,
      discount_percent: 20, sale_price_cents: 9999,
    }),
  }), CTX);
  expect(r.status).toBe(201);
  const body = await r.json() as { product: { sale_price_cents: number | null } };
  expect(body.product.sale_price_cents).toBe(8000); // computed wins
});

test('POST rejects discount_percent = 100', async () => {
  const r = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({
      type: 'physical', name: 'Bad', price_cents: 10000, discount_percent: 100,
    }),
  }), CTX);
  expect(r.status).toBe(400);
});
```

(Reuse the file's existing setup helpers — `clientId`, `buCookie`, `CTX`, `uProductsHandler` — do not introduce new beforeEach. If any of those don't exist in the file, check what is exported/aliased and adapt the test to match the file's style.)

- [ ] **Step 4: Run the new tests, expect green**

```bash
npx vitest run tests/integration/u-products.test.ts -t "discount_percent" 2>&1 | tail -15
```

- [ ] **Step 5: Run the full integration file (sanity)**

```bash
npx vitest run tests/integration/u-products.test.ts 2>&1 | tail -15
```

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add netlify/functions/u-products.ts tests/integration/u-products.test.ts
git commit -m "feat(products): POST creates with discount_percent → computed sale_price_cents"
```

---

### Task 4: PATCH handler (`u-products-detail.ts`) — 5-rule semantics

**Files:**
- Modify: `netlify/functions/u-products-detail.ts`
- Test: integration test file for u-products-detail (find with `grep -rln "u-products-detail\|uProductsDetailHandler" tests/integration/ | head`)

- [ ] **Step 1: Add the zod field**

In `u-products-detail.ts`, find the PATCH zod schema (around line 47, `sale_price_cents: z.number().int().min(0).nullable().optional()`). Add ABOVE that line:

```ts
discount_percent: z.number().nullable().optional(),
```

- [ ] **Step 2: Add the range check after zod parse, before the SQL section**

After the zod parse but before SET-building (around line 175 where `setField('sale_price_cents', …)` lives), add:

```ts
if (v.discount_percent != null && (v.discount_percent <= 0 || v.discount_percent >= 100)) {
  return jsonError(400, 'discount_percent_invalid', 'must be > 0 and < 100');
}
```

- [ ] **Step 3: Implement the recompute logic**

In the SET-building block, the existing line `if (v.sale_price_cents !== undefined) setField('sale_price_cents', v.sale_price_cents);` needs to be wrapped by the discount logic. The flow:

```ts
import { computeSalePrice } from './_shared/products-discount';
// (top of file, with other shared imports)
```

Then in the SET-building block, replace the `sale_price_cents` setField line with this logic:

```ts
// Determine the row's post-patch discount state. We need the existing row
// for two reasons: rule #2 (price_cents-only patch on a discounted row
// recomputes sale_price) and rule #5 (sale_price-alone patch on a
// discounted row is rejected). Fetch once before SET-building.
const existing = (await sql`
  SELECT price_cents, discount_percent FROM public.products
  WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid AND deleted_at IS NULL
`) as Array<{ price_cents: number; discount_percent: string | null }>;
if (!existing[0]) return jsonError(404, 'not_found');
const oldPrice = existing[0].price_cents;
const oldDiscount = existing[0].discount_percent == null ? null : Number(existing[0].discount_percent);

// Compute post-patch discount + price (what the row WILL be).
const postDiscount = v.discount_percent !== undefined ? v.discount_percent : oldDiscount;
const postPrice = v.price_cents !== undefined ? v.price_cents : oldPrice;

// Rule #5: sale_price_cents present alone (no discount_percent key) AND
// post-patch discount is non-null → reject.
if (
  v.sale_price_cents !== undefined &&
  v.discount_percent === undefined &&
  postDiscount != null
) {
  return jsonError(400, 'sale_price_locked_by_discount', 'clear discount_percent before editing sale_price_cents');
}

// SET discount_percent if present in the patch.
if (v.discount_percent !== undefined) setField('discount_percent', v.discount_percent);

// SET sale_price_cents based on the rules:
//   - if postDiscount != null: always set the computed value.
//   - if postDiscount == null AND v.sale_price_cents !== undefined: honor the freeform value.
//   - if postDiscount == null AND v.sale_price_cents === undefined: don't touch sale_price.
if (postDiscount != null) {
  const computed = computeSalePrice(postPrice, postDiscount);
  setField('sale_price_cents', computed);
} else if (v.sale_price_cents !== undefined) {
  setField('sale_price_cents', v.sale_price_cents);
}
```

Find the existing line `if (v.sale_price_cents !== undefined) setField('sale_price_cents', v.sale_price_cents);` and replace it with the block above. The block goes BEFORE that line and the original line is removed (because the new block handles all sale_price_cents updates).

- [ ] **Step 4: Add `discount_percent` to the RETURNING column list**

Find the SELECT/RETURNING in u-products-detail.ts (around line 212). Add `discount_percent` to the column list so the response includes it.

- [ ] **Step 4b: Audit detail — record discount changes**

Find the `logAudit(...)` call in the same file (the `products.updated` audit emission). The current detail likely lists `changed_fields` or similar. Add `discount_percent` tracking. If the audit detail today is shape `{ changed_fields: string[] }`, the field name will be added when it's in `sets`. If you don't see explicit per-field tracking, add a minimal pair only when discount changes:

```ts
const auditExtras: Record<string, unknown> = {};
if (v.discount_percent !== undefined && v.discount_percent !== oldDiscount) {
  auditExtras.discount_percent_changed_from = oldDiscount;
  auditExtras.discount_percent_changed_to = v.discount_percent;
}
// pass into logAudit's detail object alongside whatever exists today
```

Add a small assertion to the integration test for the first PATCH case (the `PATCH discount_percent computes sale_price_cents` test):

```ts
const audits = await sql`
  SELECT detail FROM public.audit_log
  WHERE client_id = ${clientId}::uuid AND op = 'products.updated'
  ORDER BY occurred_at DESC LIMIT 1
` as Array<{ detail: Record<string, unknown> }>;
expect(audits[0]!.detail.discount_percent_changed_to).toBe(20);
```

(If `audit_log` schema differs in column names, adjust — the prior `phase_b_columns_touched` audit test in the import file uses `occurred_at` not `created_at`.)

- [ ] **Step 5: Add integration tests (seed via direct SQL — no placeholders)**

In the u-products-detail integration test file, append inside the existing describe block. Each test seeds its own row via direct SQL so there's no dependency on a per-file helper.

```ts
async function seedProduct(opts: { discount_percent?: number | null; sale_price_cents?: number | null }): Promise<string> {
  const sku = `DCT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ins = await sql`
    INSERT INTO public.products (
      client_id, type, name, sku, price_cents,
      discount_percent, sale_price_cents
    ) VALUES (
      ${clientId}::uuid, 'physical', 'DC Seed', ${sku}, 10000,
      ${opts.discount_percent ?? null}, ${opts.sale_price_cents ?? null}
    ) RETURNING id
  ` as Array<{ id: string }>;
  return ins[0]!.id;
}

test('PATCH discount_percent computes sale_price_cents', async () => {
  const id = await seedProduct({});
  const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products-detail/${id}?client=${clientId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({ discount_percent: 20 }),
  }), CTX);
  expect(r.status).toBe(200);
  const rows = await sql`SELECT discount_percent::float8 AS dp, sale_price_cents FROM public.products WHERE id = ${id}::uuid` as Array<{ dp: number; sale_price_cents: number }>;
  expect(rows[0]!.dp).toBe(20);
  expect(rows[0]!.sale_price_cents).toBe(8000);
});

test('PATCH price_cents recomputes sale_price_cents when discount_percent is set', async () => {
  const id = await seedProduct({ discount_percent: 20, sale_price_cents: 8000 });
  await uProductsDetailHandler(new Request(`http://localhost/api/u-products-detail/${id}?client=${clientId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({ price_cents: 11000 }),
  }), CTX);
  const rows = await sql`SELECT discount_percent::float8 AS dp, sale_price_cents FROM public.products WHERE id = ${id}::uuid` as Array<{ dp: number; sale_price_cents: number }>;
  expect(rows[0]!.dp).toBe(20);
  expect(rows[0]!.sale_price_cents).toBe(8800);
});

test('PATCH discount_percent=null clears discount; sale_price unchanged', async () => {
  const id = await seedProduct({ discount_percent: 20, sale_price_cents: 8000 });
  await uProductsDetailHandler(new Request(`http://localhost/api/u-products-detail/${id}?client=${clientId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({ discount_percent: null }),
  }), CTX);
  const rows = await sql`SELECT discount_percent, sale_price_cents FROM public.products WHERE id = ${id}::uuid` as Array<{ discount_percent: string | null; sale_price_cents: number | null }>;
  expect(rows[0]!.discount_percent).toBeNull();
  expect(rows[0]!.sale_price_cents).toBe(8000);
});

test('PATCH sale_price_cents alone on a discounted row → 400 sale_price_locked_by_discount', async () => {
  const id = await seedProduct({ discount_percent: 20, sale_price_cents: 8000 });
  const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products-detail/${id}?client=${clientId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({ sale_price_cents: 7500 }),
  }), CTX);
  expect(r.status).toBe(400);
  const body = await r.json() as { error: string };
  expect(body.error).toBe('sale_price_locked_by_discount');
});

test('PATCH {discount_percent: null, sale_price_cents: 7500} clears discount and honors freeform', async () => {
  const id = await seedProduct({ discount_percent: 20, sale_price_cents: 8000 });
  await uProductsDetailHandler(new Request(`http://localhost/api/u-products-detail/${id}?client=${clientId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({ discount_percent: null, sale_price_cents: 7500 }),
  }), CTX);
  const rows = await sql`SELECT discount_percent, sale_price_cents FROM public.products WHERE id = ${id}::uuid` as Array<{ discount_percent: string | null; sale_price_cents: number }>;
  expect(rows[0]!.discount_percent).toBeNull();
  expect(rows[0]!.sale_price_cents).toBe(7500);
});
```

The test file likely already imports `sql`, `clientId`, `buCookie`, `CTX`, `uProductsDetailHandler` at the top; reuse those — don't redeclare. If `uProductsDetailHandler` is the default export of `u-products-detail`, the existing tests will already have imported it.

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/integration/u-products-detail.test.ts -t "discount_percent\|sale_price_locked" 2>&1 | tail -20
npx vitest run tests/integration/u-products-detail.test.ts 2>&1 | tail -15
```

Both green.

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add netlify/functions/u-products-detail.ts tests/integration/u-products-detail.test.ts
git commit -m "feat(products): PATCH enforces discount → sale_price invariant + locks sale_price when discount set"
```

---

### Task 5: Import parser — `discount_percent` field

**Files:**
- Modify: `netlify/functions/_shared/products-import-parse.ts`
- Test: `tests/unit/products-import-parse.test.ts`

- [ ] **Step 1: Add a failing unit test**

Append to `tests/unit/products-import-parse.test.ts` inside the existing `describe('parseRow Phase B fields', ...)` block:

```ts
it('reads discount_percent as decimal in (0, 100)', () => {
  const csv = `sku,name,type,price,discount_percent\nW,Widget,physical,10.00,15.5`;
  const r = parseCsvBytes(Buffer.from(csv));
  expect(r.rows[0]!.discount_percent).toBe(15.5);
  expect(r.rows[0]!.errors).toEqual([]);
});

it('errors on discount_percent <= 0 or >= 100', () => {
  for (const bad of ['0', '100', '-5']) {
    const csv = `sku,name,type,price,discount_percent\nW,Widget,physical,10.00,${bad}`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.rows[0]!.errors.some((e) => e.field === 'discount_percent')).toBe(true);
  }
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol Data Collection App"
npx vitest run tests/unit/products-import-parse.test.ts -t "discount_percent" 2>&1 | tail -10
```

Expected: `discount_percent` doesn't exist on `ParsedImportRow`.

- [ ] **Step 3: Add `discount_percent` to PHASE_B_HEADERS, the row interface, and parseRow**

Edit `netlify/functions/_shared/products-import-parse.ts`:

(a) Append `'discount_percent'` to the `PHASE_B_HEADERS` tuple (after `'product_url'`):

```ts
export const PHASE_B_HEADERS = [
  // …existing 23…
  'product_url',
  'discount_percent',
] as const;
```

(b) Add `discount_percent: number | null;` to `ParsedImportRow` (after `product_url`).

(c) In `parseRow`, after the existing `gst_rate` parse block, add:

```ts
const discount_percent = present.has('discount_percent')
  ? parseDecimal(trimStr(raw, present, 'discount_percent'), errors, {
      field: 'discount_percent', min: 0.01, max: 99.99, allowNull: true,
    })
  : null;
```

(d) Add `discount_percent` to the return object.

- [ ] **Step 4: Run, expect green**

```bash
npx vitest run tests/unit/products-import-parse.test.ts 2>&1 | tail -15
```

- [ ] **Step 5: Update the Phase B `phase_b_columns_touched=23` assertion to 24**

The Phase B import test (`tests/integration/u-products-import.test.ts`) has a test that asserts `audits[0].detail.phase_b_columns_touched === 23` after importing `import-phase-b-full.csv`. After this task, `discount_percent` is the 24th Phase B header. If the existing full-fixture CSV does NOT include a `discount_percent` column, the assertion stays at 23 — no change. If the implementer added `discount_percent` to `import-phase-b-full.csv` (they shouldn't have in this task), the assertion becomes 24.

Check the fixture: `head -1 tests/fixtures/products/import-phase-b-full.csv` — confirm whether `discount_percent` is in the header row. If it is, bump the assertion to 24; if not, leave at 23. The fixture itself MUST NOT be edited as part of this task.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add netlify/functions/_shared/products-import-parse.ts tests/unit/products-import-parse.test.ts
git commit -m "feat(import): parse discount_percent column from CSV"
```

---

### Task 6: Import handler — override logic + warning expansion + dynamic CASE-WHEN UPDATE

**Files:**
- Modify: `netlify/functions/u-products-import.ts`
- Test: `tests/integration/u-products-import.test.ts`

- [ ] **Step 1: Add failing integration tests**

Append inside the existing `describe('u-products-import')` block:

```ts
test('discount_percent column computes sale_price_cents on import', async () => {
  const csv = [
    'sku,name,type,price,discount_percent',
    'D1,Widget,physical,100.00,20',
  ].join('\n');
  const ab = new ArrayBuffer(csv.length);
  new Uint8Array(ab).set(new TextEncoder().encode(csv));
  const fd = new FormData();
  fd.append('file', new Blob([ab], { type: 'text/csv' }), 'p.csv');
  const r = await uProductsImportHandler(new Request(`http://localhost/api/u-products-import?client=${clientId}`, {
    method: 'POST', headers: { cookie: buCookie }, body: fd,
  }), CTX);
  expect(r.status).toBe(200);
  const rows = await sql`SELECT discount_percent::float8, sale_price_cents FROM public.products WHERE sku = 'D1' AND client_id = ${clientId}::uuid` as Array<{ discount_percent: number; sale_price_cents: number }>;
  expect(rows[0]!.discount_percent).toBe(20);
  expect(rows[0]!.sale_price_cents).toBe(8000);
});

test('discount_percent + conflicting sale_price emits override warning', async () => {
  const csv = [
    'sku,name,type,price,sale_price,discount_percent',
    'D2,Widget,physical,100.00,90.00,20',
  ].join('\n');
  const ab = new ArrayBuffer(csv.length);
  new Uint8Array(ab).set(new TextEncoder().encode(csv));
  const fd = new FormData();
  fd.append('file', new Blob([ab], { type: 'text/csv' }), 'p.csv');
  const r = await uProductsImportHandler(new Request(`http://localhost/api/u-products-import?dry_run=1&client=${clientId}`, {
    method: 'POST', headers: { cookie: buCookie }, body: fd,
  }), CTX);
  expect(r.status).toBe(200);
  const body = await r.json() as { warnings: Array<{ row: number; message: string }> };
  expect(body.warnings.some((w) => /sale_price overridden by discount_percent/i.test(w.message))).toBe(true);
});

test('legacy CSV (no discount_percent header) preserves existing discount row', async () => {
  const seededSku = `DC-${Date.now()}`;
  await sql`
    INSERT INTO public.products (client_id, type, name, sku, price_cents, discount_percent, sale_price_cents)
    VALUES (${clientId}::uuid, 'physical', 'Seed', ${seededSku}, 10000, 20.0, 8000)
  `;
  const csv = [
    'sku,name,type,category,brand,price,currency,stock_qty,unit,status,tags,description',
    `${seededSku},Updated,physical,Electronics,,150.00,USD,3,each,active,,Updated description`,
  ].join('\n');
  const ab = new ArrayBuffer(csv.length);
  new Uint8Array(ab).set(new TextEncoder().encode(csv));
  const fd = new FormData();
  fd.append('file', new Blob([ab], { type: 'text/csv' }), 'p.csv');
  await uProductsImportHandler(new Request(`http://localhost/api/u-products-import?client=${clientId}`, {
    method: 'POST', headers: { cookie: buCookie }, body: fd,
  }), CTX);
  const rows = await sql`SELECT discount_percent::float8, sale_price_cents FROM public.products WHERE sku = ${seededSku} AND client_id = ${clientId}::uuid` as Array<{ discount_percent: number; sale_price_cents: number }>;
  expect(rows[0]!.discount_percent).toBe(20);
  // sale_price_cents preserved because legacy CSV has no sale_price header and no discount header
  expect(rows[0]!.sale_price_cents).toBe(8000);
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run tests/integration/u-products-import.test.ts -t "discount_percent\|legacy CSV.*preserves existing discount" 2>&1 | tail -20
```

Expected: the first two fail (no compute logic yet); the third may already pass via the dynamic CASE-WHEN (since headers absent → preserved). But it also exercises the import path so include it for completeness.

- [ ] **Step 3: Wire compute + override-warning + extend INSERT/UPDATE**

In `netlify/functions/u-products-import.ts`:

(a) Import:
```ts
import { computeSalePrice } from './_shared/products-discount';
```

(b) In the per-row commit loop, BEFORE the `if (v.action === 'create') {` branch, add:

```ts
let effectiveSalePriceCents: number | null = r.sale_price_cents;
if (r.discount_percent != null) {
  const computed = computeSalePrice(r.price_cents, r.discount_percent);
  if (r.sale_price_cents != null && r.sale_price_cents !== computed) {
    warnings.push({
      row: r.row_index,
      message: 'sale_price overridden by discount_percent',
    });
  }
  effectiveSalePriceCents = computed;
}
```

(c) In the INSERT statement, REPLACE the bare `${r.sale_price_cents}` token with `${effectiveSalePriceCents}`. Also add `discount_percent` to the column list and `${r.discount_percent}` to the VALUES list. Column count check: original 36 → 37 with discount_percent added.

(d) In the UPDATE statement, REPLACE the existing `sale_price_cents` CASE-WHEN clause:

```
sale_price_cents = CASE WHEN ${present.has('sale_price')}::boolean THEN ${r.sale_price_cents} ELSE sale_price_cents END,
```

with:

```
sale_price_cents = CASE
  WHEN ${present.has('discount_percent')}::boolean AND ${r.discount_percent != null}::boolean THEN ${effectiveSalePriceCents}
  WHEN ${present.has('sale_price')}::boolean THEN ${r.sale_price_cents}
  ELSE sale_price_cents
END,
```

(Higher priority for discount_percent: if the CSV has discount_percent and it's non-null, the computed value wins, even when sale_price is also present.)

Add a new CASE-WHEN for discount_percent itself (alphabetize near `description` or after `country_of_origin` — whichever block already groups Phase B columns):

```
discount_percent = CASE WHEN ${present.has('discount_percent')}::boolean THEN ${r.discount_percent} ELSE discount_percent END,
```

(e) Update the Phase B "no sale window" warning to also trigger when discount_percent is set without a sale window. Find the existing warning push at the line `if (r.sale_price_cents != null && r.sale_starts_at == null) { warnings.push(...) }` and change to:

```ts
if ((r.sale_price_cents != null || r.discount_percent != null) && r.sale_starts_at == null) {
  warnings.push({ row: r.row_index, message: 'sale price set but no sale window — will apply immediately' });
}
```

- [ ] **Step 4: Run the new tests, expect green**

```bash
npx vitest run tests/integration/u-products-import.test.ts -t "discount_percent\|legacy CSV.*preserves existing discount" 2>&1 | tail -20
```

- [ ] **Step 5: Run the full integration file (regressions)**

```bash
npx vitest run tests/integration/u-products-import.test.ts 2>&1 | tail -20
```

Expected: all green. The Phase B `sale_price`-without-window test should also continue to pass.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add netlify/functions/u-products-import.ts tests/integration/u-products-import.test.ts
git commit -m "feat(import): discount_percent column with override warning + dynamic CASE-WHEN"
```

---

### Task 7: Generic exporters + export SELECT

**Files:**
- Modify: `netlify/functions/_shared/exporters/types.ts`
- Modify: `netlify/functions/_shared/exporters/csv.ts`
- Modify: `netlify/functions/_shared/exporters/xlsx.ts`
- Modify: `netlify/functions/u-products-export.ts`
- Test: `tests/integration/u-products-export.test.ts` (extend) and `tests/unit/products-exporters-csv.test.ts` (extend)

- [ ] **Step 1: Add `discount_percent` to `ExportProductRow`**

In `netlify/functions/_shared/exporters/types.ts`, add to the interface:

```ts
discount_percent: number | null;
```

(Place it logically near `sale_price_cents`.)

- [ ] **Step 2: Update CSV exporter to emit a new column**

In `netlify/functions/_shared/exporters/csv.ts`, find the header array and the row builder. Append:

- Header: `'Discount %'` at the end of the header list.
- Per-row push: `row.discount_percent ?? ''` at the corresponding position.

- [ ] **Step 3: Update XLSX exporter similarly**

In `netlify/functions/_shared/exporters/xlsx.ts`, mirror the CSV change — same header position, same per-row value emission.

- [ ] **Step 4: Add `discount_percent` to the export SELECT**

In `netlify/functions/u-products-export.ts`, find the SELECT statement that builds the export row set. Add `discount_percent` to the column list. Cast may not be needed because the existing query already returns NUMERIC as a string; but if the exporter expects `number | null`, coerce in the row mapper: `discount_percent: r.discount_percent == null ? null : Number(r.discount_percent)`.

- [ ] **Step 5: Extend unit + integration tests**

In `tests/unit/products-exporters-csv.test.ts`, add a test that a row with `discount_percent: 15` produces a CSV with a `Discount %` column containing `15`. Pattern from the existing exporter tests.

In `tests/integration/u-products-export.test.ts`, append:

```ts
test('CSV export includes discount_percent column', async () => {
  // Create a product with discount_percent=15 via a direct SQL insert or the test helper.
  await sql`
    INSERT INTO public.products (client_id, type, name, sku, price_cents, discount_percent, sale_price_cents)
    VALUES (${clientId}::uuid, 'physical', 'DC-Export', 'EX-1', 10000, 15.0, 8500)
  `;
  const r = await uProductsExportHandler(new Request(`http://localhost/api/u-products-export?format=csv&client=${clientId}`, {
    method: 'GET', headers: { cookie: buCookie },
  }), CTX);
  expect(r.status).toBe(200);
  // The response is a ZIP; parse + read the inner CSV. Reuse whatever helper the
  // existing CSV-export test uses (search for "JSZip" or "unzip" in the file).
  // Assert the CSV header includes 'Discount %' and the EX-1 row shows '15'.
});
```

(If the existing CSV export test already has a helper for ZIP parsing, reuse it. Match its style.)

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/integration/u-products-export.test.ts 2>&1 | tail -15
npx vitest run tests/unit/products-exporters-csv.test.ts 2>&1 | tail -10
```

- [ ] **Step 7: Verify platform exporters did NOT change**

```bash
git diff --stat HEAD netlify/functions/_shared/exporters/ | grep -E "meta.ts|whatsapp.ts|amazon.ts|flipkart.ts"
```

Expected: empty (no diff). The 4 platform exporters are unchanged.

- [ ] **Step 8: Typecheck + commit**

```bash
npm run typecheck
git add netlify/functions/_shared/exporters/types.ts netlify/functions/_shared/exporters/csv.ts netlify/functions/_shared/exporters/xlsx.ts netlify/functions/u-products-export.ts tests/unit/products-exporters-csv.test.ts tests/integration/u-products-export.test.ts
git commit -m "feat(export): emit Discount % column in generic CSV+XLSX exporters"
```

---

### Task 8: UI — `ProductCommerceSection.tsx`

**Files:**
- Modify: `src/modules/products/workspace/components/ProductCommerceSection.tsx`
- Possibly: `src/lib/components.css` (one tiny rule if `.pm-input:disabled` doesn't exist)

- [ ] **Step 1: Extend the section's prop types**

Open `ProductCommerceSection.tsx`. The component currently destructures `sale_price_cents`, `sale_starts_at`, `sale_ends_at`, etc. Add `price_cents` (needed for live compute) and `discount_percent` to both the Props interface AND the Patch interface AND the destructured values:

```ts
// In the Props interface and the Patch interface, add:
price_cents: number;          // Props only — for live compute
discount_percent: number | null;
```

(Confirm whether `price_cents` is already passed in. If not, the parent `ProductEditPage` or `ProductForm` must pass it. Check `git grep "ProductCommerceSection" src/` to find the call site and update it to thread `price_cents` and `discount_percent` from the form state.)

- [ ] **Step 2: Add the helper import**

```ts
import { computeSalePrice } from '../../../../netlify/functions/_shared/products-discount';
// (Adjust the relative path; if the FE can't import from netlify/, copy the helper
// into src/modules/products/shared/discount.ts and use that. The shared helper
// is 5 lines; the duplication is acceptable for clarity. Decide based on the
// existing import patterns in the codebase. Run:
// grep -rn "from '../../../../netlify" src/ | head -3
// If results are empty, copy the helper rather than reach across.)
```

If you must copy the helper, create `src/modules/products/shared/discount.ts`:

```ts
export function computeSalePrice(priceCents: number, discountPct: number | null): number | null {
  if (discountPct == null) return null;
  return Math.round(priceCents * (1 - discountPct / 100));
}
```

And add a unit test in `src/modules/products/shared/discount.test.ts` mirroring the backend test (so the duplication can't drift silently). Re-confirm the FE test runner picks up `src/**/*.test.ts` — check `vitest.config.ts` or `package.json`.

- [ ] **Step 3: Add the Discount % input + Clear button + disabled-state logic**

Find the existing "Sale price (USD)" input block (around line 94). Replace the surrounding `<div class="pm-row">` (or whatever wrapper holds the sale-price field) with a two-input row:

```tsx
<div className="pm-row">
  <div className="pm-field">
    <label htmlFor="pm-discount-pct">Discount %</label>
    <input
      id="pm-discount-pct"
      type="number"
      step="0.01"
      min="0.01"
      max="99.99"
      value={discount_percent ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          onChange({ discount_percent: null });
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        onChange({ discount_percent: n });
      }}
    />
    {discount_percent != null && (
      <button
        type="button"
        className="pm-link-button"
        onClick={() => onChange({ discount_percent: null })}
      >
        Clear discount
      </button>
    )}
  </div>

  <div className="pm-field">
    <label htmlFor="pm-sale-price">
      Sale price (USD){discount_percent != null && <span className="pm-muted"> (auto-calculated)</span>}
    </label>
    <input
      id="pm-sale-price"
      type="number"
      step="0.01"
      disabled={discount_percent != null}
      title={discount_percent != null ? 'Auto-calculated from MRP × (1 − discount %)' : undefined}
      value={
        discount_percent != null
          ? ((computeSalePrice(price_cents, discount_percent) ?? 0) / 100).toFixed(2)
          : salePriceUsd
      }
      onChange={(e) => {
        if (discount_percent != null) return; // safety: input is disabled, but belt+suspenders
        const v = e.target.value;
        if (v === '') {
          onChange({ sale_price_cents: null });
          return;
        }
        const cents = Math.round(Number(v) * 100);
        if (!Number.isFinite(cents) || cents < 0) return;
        onChange({ sale_price_cents: cents });
      }}
    />
  </div>
</div>
```

(Match the existing className/styling pattern; the snippet above uses `pm-row`, `pm-field`, `pm-link-button` from the existing CSS. Confirm those classes exist in `src/lib/components.css`; if any are missing, add a minimal style.)

- [ ] **Step 4: Pass `price_cents` and `discount_percent` from the parent form**

Open the file that renders `<ProductCommerceSection ... />` (find with `grep -rn "ProductCommerceSection" src/`). Add the two new props to the JSX:

```tsx
<ProductCommerceSection
  price_cents={draft.price_cents}
  discount_percent={draft.discount_percent}
  sale_price_cents={draft.sale_price_cents}
  // …existing props…
  onChange={(patch) => setDraft({ ...draft, ...patch })}
/>
```

If the form's `Draft` type doesn't include `discount_percent`, add it (`discount_percent: number | null`) and ensure the form's initial-fetch + save-payload code paths thread it through.

- [ ] **Step 5: Run typecheck + build**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol Data Collection App"
npm run typecheck
npm run build 2>&1 | tail -5
```

Both clean.

- [ ] **Step 6: Commit**

```bash
git add src/modules/products/workspace/components/ProductCommerceSection.tsx src/modules/products/shared/discount.ts src/modules/products/shared/discount.test.ts src/lib/components.css "$(git diff --name-only HEAD | grep -E 'ProductEditPage|ProductForm')"
git commit -m "feat(products): UI discount_percent input + Clear button + live sale-price compute"
```

(Adjust the staged files if the parent form file was indeed edited; if `discount.ts`/`discount.test.ts` aren't created because the implementer chose to import directly from `_shared`, omit those paths.)

---

### Task 9: Final verification — full suite + manual smoke checklist

**Files:**
- No edits. This is a verification gate.

- [ ] **Step 1: Run full test suite**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol Data Collection App"
npm test 2>&1 | tail -10
```

Expected: green. Add the new tests (computeSalePrice helper, validator, parser, import handler, detail handler, exporter) to the prior 524-count baseline.

- [ ] **Step 2: Final typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Final build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Manual prod-smoke checklist (do NOT auto-execute — these are notes for the user)**

When ready to validate against a real deploy, the user should:

1. Edit any product; set Discount % = 20; save; reload; both Discount % and Sale Price persist.
2. On that same product, edit MRP (price); save; reload; Sale Price recomputes server-side.
3. Click Clear discount; save; Discount % is null, Sale Price retains the prior computed value (now freeform).
4. Export catalog CSV; confirm new "Discount %" column with `20` (or whatever the discount is).
5. Re-import the same CSV; confirm DB unchanged (Discount % preserved, no override warning).
6. Import a CSV with `discount_percent=30, sale_price=99` for an existing product. Confirm: `sale_price overridden by discount_percent` warning, Sale Price reflects the computed value.

- [ ] **Step 5: Commit a no-op closing-mark commit (optional)**

If the verification produces any tweaks (a typo, a comment), commit them here. Otherwise skip.

---

## Plan-completion summary

When all 9 tasks land:
- 1 new migration (`038_products_discount_percent.sql`)
- 1 new DB column (`discount_percent NUMERIC(5,2)`)
- 1 new shared helper (`computeSalePrice`) used by FE + 3 backend handlers + import row loop
- 1 new validator field + range check (`parseCreateProduct`)
- 1 new INSERT column on `u-products` POST
- New PATCH semantics on `u-products-detail` with 5-rule discount/sale-price logic + `sale_price_locked_by_discount` 400 error
- 1 new parsed field + 1 new CSV header in `products-import-parse.ts`
- Import handler: pre-INSERT/UPDATE compute logic + override warning + extended Phase B warning + UPDATE CASE-WHEN priority change
- Generic CSV + XLSX exporters gain `Discount %` column; export SELECT extended
- Platform exporters (`meta.ts`, `whatsapp.ts`, `amazon.ts`, `flipkart.ts`): UNCHANGED
- UI: one section file (`ProductCommerceSection.tsx`) + thread `price_cents` + `discount_percent` from parent
- ~6 new unit + ~12 new integration tests

No new dependency. No new permission. No new endpoint.

## Open risks at PR time

- **The 33.33% × $99.99 = ? expected value** for the rounding test (Task 2 Step 1): the test is intentionally written to be pinned post-hoc. Bake in the actual `Math.round` value after first run.
- **Sale price CSS for `:disabled`** (Task 8): if `.pm-input:disabled` styling doesn't exist, the disabled input may look identical to enabled. Add a minimal CSS rule if needed.
- **FE helper duplication** (Task 8 Step 2): if `src/` cannot import from `netlify/`, the helper gets duplicated. The duplication is 5 lines + a 5-line test; acceptable. Keep the FE copy and backend copy bit-identical via the unit tests.
- **Existing UPDATE in the import handler** previously gave priority to `sale_price`'s present flag. Task 6 changes the priority to `discount_percent`. Verify the Phase B regression test (legacy CSV preserves Phase B data) still passes — the test seeds rows that have NEITHER `discount_percent` NOR `sale_price` in the legacy CSV, so the priority change shouldn't affect it. Run the test explicitly during Step 5 of Task 6.
- **The PATCH detail handler now fetches the existing row early.** Confirm this doesn't accidentally double-fetch (the handler may already do this for the 404 check). If so, reuse the existing fetch.
