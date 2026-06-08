# Product Manager (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the workspace-facing Product Manager module — clients (bucket users) can CRUD a mixed catalog of physical goods and services with managed categories, image galleries, bulk operations, and CSV/XLSX import/export — gated by four new permission flags.

**Architecture:** Three migrations create `product_categories`, `products`, and `product_images`. Server side mirrors the proven `u-*` workspace endpoint pattern (bucket-user JWT via `requireBucketUser`, `module.bucket.verb` permission gates via the existing `permissions.ts` middleware). A new module manifest (`products`) with two data buckets (`catalog`, `categories`) registers the four flags so the Access Levels matrix surfaces them automatically. Images live in a dedicated `product-images` Netlify Blob store, uploaded via the same 3-step presigned-URL flow proven in the File Manager. Frontend is a new `src/modules/products/` tree mirroring `src/modules/files/` — workspace pages only this phase; admin defers to Phase B.

**Tech Stack:** TypeScript everywhere. Netlify Functions + Neon (`@neondatabase/serverless`). React 18 + react-router-dom + dnd-kit. Vitest for tests. SheetJS (`xlsx`) for import/export. Builds on [2026-06-08-product-manager-design.md](../specs/2026-06-08-product-manager-design.md).

---

## File map

**New files (server — endpoints):**
- `netlify/functions/u-product-categories.ts` — GET/POST/PATCH/DELETE categories
- `netlify/functions/u-products.ts` — GET list (filters + counts), POST create
- `netlify/functions/u-products-detail.ts` — GET/PATCH/DELETE single product
- `netlify/functions/u-products-bulk.ts` — POST bulk actions
- `netlify/functions/u-products-upload-url.ts` — POST presigned blob URL
- `netlify/functions/u-products-image.ts` — POST register / DELETE image
- `netlify/functions/u-products-export.ts` — GET CSV/XLSX download
- `netlify/functions/u-products-import.ts` — POST dry-run + commit
- `netlify/functions/_shared/products-storage.ts` — blob helpers for `product-images` store
- `netlify/functions/_shared/products-validate.ts` — Zod schemas + type guards
- `netlify/functions/_shared/products-import-parse.ts` — CSV/XLSX → typed rows

**New files (frontend — module):**
- `src/modules/products/shared/types.ts`
- `src/modules/products/shared/api.ts`
- `src/modules/products/shared/permissions.ts`
- `src/modules/products/workspace/pages/ProductsListPage.tsx`
- `src/modules/products/workspace/pages/ProductEditPage.tsx`
- `src/modules/products/workspace/pages/ProductCategoriesPage.tsx`
- `src/modules/products/workspace/components/ProductStatusTabs.tsx`
- `src/modules/products/workspace/components/ProductFiltersBar.tsx`
- `src/modules/products/workspace/components/ProductBulkBar.tsx`
- `src/modules/products/workspace/components/ProductTable.tsx`
- `src/modules/products/workspace/components/ProductTablePager.tsx`
- `src/modules/products/workspace/components/ProductForm.tsx`
- `src/modules/products/workspace/components/ProductBasicsSection.tsx`
- `src/modules/products/workspace/components/ProductPricingSection.tsx`
- `src/modules/products/workspace/components/ProductMediaSection.tsx`
- `src/modules/products/workspace/components/ProductImageGallery.tsx`
- `src/modules/products/workspace/components/ProductOrgSection.tsx`
- `src/modules/products/workspace/components/ProductImportModal.tsx`

**New files (DB migrations):**
- `db/migrations/033_product_categories.sql`
- `db/migrations/034_products.sql`
- `db/migrations/035_product_images.sql`

**New files (registry):**
- `src/modules/registry/modules-list/products.ts` — module manifest
- (no new product manifest; products module attaches to existing default product OR a workspace-default product key — see Task 4)

**New files (tests):**
- `tests/integration/products/products-crud.test.ts`
- `tests/integration/products/products-permissions.test.ts`
- `tests/integration/products/products-filters.test.ts`
- `tests/integration/products/products-bulk.test.ts`
- `tests/integration/products/products-import.test.ts`
- `tests/integration/products/products-export.test.ts`
- `tests/integration/products/product-categories.test.ts`
- `tests/integration/products/products-images.test.ts`
- `tests/integration/products/products-audit.test.ts`
- `tests/unit/products-validate.test.ts`
- `tests/unit/products-import-parse.test.ts`
- `tests/fixtures/products/import-valid.csv`
- `tests/fixtures/products/import-mixed-errors.csv`
- `tests/fixtures/products/import-valid.xlsx`

**Modified files:**
- `src/lib/router.tsx` — add `/w/:slug/products/*` routes
- `src/modules/user-portal/components/WorkspaceSidebar.tsx` (or equivalent — confirm in Task 19) — add sidebar entry
- `src/modules/registry/modules.ts` — register `products` module
- `src/modules/registry/products-list/saloon-booking.ts` (and any other product manifests) — add `products` module reference if applicable
- `netlify/functions/_shared/permission-keys.ts` — add the four `products.*` keys (if explicitly enumerated there)
- `package.json` — add `xlsx` dependency if not already present

---

## Pre-flight (every task)

```bash
npm run typecheck && npm test
```

Before any DB migration is applied to prod, follow the existing rule:
```bash
# Echo the host first — never drop on the wrong branch
psql "$DATABASE_URL" -c "SELECT current_database(), inet_server_addr();"
npm run migrate
```

---

## Task 1: Branch verification + dependency check

**Files:**
- Verify: `package.json` for `xlsx` dependency

- [ ] **Step 1: Verify branch**

Run:
```bash
git branch --show-current
```
Expected: `feat/product-manager`

- [ ] **Step 2: Check for `xlsx` dependency**

Run:
```bash
grep '"xlsx"' package.json || echo "MISSING"
```

- [ ] **Step 3: Install `xlsx` if missing**

If MISSING:
```bash
npm install xlsx
```

- [ ] **Step 4: Verify install**

Run:
```bash
node -e "console.log(require('xlsx').version)"
```
Expected: a version string (e.g., `0.20.x`).

- [ ] **Step 5: Commit (only if package.json/package-lock.json changed)**

```bash
git add package.json package-lock.json
git commit -m "chore(products): add xlsx for import/export"
```

---

## Task 2: Migration 033 — `product_categories`

**Files:**
- Create: `db/migrations/033_product_categories.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/033_product_categories.sql`:
```sql
-- Migration 033: product_categories — managed category list per workspace.
-- See docs/superpowers/specs/2026-06-08-product-manager-design.md §3.1.

CREATE TABLE public.product_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT product_categories_name_len CHECK (char_length(name) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX product_categories_client_name_uniq
  ON public.product_categories (client_id, name) WHERE deleted_at IS NULL;
CREATE INDEX product_categories_client_idx
  ON public.product_categories (client_id) WHERE deleted_at IS NULL;
```

- [ ] **Step 2: Apply to dev DB**

Run:
```bash
npm run migrate
```
Expected: migration 033 applied, no errors.

- [ ] **Step 3: Verify table**

Run:
```bash
psql "$DATABASE_URL" -c "\d public.product_categories"
```
Expected: table exists with seven columns + indexes.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/033_product_categories.sql
git commit -m "feat(products): migration 033 product_categories"
```

---

## Task 3: Migration 034 — `products`

**Files:**
- Create: `db/migrations/034_products.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/034_products.sql`:
```sql
-- Migration 034: products — central catalog row.
-- See docs/superpowers/specs/2026-06-08-product-manager-design.md §3.2.

CREATE TYPE product_type   AS ENUM ('physical', 'service');
CREATE TYPE product_status AS ENUM ('active', 'draft', 'archived');

CREATE TABLE public.products (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type                   product_type NOT NULL,
  name                   text NOT NULL,
  description            text,
  category_id            uuid REFERENCES public.product_categories(id) ON DELETE SET NULL,
  brand                  text,
  tags                   text[] NOT NULL DEFAULT '{}',
  price_cents            int  NOT NULL,
  currency               text NOT NULL DEFAULT 'USD',
  sku                    text,
  stock_qty              int,
  unit                   text,
  status                 product_status NOT NULL DEFAULT 'draft',
  hero_image_key         text,
  created_by_user_node   uuid REFERENCES public.user_nodes(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,

  CONSTRAINT products_type_fields_consistent CHECK (
    (type = 'service'  AND sku IS NULL AND stock_qty IS NULL AND unit IS NULL) OR
    (type = 'physical')
  ),
  CONSTRAINT products_price_nonneg CHECK (price_cents >= 0),
  CONSTRAINT products_stock_nonneg CHECK (stock_qty IS NULL OR stock_qty >= 0),
  CONSTRAINT products_name_len     CHECK (char_length(name) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX products_client_sku_idx
  ON public.products (client_id, sku) WHERE deleted_at IS NULL AND sku IS NOT NULL;
CREATE INDEX products_client_status_idx
  ON public.products (client_id, status) WHERE deleted_at IS NULL;
CREATE INDEX products_client_category_idx
  ON public.products (client_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX products_client_created_idx
  ON public.products (client_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX products_search_idx
  ON public.products USING gin (
    to_tsvector('simple', name || ' ' || coalesce(brand, '') || ' ' || coalesce(sku, ''))
  );

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER product_categories_updated_at
  BEFORE UPDATE ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

(The `set_updated_at` function was created in migration 005.)

- [ ] **Step 2: Apply**

```bash
npm run migrate
```

- [ ] **Step 3: Verify**

```bash
psql "$DATABASE_URL" -c "\d public.products" | head -30
psql "$DATABASE_URL" -c "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname IN ('product_type','product_status') ORDER BY typname, enumsortorder;"
```
Expected: table exists, both ENUM types have the expected labels.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/034_products.sql
git commit -m "feat(products): migration 034 products"
```

---

## Task 4: Migration 035 — `product_images`

**Files:**
- Create: `db/migrations/035_product_images.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 035: product_images — gallery (separate so reorder doesn't bump product.updated_at).
-- See docs/superpowers/specs/2026-06-08-product-manager-design.md §3.3.

CREATE TABLE public.product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  blob_key    text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_images_product_sort_idx
  ON public.product_images (product_id, sort_order);
```

- [ ] **Step 2: Apply**

```bash
npm run migrate
```

- [ ] **Step 3: Verify**

```bash
psql "$DATABASE_URL" -c "\d public.product_images"
```

- [ ] **Step 4: Commit**

```bash
git add db/migrations/035_product_images.sql
git commit -m "feat(products): migration 035 product_images"
```

---

## Task 5: Register `products` module in the manifest registry

**Files:**
- Create: `src/modules/registry/modules-list/products.ts`
- Modify: `src/modules/registry/modules.ts` — register the module
- Modify: `src/modules/registry/products-list/saloon-booking.ts` (and any other product manifests) — reference the `products` module so existing workspaces see the flags

- [ ] **Step 1: Read existing module manifest pattern**

Run:
```bash
ls src/modules/registry/modules-list/
cat src/modules/registry/modules-list/$(ls src/modules/registry/modules-list/ | head -1)
```
Expected: see the shape — `ModuleManifest` with `key`, `name`, `data_buckets`, `permissions`.

- [ ] **Step 2: Create products module manifest**

Create `src/modules/registry/modules-list/products.ts`:
```ts
import type { ModuleManifest } from '../types';

export const productsModule: ModuleManifest = {
  key: 'products',
  name: 'Product Manager',
  description: 'Manage the catalog of products and services your business offers.',
  data_buckets: ['catalog', 'categories'],
  permissions: {
    catalog: {
      view: { label: 'View products' },
      edit: { label: 'Create & edit products' },
      delete: { label: 'Archive & delete products' },
    },
    categories: {
      manage: { label: 'Manage product categories' },
    },
  },
};
```

Adjust property names if `ModuleManifest` differs — read `src/modules/registry/types.ts` first to confirm shape.

- [ ] **Step 3: Register in modules.ts**

Open `src/modules/registry/modules.ts` and add:
```ts
import { productsModule } from './modules-list/products';
// inside moduleRegistry object literal:
'products': productsModule,
```

- [ ] **Step 4: Reference from product manifest(s)**

Open `src/modules/registry/products-list/saloon-booking.ts` and add a module reference under `modules` array:
```ts
{ module: 'products' },
```
Repeat for any other product manifests.

- [ ] **Step 5: Verify Access-Levels UI renders the new rows**

Run:
```bash
npm run dev
```
Open the AccessLevels page in a browser — confirm `Product Manager → catalog (view/edit/delete)` and `Product Manager → categories (manage)` rows appear.

- [ ] **Step 6: Add typecheck-only quick test**

Run:
```bash
npm run typecheck
```
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/registry/
git commit -m "feat(products): register products module + 4 permission flags"
```

---

## Task 6: Shared validation schema + helpers

**Files:**
- Create: `netlify/functions/_shared/products-validate.ts`
- Create: `tests/unit/products-validate.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/products-validate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  parseCreateProduct, parsePatchProduct, validateTypeFields,
} from '../../netlify/functions/_shared/products-validate';

describe('parseCreateProduct', () => {
  it('accepts a valid physical product', () => {
    const r = parseCreateProduct({
      type: 'physical', name: 'Widget', price_cents: 1500,
      sku: 'W-1', stock_qty: 10, unit: 'each',
      category_id: '00000000-0000-0000-0000-000000000001',
      status: 'draft',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects service rows that include stock_qty', () => {
    const r = parseCreateProduct({
      type: 'service', name: 'Repair', price_cents: 8000, stock_qty: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].field).toBe('stock_qty');
  });

  it('rejects negative prices', () => {
    const r = parseCreateProduct({ type: 'physical', name: 'X', price_cents: -1 });
    expect(r.ok).toBe(false);
  });

  it('rejects names over 120 chars', () => {
    const r = parseCreateProduct({ type: 'physical', name: 'x'.repeat(121), price_cents: 0 });
    expect(r.ok).toBe(false);
  });
});

describe('parsePatchProduct', () => {
  it('rejects empty patch', () => {
    const r = parsePatchProduct({});
    expect(r.ok).toBe(false);
  });

  it('accepts a single-field patch', () => {
    const r = parsePatchProduct({ name: 'Renamed' });
    expect(r.ok).toBe(true);
  });
});

describe('validateTypeFields', () => {
  it('null SKU/stock/unit on service: ok', () => {
    expect(validateTypeFields({ type: 'service' })).toEqual([]);
  });
  it('SKU on service: error', () => {
    expect(validateTypeFields({ type: 'service', sku: 'X' })[0].field).toBe('sku');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/unit/products-validate.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `netlify/functions/_shared/products-validate.ts`:
```ts
export type ProductType   = 'physical' | 'service';
export type ProductStatus = 'active' | 'draft' | 'archived';

export interface FieldError { field: string; message: string; }

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
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isType(v: unknown): v is ProductType { return v === 'physical' || v === 'service'; }
function isStatus(v: unknown): v is ProductStatus { return v === 'active' || v === 'draft' || v === 'archived'; }

export function validateTypeFields(p: { type: ProductType; sku?: unknown; stock_qty?: unknown; unit?: unknown }): FieldError[] {
  if (p.type === 'service') {
    const errs: FieldError[] = [];
    if (p.sku       != null && p.sku       !== '') errs.push({ field: 'sku',       message: 'services cannot have sku' });
    if (p.stock_qty != null)                       errs.push({ field: 'stock_qty', message: 'services cannot have stock_qty' });
    if (p.unit      != null && p.unit      !== '') errs.push({ field: 'unit',      message: 'services cannot have unit' });
    return errs;
  }
  return [];
}

export function parseCreateProduct(input: unknown): ParseResult<CreateProductInput> {
  const errors: FieldError[] = [];
  const v = (input ?? {}) as Record<string, unknown>;

  if (!isType(v.type)) errors.push({ field: 'type', message: 'must be physical|service' });
  if (typeof v.name !== 'string' || v.name.length === 0 || v.name.length > 120) {
    errors.push({ field: 'name', message: 'required, 1..120 chars' });
  }
  if (typeof v.price_cents !== 'number' || !Number.isInteger(v.price_cents) || v.price_cents < 0) {
    errors.push({ field: 'price_cents', message: 'integer >= 0' });
  }
  if (v.category_id != null && (typeof v.category_id !== 'string' || !UUID_RE.test(v.category_id))) {
    errors.push({ field: 'category_id', message: 'must be uuid' });
  }
  if (v.status != null && !isStatus(v.status)) errors.push({ field: 'status', message: 'must be active|draft|archived' });
  if (v.tags != null && (!Array.isArray(v.tags) || !v.tags.every((t) => typeof t === 'string'))) {
    errors.push({ field: 'tags', message: 'must be string[]' });
  }
  if (v.stock_qty != null && (typeof v.stock_qty !== 'number' || !Number.isInteger(v.stock_qty) || v.stock_qty < 0)) {
    errors.push({ field: 'stock_qty', message: 'integer >= 0 or null' });
  }
  if (errors.length === 0 && isType(v.type)) {
    errors.push(...validateTypeFields({
      type: v.type, sku: v.sku, stock_qty: v.stock_qty, unit: v.unit,
    }));
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: v as unknown as CreateProductInput };
}

export type PatchProductInput = Partial<CreateProductInput>;

export function parsePatchProduct(input: unknown): ParseResult<PatchProductInput> {
  const v = (input ?? {}) as Record<string, unknown>;
  if (Object.keys(v).length === 0) return { ok: false, errors: [{ field: '_root', message: 'empty patch' }] };
  const ALLOWED = ['type','name','description','category_id','brand','tags','price_cents','sku','stock_qty','unit','status','hero_image_key'];
  const errors: FieldError[] = [];
  for (const k of Object.keys(v)) {
    if (!ALLOWED.includes(k)) errors.push({ field: k, message: 'unknown field' });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: v as PatchProductInput };
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/unit/products-validate.test.ts && npm run typecheck
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/products-validate.ts tests/unit/products-validate.test.ts
git commit -m "feat(products): shared validation helper + unit tests"
```

---

## Task 7: Categories endpoint — GET + POST + PATCH + DELETE

**Files:**
- Create: `netlify/functions/u-product-categories.ts`
- Create: `tests/integration/products/product-categories.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `tests/integration/products/product-categories.test.ts` covering:
  - GET returns empty list for new client; `products.catalog.view` required
  - POST creates a category; requires `products.categories.manage`; 403 without
  - POST duplicate name → 409
  - PATCH updates name; missing → 404
  - DELETE soft-deletes; products with that category get `category_id = null`
  - All mutations write an `audit_log` row

Pattern: reuse the test harness from `tests/integration/files-detail.test.ts` (uses `withFreshDb` + `loginBucketUser` helpers — verify these names in `tests/integration/_helpers/`).

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { withFreshDb, makeBucketUser, fetchAs } from '../_helpers/harness';

describe('u-product-categories', () => {
  it('GET returns 200 with empty list', async () => {
    await withFreshDb(async () => {
      const session = await makeBucketUser({ level: 1, perms: { 'products.catalog.view': true } });
      const res = await fetchAs(session, 'GET', '/u-product-categories');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toEqual([]);
    });
  });

  it('POST 403 without products.categories.manage', async () => {
    await withFreshDb(async () => {
      const session = await makeBucketUser({ level: 1, perms: { 'products.catalog.view': true } });
      const res = await fetchAs(session, 'POST', '/u-product-categories', { name: 'Electronics' });
      expect(res.status).toBe(403);
    });
  });

  it('POST creates + writes audit row', async () => {
    await withFreshDb(async (db) => {
      const session = await makeBucketUser({ level: 1, perms: { 'products.categories.manage': true, 'products.catalog.view': true } });
      const res = await fetchAs(session, 'POST', '/u-product-categories', { name: 'Electronics' });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
      const audit = await db`SELECT op FROM audit_log WHERE entity_id = ${body.id}`;
      expect(audit[0].op).toBe('product_categories.created');
    });
  });

  it('POST duplicate name returns 409', async () => {
    await withFreshDb(async () => {
      const session = await makeBucketUser({ level: 1, perms: { 'products.categories.manage': true } });
      await fetchAs(session, 'POST', '/u-product-categories', { name: 'Dup' });
      const res = await fetchAs(session, 'POST', '/u-product-categories', { name: 'Dup' });
      expect(res.status).toBe(409);
    });
  });

  it('DELETE soft-deletes and nulls product.category_id', async () => {
    await withFreshDb(async (db) => {
      const session = await makeBucketUser({ level: 1, perms: { 'products.categories.manage': true, 'products.catalog.edit': true, 'products.catalog.view': true } });
      const cat = await (await fetchAs(session, 'POST', '/u-product-categories', { name: 'X' })).json();
      const prod = await (await fetchAs(session, 'POST', '/u-products', { type: 'physical', name: 'P', price_cents: 100, category_id: cat.id })).json();
      const res = await fetchAs(session, 'DELETE', `/u-product-categories/${cat.id}`);
      expect(res.status).toBe(204);
      const r = await db`SELECT category_id FROM products WHERE id = ${prod.id}`;
      expect(r[0].category_id).toBeNull();
    });
  });
});
```

If `_helpers/harness.ts` (or equivalent) doesn't already exist with `withFreshDb` / `makeBucketUser` / `fetchAs`, **first** check `tests/integration/files-detail.test.ts` to see what helpers files use and follow that exact pattern. **Do not invent a new harness.**

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/integration/products/product-categories.test.ts
```
Expected: FAIL — endpoint not found / function not defined.

- [ ] **Step 3: Implement endpoint**

Create `netlify/functions/u-product-categories.ts`:
```ts
import { db } from './_shared/db';
import { jsonOk, jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { writeAudit } from './_shared/audit';

const MANAGE = 'products.categories.manage';
const VIEW   = 'products.catalog.view';

function levelHas(levelPerms: Record<string, boolean> | null | undefined, key: string): boolean {
  return Boolean(levelPerms?.[key]);
}

async function getLevelPerms(sql: ReturnType<typeof db>, client_id: string, level_number: number) {
  const rows = await sql`
    SELECT permissions FROM client_levels
    WHERE client_id = ${client_id}::uuid AND level_number = ${level_number}
    LIMIT 1
  ` as Array<{ permissions: Record<string, boolean> }>;
  return rows[0]?.permissions ?? {};
}

export default async function handler(req: Request) {
  try {
    const { credential, claims } = await requireBucketUser(req);
    const sql = db();
    const perms = await getLevelPerms(sql, credential.client_id, claims.level_number);
    const url = new URL(req.url);
    const m = url.pathname.match(/\/u-product-categories(?:\/([^/]+))?$/);
    const id = m?.[1];

    if (req.method === 'GET') {
      if (!levelHas(perms, VIEW)) return jsonError(403, 'forbidden');
      const items = await sql`
        SELECT id, name, sort_order, created_at, updated_at
        FROM product_categories
        WHERE client_id = ${credential.client_id}::uuid AND deleted_at IS NULL
        ORDER BY sort_order ASC, name ASC
      `;
      return jsonOk({ items });
    }

    if (req.method === 'POST') {
      if (!levelHas(perms, MANAGE)) return jsonError(403, 'forbidden');
      const body = await req.json().catch(() => ({})) as { name?: unknown; sort_order?: unknown };
      if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 80) {
        return jsonError(422, 'invalid_name');
      }
      try {
        const rows = await sql`
          INSERT INTO product_categories (client_id, name, sort_order)
          VALUES (${credential.client_id}::uuid, ${body.name}, ${typeof body.sort_order === 'number' ? body.sort_order : 0})
          RETURNING id, name, sort_order, created_at, updated_at
        `;
        await writeAudit(sql, {
          actor_user_node_id: credential.user_node_id,
          client_id: credential.client_id,
          entity_id: rows[0].id,
          op: 'product_categories.created',
          meta: { name: body.name },
        });
        return jsonOk(rows[0], { status: 201 });
      } catch (e: any) {
        if (String(e?.message ?? '').includes('product_categories_client_name_uniq')) {
          return jsonError(409, 'duplicate_name');
        }
        throw e;
      }
    }

    if (!id) return jsonError(405, 'method_not_allowed');

    if (req.method === 'PATCH') {
      if (!levelHas(perms, MANAGE)) return jsonError(403, 'forbidden');
      const body = await req.json().catch(() => ({})) as { name?: unknown; sort_order?: unknown };
      const updates: string[] = [];
      const vals: unknown[] = [];
      if (typeof body.name === 'string') { updates.push('name'); vals.push(body.name); }
      if (typeof body.sort_order === 'number') { updates.push('sort_order'); vals.push(body.sort_order); }
      if (updates.length === 0) return jsonError(422, 'empty_patch');
      // Build SET ...
      const rows = await sql`
        UPDATE product_categories
        SET name = COALESCE(${typeof body.name === 'string' ? body.name : null}, name),
            sort_order = COALESCE(${typeof body.sort_order === 'number' ? body.sort_order : null}, sort_order),
            updated_at = now()
        WHERE id = ${id}::uuid AND client_id = ${credential.client_id}::uuid AND deleted_at IS NULL
        RETURNING id, name, sort_order, created_at, updated_at
      `;
      if (rows.length === 0) return jsonError(404, 'not_found');
      await writeAudit(sql, {
        actor_user_node_id: credential.user_node_id,
        client_id: credential.client_id,
        entity_id: id,
        op: 'product_categories.updated',
        meta: body,
      });
      return jsonOk(rows[0]);
    }

    if (req.method === 'DELETE') {
      if (!levelHas(perms, MANAGE)) return jsonError(403, 'forbidden');
      // FK on products is ON DELETE SET NULL — but we soft-delete here so we must null manually for soft.
      const rows = await sql`
        UPDATE product_categories SET deleted_at = now()
        WHERE id = ${id}::uuid AND client_id = ${credential.client_id}::uuid AND deleted_at IS NULL
        RETURNING id
      `;
      if (rows.length === 0) return jsonError(404, 'not_found');
      await sql`
        UPDATE products SET category_id = NULL, updated_at = now()
        WHERE category_id = ${id}::uuid AND deleted_at IS NULL
      `;
      await writeAudit(sql, {
        actor_user_node_id: credential.user_node_id,
        client_id: credential.client_id,
        entity_id: id,
        op: 'product_categories.deleted',
        meta: {},
      });
      return new Response(null, { status: 204 });
    }

    return jsonError(405, 'method_not_allowed');
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, e.reason);
    console.error('u-product-categories error', e);
    return jsonError(500, 'internal_error');
  }
}

export const config = { path: ['/u-product-categories', '/u-product-categories/:id'] };
```

If `writeAudit` doesn't exist in `_shared/audit.ts`, follow the pattern used by `files-detail.ts` — copy the exact `audit_log` INSERT shape.

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/integration/products/product-categories.test.ts && npm run typecheck
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/u-product-categories.ts tests/integration/products/product-categories.test.ts
git commit -m "feat(products): u-product-categories endpoint (CRUD + soft delete)"
```

---

## Task 8: Products list endpoint — `GET /u-products` (with counts)

**Files:**
- Create: `netlify/functions/u-products.ts` (GET only this task)
- Create: `tests/integration/products/products-filters.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/integration/products/products-filters.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { withFreshDb, makeBucketUser, fetchAs, seedProducts } from '../_helpers/harness';

describe('GET /u-products', () => {
  it('returns paged list with counts shape', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true } });
      await seedProducts(s, [
        { name: 'A', type: 'physical', price_cents: 100, status: 'active' },
        { name: 'B', type: 'physical', price_cents: 200, status: 'draft' },
        { name: 'C', type: 'service',  price_cents: 300, status: 'active' },
      ]);
      const res = await fetchAs(s, 'GET', '/u-products');
      const body = await res.json();
      expect(body.items).toHaveLength(3);
      expect(body.counts).toEqual({ all: 3, active: 2, draft: 1, archived: 0 });
      expect(body.total).toBe(3);
    });
  });

  it('filters by status without affecting tab counts', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true } });
      await seedProducts(s, [
        { name: 'A', type: 'physical', price_cents: 100, status: 'active' },
        { name: 'B', type: 'physical', price_cents: 200, status: 'draft' },
      ]);
      const res = await fetchAs(s, 'GET', '/u-products?status=active');
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.counts).toEqual({ all: 2, active: 1, draft: 1, archived: 0 });
    });
  });

  it('filters by type', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true } });
      await seedProducts(s, [
        { name: 'A', type: 'physical', price_cents: 100, status: 'active' },
        { name: 'B', type: 'service',  price_cents: 100, status: 'active' },
      ]);
      const res = await fetchAs(s, 'GET', '/u-products?type=physical');
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('A');
    });
  });

  it('search matches name, SKU, brand', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true } });
      await seedProducts(s, [
        { name: 'Headphones', type: 'physical', sku: 'WH-1', brand: 'SoundLab', price_cents: 100, status: 'active' },
        { name: 'USB Hub',    type: 'physical', sku: 'USB-1', brand: 'HubCo',   price_cents: 100, status: 'active' },
      ]);
      const res = await fetchAs(s, 'GET', '/u-products?q=soundlab');
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('Headphones');
    });
  });

  it('pagination respects page_size', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true } });
      const items = Array.from({ length: 5 }, (_, i) => ({
        name: `P${i}`, type: 'physical' as const, price_cents: i * 10, status: 'active' as const,
      }));
      await seedProducts(s, items);
      const res = await fetchAs(s, 'GET', '/u-products?page=1&page_size=2');
      const body = await res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(5);
      expect(body.page).toBe(1);
      expect(body.page_size).toBe(2);
    });
  });

  it('GET 403 without view perm', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: {} });
      const res = await fetchAs(s, 'GET', '/u-products');
      expect(res.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Add `seedProducts` helper if missing**

If `_helpers/harness.ts` lacks `seedProducts`, add it — it must POST through the actual endpoint (don't insert directly to keep tests black-box). For this task, it can use a temporary DB insert; revisit after Task 9 ships the POST endpoint.

- [ ] **Step 3: Run tests — verify they fail**

```bash
npx vitest run tests/integration/products/products-filters.test.ts
```
Expected: FAIL — endpoint not found.

- [ ] **Step 4: Implement GET handler**

Create `netlify/functions/u-products.ts`:
```ts
import { db } from './_shared/db';
import { jsonOk, jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { writeAudit } from './_shared/audit';
import { parseCreateProduct } from './_shared/products-validate';

const VIEW = 'products.catalog.view';
const EDIT = 'products.catalog.edit';

function levelHas(p: Record<string, boolean> | null | undefined, k: string) { return Boolean(p?.[k]); }

async function getLevelPerms(sql: ReturnType<typeof db>, client_id: string, level_number: number) {
  const rows = await sql`
    SELECT permissions FROM client_levels
    WHERE client_id = ${client_id}::uuid AND level_number = ${level_number}
    LIMIT 1
  ` as Array<{ permissions: Record<string, boolean> }>;
  return rows[0]?.permissions ?? {};
}

export default async function handler(req: Request) {
  try {
    const { credential, claims } = await requireBucketUser(req);
    const sql = db();
    const perms = await getLevelPerms(sql, credential.client_id, claims.level_number);

    if (req.method === 'GET') {
      if (!levelHas(perms, VIEW)) return jsonError(403, 'forbidden');
      return handleList(sql, req, credential.client_id);
    }
    if (req.method === 'POST') {
      if (!levelHas(perms, EDIT)) return jsonError(403, 'forbidden');
      return handleCreate(sql, req, credential);
    }
    return jsonError(405, 'method_not_allowed');
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, e.reason);
    console.error('u-products error', e);
    return jsonError(500, 'internal_error');
  }
}

async function handleList(sql: ReturnType<typeof db>, req: Request, client_id: string) {
  const url = new URL(req.url);
  const status      = url.searchParams.get('status');
  const type        = url.searchParams.get('type');
  const category_id = url.searchParams.get('category_id');
  const brand       = url.searchParams.get('brand');
  const q           = url.searchParams.get('q');
  const tags        = url.searchParams.getAll('tag');
  const page        = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const page_size   = Math.min(100, Math.max(1, parseInt(url.searchParams.get('page_size') ?? '20', 10) || 20));
  const sort        = (['created_at','name','price_cents'] as const).includes(url.searchParams.get('sort') as any) ? url.searchParams.get('sort')! : 'created_at';
  const order       = url.searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';

  // Tagged-template fragments preserved via sql<dot>raw-ish: we'll build separate WHERE
  // pieces in JS and use parameter binding. Because the neon driver uses tagged templates,
  // we keep this readable with a small helper that composes the WHERE.
  // Simpler: write 4 separate queries — one for `items` and three for status counts.
  // For initial implementation prioritize clarity over a single query.

  const baseWhere = `client_id = $1::uuid AND deleted_at IS NULL`;
  const params: unknown[] = [client_id];
  let where = baseWhere;
  if (type)        { params.push(type);        where += ` AND type = $${params.length}::product_type`; }
  if (category_id) { params.push(category_id); where += ` AND category_id = $${params.length}::uuid`; }
  if (brand)       { params.push(brand);       where += ` AND brand = $${params.length}`; }
  if (q)           { params.push(`%${q.toLowerCase()}%`); where += ` AND (lower(name) LIKE $${params.length} OR lower(coalesce(sku,'')) LIKE $${params.length} OR lower(coalesce(brand,'')) LIKE $${params.length})`; }
  if (tags.length) { params.push(tags); where += ` AND tags @> $${params.length}::text[]`; }

  // counts query — applies status-agnostic base where
  const countsSql = `
    SELECT
      COUNT(*)::int                                                AS all,
      COUNT(*) FILTER (WHERE status = 'active')::int               AS active,
      COUNT(*) FILTER (WHERE status = 'draft')::int                AS draft,
      COUNT(*) FILTER (WHERE status = 'archived')::int             AS archived
    FROM products
    WHERE ${where}
  `;
  const countsRows = await sql.query(countsSql, params) as any[];
  const counts = countsRows[0] ?? { all: 0, active: 0, draft: 0, archived: 0 };

  // items query — applies status if specified
  let itemsWhere = where;
  const itemsParams = [...params];
  if (status && status !== 'all') {
    itemsParams.push(status);
    itemsWhere += ` AND status = $${itemsParams.length}::product_status`;
  }
  itemsParams.push(page_size);
  itemsParams.push((page - 1) * page_size);
  const itemsSql = `
    SELECT id, type, name, description, category_id, brand, tags, price_cents, currency,
           sku, stock_qty, unit, status, hero_image_key, created_at, updated_at
    FROM products
    WHERE ${itemsWhere}
    ORDER BY ${sort} ${order}
    LIMIT $${itemsParams.length - 1}
    OFFSET $${itemsParams.length}
  `;
  const items = await sql.query(itemsSql, itemsParams) as any[];

  // total — same WHERE as items but no LIMIT/OFFSET
  const totalParams = itemsParams.slice(0, -2);
  const totalSql = `SELECT COUNT(*)::int AS total FROM products WHERE ${itemsWhere}`;
  const totalRows = await sql.query(totalSql, totalParams) as any[];
  const total = totalRows[0]?.total ?? 0;

  return jsonOk({ items, total, page, page_size, counts });
}

async function handleCreate(sql: ReturnType<typeof db>, req: Request, credential: { client_id: string; user_node_id: string }) {
  const body = await req.json().catch(() => ({}));
  const parsed = parseCreateProduct(body);
  if (!parsed.ok) return jsonError(422, 'invalid_input', parsed.errors);

  // SKU uniqueness pre-check (case-sensitive, scoped to client + not-deleted)
  const v = parsed.value;
  if (v.type === 'physical' && v.sku) {
    const dup = await sql`
      SELECT id FROM products
      WHERE client_id = ${credential.client_id}::uuid AND sku = ${v.sku} AND deleted_at IS NULL
      LIMIT 1
    `;
    if (dup.length) return jsonError(409, 'sku_in_use');
  }

  const rows = await sql`
    INSERT INTO products (
      client_id, type, name, description, category_id, brand, tags,
      price_cents, sku, stock_qty, unit, status, created_by_user_node
    ) VALUES (
      ${credential.client_id}::uuid, ${v.type}, ${v.name}, ${v.description ?? null},
      ${v.category_id ?? null}::uuid, ${v.brand ?? null},
      ${v.tags ?? []}::text[], ${v.price_cents},
      ${v.sku ?? null}, ${v.stock_qty ?? null}, ${v.unit ?? null},
      ${v.status ?? 'draft'}, ${credential.user_node_id}::uuid
    )
    RETURNING id, type, name, description, category_id, brand, tags, price_cents, currency,
              sku, stock_qty, unit, status, hero_image_key, created_at, updated_at
  `;
  await writeAudit(sql, {
    actor_user_node_id: credential.user_node_id,
    client_id: credential.client_id,
    entity_id: rows[0].id,
    op: 'products.created',
    meta: { name: v.name, type: v.type },
  });
  return jsonOk(rows[0], { status: 201 });
}

export const config = { path: '/u-products' };
```

> **Note on `sql.query(...)`** — the Neon serverless driver supports a `.query(text, params)` escape hatch. If our `db()` wrapper doesn't expose it, fall back to manually composed tagged-template branches per filter combination (uglier but works). Verify with `grep "sql.query" netlify/functions/` first.

- [ ] **Step 5: Run tests — verify pass**

```bash
npx vitest run tests/integration/products/products-filters.test.ts && npm run typecheck
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/u-products.ts tests/integration/products/products-filters.test.ts
git commit -m "feat(products): u-products GET list + counts + POST create"
```

---

## Task 9: Products detail endpoint — GET / PATCH / DELETE

**Files:**
- Create: `netlify/functions/u-products-detail.ts`
- Create: `tests/integration/products/products-crud.test.ts`

- [ ] **Step 1: Write failing tests**

Cover happy paths + edge cases:
- GET returns product with attached `images` array and `category` summary
- GET 404 for not-found / wrong-client
- PATCH updates name and price; emits `products.updated` audit
- PATCH status `draft → active` emits `products.status_changed` audit (in addition or instead of `.updated`)
- PATCH category_id change emits `products.category_changed`
- PATCH 422 when type=service and stock_qty provided
- DELETE soft-deletes and emits `products.archived`
- DELETE 403 without `products.catalog.delete`
- PATCH 403 without `products.catalog.edit`

```ts
import { describe, it, expect } from 'vitest';
import { withFreshDb, makeBucketUser, fetchAs, createProduct } from '../_helpers/harness';

describe('u-products-detail', () => {
  it('GET returns product + empty images', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      const p = await createProduct(s, { type: 'physical', name: 'X', price_cents: 100 });
      const res = await fetchAs(s, 'GET', `/u-products/${p.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(p.id);
      expect(body.images).toEqual([]);
    });
  });

  it('PATCH 403 without products.catalog.edit', async () => {
    await withFreshDb(async () => {
      const editor = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      const viewer = await makeBucketUser({ perms: { 'products.catalog.view': true } });
      const p = await createProduct(editor, { type: 'physical', name: 'X', price_cents: 100 });
      const res = await fetchAs(viewer, 'PATCH', `/u-products/${p.id}`, { name: 'Y' });
      expect(res.status).toBe(403);
    });
  });

  it('PATCH status change emits products.status_changed', async () => {
    await withFreshDb(async (db) => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      const p = await createProduct(s, { type: 'physical', name: 'X', price_cents: 100, status: 'draft' });
      await fetchAs(s, 'PATCH', `/u-products/${p.id}`, { status: 'active' });
      const audit = await db`SELECT op FROM audit_log WHERE entity_id = ${p.id} ORDER BY created_at`;
      expect(audit.map((a: any) => a.op)).toContain('products.status_changed');
    });
  });

  it('DELETE soft-deletes', async () => {
    await withFreshDb(async (db) => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true, 'products.catalog.delete': true } });
      const p = await createProduct(s, { type: 'physical', name: 'X', price_cents: 100 });
      const res = await fetchAs(s, 'DELETE', `/u-products/${p.id}`);
      expect(res.status).toBe(204);
      const row = await db`SELECT deleted_at FROM products WHERE id = ${p.id}`;
      expect(row[0].deleted_at).not.toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests — fail**

```bash
npx vitest run tests/integration/products/products-crud.test.ts
```

- [ ] **Step 3: Implement**

Create `netlify/functions/u-products-detail.ts`:
```ts
import { db } from './_shared/db';
import { jsonOk, jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { writeAudit } from './_shared/audit';
import { parsePatchProduct, validateTypeFields } from './_shared/products-validate';

const VIEW   = 'products.catalog.view';
const EDIT   = 'products.catalog.edit';
const DELETE = 'products.catalog.delete';

function levelHas(p: Record<string, boolean> | null | undefined, k: string) { return Boolean(p?.[k]); }

async function getLevelPerms(sql: ReturnType<typeof db>, client_id: string, level_number: number) {
  const rows = await sql`
    SELECT permissions FROM client_levels
    WHERE client_id = ${client_id}::uuid AND level_number = ${level_number} LIMIT 1
  ` as Array<{ permissions: Record<string, boolean> }>;
  return rows[0]?.permissions ?? {};
}

export default async function handler(req: Request) {
  try {
    const { credential, claims } = await requireBucketUser(req);
    const sql = db();
    const perms = await getLevelPerms(sql, credential.client_id, claims.level_number);
    const m = new URL(req.url).pathname.match(/\/u-products\/([^/]+)$/);
    const id = m?.[1];
    if (!id) return jsonError(404, 'not_found');

    if (req.method === 'GET') {
      if (!levelHas(perms, VIEW)) return jsonError(403, 'forbidden');
      const rows = await sql`
        SELECT id, type, name, description, category_id, brand, tags, price_cents, currency,
               sku, stock_qty, unit, status, hero_image_key, created_at, updated_at
        FROM products
        WHERE id = ${id}::uuid AND client_id = ${credential.client_id}::uuid AND deleted_at IS NULL
        LIMIT 1
      `;
      if (rows.length === 0) return jsonError(404, 'not_found');
      const images = await sql`
        SELECT id, blob_key, sort_order FROM product_images
        WHERE product_id = ${id}::uuid ORDER BY sort_order ASC
      `;
      return jsonOk({ ...rows[0], images });
    }

    if (req.method === 'PATCH') {
      if (!levelHas(perms, EDIT)) return jsonError(403, 'forbidden');
      const body = await req.json().catch(() => ({}));
      const parsed = parsePatchProduct(body);
      if (!parsed.ok) return jsonError(422, 'invalid_input', parsed.errors);
      const v = parsed.value;

      // Load current row for type-consistency check + audit diff
      const cur = await sql`
        SELECT type, status, category_id FROM products
        WHERE id = ${id}::uuid AND client_id = ${credential.client_id}::uuid AND deleted_at IS NULL
        LIMIT 1
      `;
      if (cur.length === 0) return jsonError(404, 'not_found');
      const effectiveType = (v.type ?? cur[0].type) as 'physical' | 'service';
      const tErrs = validateTypeFields({ type: effectiveType, sku: v.sku, stock_qty: v.stock_qty, unit: v.unit });
      if (tErrs.length) return jsonError(422, 'invalid_input', tErrs);

      // SKU uniqueness check if SKU changed
      if (v.sku !== undefined && v.sku !== null && v.sku !== '') {
        const dup = await sql`
          SELECT id FROM products
          WHERE client_id = ${credential.client_id}::uuid AND sku = ${v.sku}
            AND deleted_at IS NULL AND id <> ${id}::uuid LIMIT 1
        `;
        if (dup.length) return jsonError(409, 'sku_in_use');
      }

      const updated = await sql`
        UPDATE products SET
          type           = COALESCE(${v.type ?? null}::product_type, type),
          name           = COALESCE(${v.name ?? null}, name),
          description    = COALESCE(${v.description ?? null}, description),
          category_id    = ${v.category_id === undefined ? null : v.category_id}::uuid,
          brand          = COALESCE(${v.brand ?? null}, brand),
          tags           = COALESCE(${v.tags ?? null}::text[], tags),
          price_cents    = COALESCE(${v.price_cents ?? null}, price_cents),
          sku            = ${v.sku === undefined ? null : v.sku},
          stock_qty      = ${v.stock_qty === undefined ? null : v.stock_qty},
          unit           = ${v.unit === undefined ? null : v.unit},
          status         = COALESCE(${v.status ?? null}::product_status, status),
          hero_image_key = COALESCE(${(v as any).hero_image_key ?? null}, hero_image_key),
          updated_at     = now()
        WHERE id = ${id}::uuid AND client_id = ${credential.client_id}::uuid AND deleted_at IS NULL
        RETURNING id, type, name, description, category_id, brand, tags, price_cents, currency,
                  sku, stock_qty, unit, status, hero_image_key, created_at, updated_at
      `;
      // Note: the `COALESCE(...) :: cast` form treats `undefined` as null; the API contract is "only fields present in body are changed".
      // The query above is intentionally permissive: explicit `null` from the client clears nullable fields (description, brand, etc.).
      // Re-check with a stricter approach in a follow-up if needed.

      // Audit: always emit .updated; emit .status_changed if status changed; .category_changed if category_id changed.
      await writeAudit(sql, { actor_user_node_id: credential.user_node_id, client_id: credential.client_id, entity_id: id, op: 'products.updated', meta: v });
      if (v.status && v.status !== cur[0].status) {
        await writeAudit(sql, { actor_user_node_id: credential.user_node_id, client_id: credential.client_id, entity_id: id, op: 'products.status_changed', meta: { from: cur[0].status, to: v.status } });
      }
      if (v.category_id !== undefined && v.category_id !== cur[0].category_id) {
        await writeAudit(sql, { actor_user_node_id: credential.user_node_id, client_id: credential.client_id, entity_id: id, op: 'products.category_changed', meta: { from: cur[0].category_id, to: v.category_id } });
      }
      return jsonOk(updated[0]);
    }

    if (req.method === 'DELETE') {
      if (!levelHas(perms, DELETE)) return jsonError(403, 'forbidden');
      const rows = await sql`
        UPDATE products SET deleted_at = now()
        WHERE id = ${id}::uuid AND client_id = ${credential.client_id}::uuid AND deleted_at IS NULL
        RETURNING id
      `;
      if (rows.length === 0) return jsonError(404, 'not_found');
      await writeAudit(sql, { actor_user_node_id: credential.user_node_id, client_id: credential.client_id, entity_id: id, op: 'products.archived', meta: {} });
      return new Response(null, { status: 204 });
    }

    return jsonError(405, 'method_not_allowed');
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, e.reason);
    console.error('u-products-detail error', e);
    return jsonError(500, 'internal_error');
  }
}

export const config = { path: '/u-products/:id' };
```

> **The COALESCE+undefined→null pattern is sloppy** — clean it up: build the UPDATE dynamically using an array of `SET col = $n` fragments based on `Object.keys(v)`. Pseudo:
> ```ts
> const sets: string[] = []; const params: unknown[] = [];
> for (const [k, val] of Object.entries(v)) { params.push(val); sets.push(`${k} = $${params.length}`); }
> params.push(id, credential.client_id);
> await sql.query(`UPDATE products SET ${sets.join(',')}, updated_at = now() WHERE id = $${params.length-1}::uuid AND client_id = $${params.length}::uuid AND deleted_at IS NULL RETURNING *`, params);
> ```
> This is the cleaner version — prefer it if `sql.query` is available.

- [ ] **Step 4: Run tests — pass**

```bash
npx vitest run tests/integration/products/products-crud.test.ts && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/u-products-detail.ts tests/integration/products/products-crud.test.ts
git commit -m "feat(products): u-products-detail GET/PATCH/DELETE + audit"
```

---

## Task 10: Permission-boundary test sweep

**Files:**
- Create: `tests/integration/products/products-permissions.test.ts`

- [ ] **Step 1: Write the matrix**

For each endpoint + method combo, verify:
- No bucket-user JWT → 401
- Authenticated but no relevant flag → 403
- Correct flag → 200/201/204
- A flag *adjacent* but wrong (e.g., `products.categories.manage` for product create) → 403

```ts
import { describe, it, expect } from 'vitest';
import { withFreshDb, makeBucketUser, fetchAs } from '../_helpers/harness';

const cases = [
  { method: 'GET',    path: '/u-products',                requiresAny: ['products.catalog.view'] },
  { method: 'POST',   path: '/u-products',                requiresAny: ['products.catalog.edit'], body: { type: 'physical', name: 'X', price_cents: 100 } },
  { method: 'GET',    path: '/u-product-categories',      requiresAny: ['products.catalog.view'] },
  { method: 'POST',   path: '/u-product-categories',      requiresAny: ['products.categories.manage'], body: { name: 'C' } },
];

describe('permission gates', () => {
  for (const c of cases) {
    it(`${c.method} ${c.path} requires ${c.requiresAny.join('|')}`, async () => {
      await withFreshDb(async () => {
        const empty = await makeBucketUser({ perms: {} });
        const denied = await fetchAs(empty, c.method, c.path, c.body);
        expect(denied.status).toBe(403);

        const granted = await makeBucketUser({ perms: Object.fromEntries(c.requiresAny.map((k) => [k, true])) });
        const ok = await fetchAs(granted, c.method, c.path, c.body);
        expect([200, 201, 204]).toContain(ok.status);
      });
    });
  }

  it('unauthenticated → 401', async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/u-products`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run + pass**

```bash
npx vitest run tests/integration/products/products-permissions.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/products/products-permissions.test.ts
git commit -m "test(products): full permission boundary matrix"
```

---

## Task 11: Image upload — presigned URL + register + delete

**Files:**
- Create: `netlify/functions/_shared/products-storage.ts` — Netlify Blob helpers for the `product-images` store
- Create: `netlify/functions/u-products-upload-url.ts`
- Create: `netlify/functions/u-products-image.ts`
- Create: `tests/integration/products/products-images.test.ts`

- [ ] **Step 1: Read existing blob storage pattern**

```bash
cat netlify/functions/_shared/files-storage.ts
```
Mirror its shape: `getStore`, `presignPut`, validate-blob-exists helper. Just point at `'product-images'` instead of `'files'`.

- [ ] **Step 2: Implement products-storage.ts**

Create `netlify/functions/_shared/products-storage.ts` — paste the contents of `files-storage.ts` and:
- Rename exports if they're file-specific (`uploadFileToStore` → `uploadProductImageToStore`)
- Change the store name constant from `'files'` to `'product-images'`
- Keep the same MIME/size validation surface

Constants to enforce:
- Allowed MIME: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Max bytes per image: `10 * 1024 * 1024`

- [ ] **Step 3: Write failing image tests**

Create `tests/integration/products/products-images.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { withFreshDb, makeBucketUser, fetchAs, createProduct } from '../_helpers/harness';

describe('product images', () => {
  it('POST /u-products-upload-url returns uploadUrl + blob_key', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      const p = await createProduct(s, { type: 'physical', name: 'X', price_cents: 100 });
      const res = await fetchAs(s, 'POST', '/u-products-upload-url', { product_id: p.id, mime: 'image/png', byte_size: 1024 });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.uploadUrl).toBe('string');
      expect(typeof body.blob_key).toBe('string');
    });
  });

  it('POST /u-products-image registers a row + sets hero on first image', async () => {
    await withFreshDb(async (db) => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      const p = await createProduct(s, { type: 'physical', name: 'X', price_cents: 100 });
      // Skip the actual PUT — in test env we trust the storage helper or stub it.
      const blob_key = 'product-images/test-fake';
      const res = await fetchAs(s, 'POST', '/u-products-image', { product_id: p.id, blob_key, sort_order: 0 });
      expect(res.status).toBe(201);
      const heroRow = await db`SELECT hero_image_key FROM products WHERE id = ${p.id}`;
      expect(heroRow[0].hero_image_key).toBe(blob_key);
    });
  });

  it('enforces 20-image cap', async () => {
    await withFreshDb(async (db) => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      const p = await createProduct(s, { type: 'physical', name: 'X', price_cents: 100 });
      // Insert 20 images directly via DB
      for (let i = 0; i < 20; i++) {
        await db`INSERT INTO product_images (product_id, blob_key, sort_order) VALUES (${p.id}::uuid, ${'k' + i}, ${i})`;
      }
      const res = await fetchAs(s, 'POST', '/u-products-image', { product_id: p.id, blob_key: 'k20', sort_order: 20 });
      expect(res.status).toBe(422);
    });
  });

  it('DELETE removes image + reassigns hero if hero was deleted', async () => {
    await withFreshDb(async (db) => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      const p = await createProduct(s, { type: 'physical', name: 'X', price_cents: 100 });
      const im1 = await (await fetchAs(s, 'POST', '/u-products-image', { product_id: p.id, blob_key: 'k1', sort_order: 0 })).json();
      const im2 = await (await fetchAs(s, 'POST', '/u-products-image', { product_id: p.id, blob_key: 'k2', sort_order: 1 })).json();
      // hero is k1 from first POST; delete k1 → expect hero to become k2
      await fetchAs(s, 'DELETE', `/u-products-image/${im1.id}`);
      const row = await db`SELECT hero_image_key FROM products WHERE id = ${p.id}`;
      expect(row[0].hero_image_key).toBe('k2');
    });
  });
});
```

- [ ] **Step 4: Implement u-products-upload-url.ts**

Create `netlify/functions/u-products-upload-url.ts`:
```ts
import { db } from './_shared/db';
import { jsonOk, jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { presignPut } from './_shared/products-storage';

const EDIT = 'products.catalog.edit';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export default async function handler(req: Request) {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  try {
    const { credential, claims } = await requireBucketUser(req);
    const sql = db();
    const perms = (await sql`
      SELECT permissions FROM client_levels WHERE client_id = ${credential.client_id}::uuid AND level_number = ${claims.level_number} LIMIT 1
    `)[0]?.permissions ?? {};
    if (!perms[EDIT]) return jsonError(403, 'forbidden');

    const body = await req.json().catch(() => ({})) as { product_id?: unknown; mime?: unknown; byte_size?: unknown };
    if (typeof body.product_id !== 'string') return jsonError(422, 'product_id_required');
    if (typeof body.mime !== 'string' || !ALLOWED_MIME.has(body.mime)) return jsonError(422, 'unsupported_mime');
    if (typeof body.byte_size !== 'number' || body.byte_size <= 0 || body.byte_size > 10 * 1024 * 1024) {
      return jsonError(422, 'invalid_size');
    }

    // Verify product belongs to caller's client
    const prod = await sql`
      SELECT id FROM products WHERE id = ${body.product_id}::uuid AND client_id = ${credential.client_id}::uuid AND deleted_at IS NULL LIMIT 1
    `;
    if (prod.length === 0) return jsonError(404, 'product_not_found');

    const { uploadUrl, blob_key, expires_at } = await presignPut({
      product_id: body.product_id,
      mime: body.mime,
      byte_size: body.byte_size,
    });
    return jsonOk({ uploadUrl, blob_key, expires_at });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, e.reason);
    console.error('u-products-upload-url error', e);
    return jsonError(500, 'internal_error');
  }
}

export const config = { path: '/u-products-upload-url' };
```

- [ ] **Step 5: Implement u-products-image.ts (POST register + DELETE)**

Create `netlify/functions/u-products-image.ts`:
```ts
import { db } from './_shared/db';
import { jsonOk, jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { blobExists, deleteBlob } from './_shared/products-storage';

const EDIT = 'products.catalog.edit';
const MAX_IMAGES = 20;

export default async function handler(req: Request) {
  try {
    const { credential, claims } = await requireBucketUser(req);
    const sql = db();
    const perms = (await sql`
      SELECT permissions FROM client_levels WHERE client_id = ${credential.client_id}::uuid AND level_number = ${claims.level_number} LIMIT 1
    `)[0]?.permissions ?? {};
    if (!perms[EDIT]) return jsonError(403, 'forbidden');

    const m = new URL(req.url).pathname.match(/\/u-products-image(?:\/([^/]+))?$/);
    const imgId = m?.[1];

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({})) as { product_id?: unknown; blob_key?: unknown; sort_order?: unknown };
      if (typeof body.product_id !== 'string' || typeof body.blob_key !== 'string') return jsonError(422, 'invalid_input');

      // Confirm product belongs to client + count current images
      const prod = await sql`
        SELECT p.id, p.hero_image_key, COUNT(pi.id)::int AS image_count
        FROM products p LEFT JOIN product_images pi ON pi.product_id = p.id
        WHERE p.id = ${body.product_id}::uuid AND p.client_id = ${credential.client_id}::uuid AND p.deleted_at IS NULL
        GROUP BY p.id, p.hero_image_key LIMIT 1
      ` as Array<{ id: string; hero_image_key: string | null; image_count: number }>;
      if (prod.length === 0) return jsonError(404, 'product_not_found');
      if (prod[0].image_count >= MAX_IMAGES) return jsonError(422, 'max_images_reached');

      // Confirm blob exists in storage
      if (!(await blobExists(body.blob_key))) return jsonError(422, 'blob_not_found');

      const sortOrder = typeof body.sort_order === 'number' ? body.sort_order : prod[0].image_count;
      const rows = await sql`
        INSERT INTO product_images (product_id, blob_key, sort_order)
        VALUES (${body.product_id}::uuid, ${body.blob_key}, ${sortOrder})
        RETURNING id, blob_key, sort_order, created_at
      `;
      // First image becomes hero automatically
      if (!prod[0].hero_image_key) {
        await sql`UPDATE products SET hero_image_key = ${body.blob_key}, updated_at = now() WHERE id = ${body.product_id}::uuid`;
      }
      return jsonOk(rows[0], { status: 201 });
    }

    if (req.method === 'DELETE' && imgId) {
      const rows = await sql`
        SELECT pi.id, pi.blob_key, pi.product_id, p.hero_image_key
        FROM product_images pi
        JOIN products p ON p.id = pi.product_id
        WHERE pi.id = ${imgId}::uuid AND p.client_id = ${credential.client_id}::uuid
        LIMIT 1
      ` as Array<{ id: string; blob_key: string; product_id: string; hero_image_key: string | null }>;
      if (rows.length === 0) return jsonError(404, 'not_found');
      await sql`DELETE FROM product_images WHERE id = ${imgId}::uuid`;
      await deleteBlob(rows[0].blob_key).catch(() => { /* orphan tolerated */ });
      if (rows[0].hero_image_key === rows[0].blob_key) {
        const next = await sql`
          SELECT blob_key FROM product_images WHERE product_id = ${rows[0].product_id}::uuid ORDER BY sort_order ASC LIMIT 1
        ` as Array<{ blob_key: string }>;
        await sql`UPDATE products SET hero_image_key = ${next[0]?.blob_key ?? null}, updated_at = now() WHERE id = ${rows[0].product_id}::uuid`;
      }
      return new Response(null, { status: 204 });
    }

    return jsonError(405, 'method_not_allowed');
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, e.reason);
    console.error('u-products-image error', e);
    return jsonError(500, 'internal_error');
  }
}

export const config = { path: ['/u-products-image', '/u-products-image/:id'] };
```

- [ ] **Step 6: Run + pass**

```bash
npx vitest run tests/integration/products/products-images.test.ts && npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/_shared/products-storage.ts netlify/functions/u-products-upload-url.ts netlify/functions/u-products-image.ts tests/integration/products/products-images.test.ts
git commit -m "feat(products): image upload URL + register/delete + hero rotation"
```

---

## Task 12: Bulk endpoint

**Files:**
- Create: `netlify/functions/u-products-bulk.ts`
- Create: `tests/integration/products/products-bulk.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { withFreshDb, makeBucketUser, fetchAs, createProduct } from '../_helpers/harness';

describe('u-products-bulk', () => {
  it('set_status: archives selected', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      const p1 = await createProduct(s, { type: 'physical', name: 'A', price_cents: 100 });
      const p2 = await createProduct(s, { type: 'physical', name: 'B', price_cents: 100 });
      const res = await fetchAs(s, 'POST', '/u-products-bulk', { ids: [p1.id, p2.id], action: 'set_status', value: 'archived' });
      const body = await res.json();
      expect(body.ok).toHaveLength(2);
      expect(body.errors).toHaveLength(0);
    });
  });

  it('partial success: missing id reports forbidden/not_found', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      const p1 = await createProduct(s, { type: 'physical', name: 'A', price_cents: 100 });
      const res = await fetchAs(s, 'POST', '/u-products-bulk', { ids: [p1.id, '00000000-0000-0000-0000-000000000000'], action: 'set_status', value: 'archived' });
      const body = await res.json();
      expect(body.ok).toEqual([p1.id]);
      expect(body.errors[0].id).toBe('00000000-0000-0000-0000-000000000000');
    });
  });

  it('delete requires .delete flag', async () => {
    await withFreshDb(async () => {
      const editor = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      const res = await fetchAs(editor, 'POST', '/u-products-bulk', { ids: ['00000000-0000-0000-0000-000000000000'], action: 'delete' });
      expect(res.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Implement**

Create `netlify/functions/u-products-bulk.ts`:
```ts
import { db } from './_shared/db';
import { jsonOk, jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { writeAudit } from './_shared/audit';

type Action =
  | { ids: string[]; action: 'set_status'; value: 'active' | 'draft' | 'archived' }
  | { ids: string[]; action: 'set_category'; category_id: string | null }
  | { ids: string[]; action: 'delete' };

export default async function handler(req: Request) {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  try {
    const { credential, claims } = await requireBucketUser(req);
    const sql = db();
    const perms = (await sql`
      SELECT permissions FROM client_levels WHERE client_id = ${credential.client_id}::uuid AND level_number = ${claims.level_number} LIMIT 1
    `)[0]?.permissions ?? {};

    const body = (await req.json().catch(() => ({}))) as Partial<Action>;
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 200) return jsonError(422, 'invalid_ids');
    if (!body.action) return jsonError(422, 'invalid_action');

    const requiredFlag =
      body.action === 'delete' ? 'products.catalog.delete' :
      body.action === 'set_status' || body.action === 'set_category' ? 'products.catalog.edit' :
      null;
    if (!requiredFlag || !perms[requiredFlag]) return jsonError(403, 'forbidden');

    // Pre-check ownership
    const owned = await sql`
      SELECT id FROM products
      WHERE client_id = ${credential.client_id}::uuid AND deleted_at IS NULL
        AND id = ANY(${body.ids}::uuid[])
    ` as Array<{ id: string }>;
    const ownedIds = new Set(owned.map((r) => r.id));
    const missingIds = body.ids.filter((id) => !ownedIds.has(id));

    const ok: string[] = [];
    if (ownedIds.size > 0) {
      const ids = Array.from(ownedIds);
      if (body.action === 'set_status') {
        await sql`UPDATE products SET status = ${body.value}::product_status, updated_at = now() WHERE client_id = ${credential.client_id}::uuid AND id = ANY(${ids}::uuid[])`;
        for (const id of ids) {
          await writeAudit(sql, { actor_user_node_id: credential.user_node_id, client_id: credential.client_id, entity_id: id, op: 'products.status_changed', meta: { to: body.value, bulk: true } });
        }
      } else if (body.action === 'set_category') {
        await sql`UPDATE products SET category_id = ${body.category_id ?? null}::uuid, updated_at = now() WHERE client_id = ${credential.client_id}::uuid AND id = ANY(${ids}::uuid[])`;
        for (const id of ids) {
          await writeAudit(sql, { actor_user_node_id: credential.user_node_id, client_id: credential.client_id, entity_id: id, op: 'products.category_changed', meta: { to: body.category_id, bulk: true } });
        }
      } else if (body.action === 'delete') {
        await sql`UPDATE products SET deleted_at = now() WHERE client_id = ${credential.client_id}::uuid AND id = ANY(${ids}::uuid[])`;
        for (const id of ids) {
          await writeAudit(sql, { actor_user_node_id: credential.user_node_id, client_id: credential.client_id, entity_id: id, op: 'products.archived', meta: { bulk: true } });
        }
      }
      ok.push(...ids);
    }

    return jsonOk({
      ok,
      errors: missingIds.map((id) => ({ id, code: 'not_found' })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, e.reason);
    console.error('u-products-bulk error', e);
    return jsonError(500, 'internal_error');
  }
}

export const config = { path: '/u-products-bulk' };
```

- [ ] **Step 3: Run + pass**

```bash
npx vitest run tests/integration/products/products-bulk.test.ts && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/u-products-bulk.ts tests/integration/products/products-bulk.test.ts
git commit -m "feat(products): bulk status/category/delete endpoint"
```

---

## Task 13: Export endpoint (CSV + XLSX)

**Files:**
- Create: `netlify/functions/u-products-export.ts`
- Create: `tests/integration/products/products-export.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { withFreshDb, makeBucketUser, fetchAs, createProduct } from '../_helpers/harness';

describe('u-products-export', () => {
  it('CSV export with header + matching rows', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      await createProduct(s, { type: 'physical', name: 'Apple', price_cents: 100, sku: 'A1' });
      await createProduct(s, { type: 'service',  name: 'Repair', price_cents: 8000 });
      const res = await fetchAs(s, 'GET', '/u-products-export?format=csv');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      const csv = await res.text();
      const lines = csv.trim().split('\n');
      expect(lines[0]).toContain('sku,name,type,category');
      expect(lines).toHaveLength(3); // header + 2 rows
    });
  });

  it('filter parity with list endpoint', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true } });
      await createProduct(s, { type: 'physical', name: 'P', price_cents: 100, status: 'active' });
      await createProduct(s, { type: 'physical', name: 'D', price_cents: 100, status: 'draft' });
      const res = await fetchAs(s, 'GET', '/u-products-export?format=csv&status=active');
      const csv = await res.text();
      expect(csv).toContain('"P"');
      expect(csv).not.toContain('"D"');
    });
  });
});
```

- [ ] **Step 2: Implement**

Create `netlify/functions/u-products-export.ts`:
```ts
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import * as XLSX from 'xlsx';

const VIEW = 'products.catalog.view';
const HEADERS = ['sku','name','type','category','brand','price','currency','stock_qty','unit','status','tags','description','created_at','hero_image_filename'];

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default async function handler(req: Request) {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  try {
    const { credential, claims } = await requireBucketUser(req);
    const sql = db();
    const perms = (await sql`
      SELECT permissions FROM client_levels WHERE client_id = ${credential.client_id}::uuid AND level_number = ${claims.level_number} LIMIT 1
    `)[0]?.permissions ?? {};
    if (!perms[VIEW]) return jsonError(403, 'forbidden');

    const url = new URL(req.url);
    const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';

    // Same WHERE-building as u-products list (without paging). Easiest path:
    // build the filter once. We'll repeat the small subset of filters here.
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    const category_id = url.searchParams.get('category_id');

    let where = `p.client_id = $1::uuid AND p.deleted_at IS NULL`;
    const params: unknown[] = [credential.client_id];
    if (type) { params.push(type); where += ` AND p.type = $${params.length}::product_type`; }
    if (status && status !== 'all') { params.push(status); where += ` AND p.status = $${params.length}::product_status`; }
    if (category_id) { params.push(category_id); where += ` AND p.category_id = $${params.length}::uuid`; }

    const rows = await sql.query(`
      SELECT p.sku, p.name, p.type, c.name AS category, p.brand,
             (p.price_cents::numeric / 100) AS price, p.currency,
             p.stock_qty, p.unit, p.status, p.tags, p.description, p.created_at,
             p.hero_image_key AS hero_image_filename
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id AND c.deleted_at IS NULL
      WHERE ${where}
      ORDER BY p.created_at DESC
    `, params) as any[];

    const slug = credential.client_id.slice(0, 8); // workspace slug lookup is fine here too; keep simple
    const today = new Date().toISOString().slice(0, 10);
    const filename = `products_${slug}_${today}.${format}`;

    if (format === 'csv') {
      const lines = [HEADERS.join(',')];
      for (const r of rows) {
        lines.push(HEADERS.map((h) => {
          if (h === 'tags') return csvEscape((r.tags ?? []).join(';'));
          if (h === 'price') return csvEscape(r.price);
          return csvEscape((r as any)[h]);
        }).join(','));
      }
      return new Response(lines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // xlsx
    const sheet = XLSX.utils.json_to_sheet(rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const h of HEADERS) {
        o[h] = h === 'tags' ? (r.tags ?? []).join(';') : (r as any)[h];
      }
      return o;
    }), { header: HEADERS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Products');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, e.reason);
    console.error('u-products-export error', e);
    return jsonError(500, 'internal_error');
  }
}

export const config = { path: '/u-products-export' };
```

- [ ] **Step 3: Run + pass**

```bash
npx vitest run tests/integration/products/products-export.test.ts && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/u-products-export.ts tests/integration/products/products-export.test.ts
git commit -m "feat(products): export endpoint (CSV + XLSX, filter-aware)"
```

---

## Task 14: Import — parse + dry-run + commit

**Files:**
- Create: `netlify/functions/_shared/products-import-parse.ts`
- Create: `netlify/functions/u-products-import.ts`
- Create: `tests/unit/products-import-parse.test.ts`
- Create: `tests/integration/products/products-import.test.ts`
- Create: `tests/fixtures/products/import-valid.csv`
- Create: `tests/fixtures/products/import-mixed-errors.csv`

- [ ] **Step 1: Create fixtures**

`tests/fixtures/products/import-valid.csv`:
```csv
sku,name,type,category,brand,price,currency,stock_qty,unit,status,tags,description
WH-1,Wireless Headphones,physical,Electronics,SoundLab,129.00,USD,24,each,active,wireless;audio,Premium over-ear
,Repair Service,service,Services,,80.00,USD,,,active,onsite,1-hour minimum
USB-1,USB-C Hub,physical,Electronics,HubCo,45.00,USD,0,each,draft,,
```

`tests/fixtures/products/import-mixed-errors.csv`:
```csv
sku,name,type,category,brand,price,currency,stock_qty,unit,status,tags,description
GOOD-1,Good Item,physical,Electronics,X,10,USD,1,each,active,,
,Bad Service,service,Services,,10,USD,5,,active,,
NEG-1,Negative Price,physical,Electronics,X,-5,USD,1,each,active,,
DUP-1,Dup A,physical,Electronics,X,10,USD,1,each,active,,
DUP-1,Dup B,physical,Electronics,X,10,USD,1,each,active,,
```

- [ ] **Step 2: Write parser unit tests**

`tests/unit/products-import-parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseCsvBytes } from '../../netlify/functions/_shared/products-import-parse';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('parseCsvBytes', () => {
  it('parses the valid fixture into 3 rows', () => {
    const bytes = readFileSync(join(__dirname, '../fixtures/products/import-valid.csv'));
    const r = parseCsvBytes(bytes);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].name).toBe('Wireless Headphones');
    expect(r.rows[0].price_cents).toBe(12900);
    expect(r.rows[1].type).toBe('service');
  });

  it('flags negative price and service-with-stock', () => {
    const bytes = readFileSync(join(__dirname, '../fixtures/products/import-mixed-errors.csv'));
    const r = parseCsvBytes(bytes);
    const errorRows = r.rows.filter((row) => row.errors.length > 0);
    expect(errorRows.length).toBeGreaterThanOrEqual(2);
    expect(errorRows.some((e) => e.errors.some((er) => er.field === 'price'))).toBe(true);
    expect(errorRows.some((e) => e.errors.some((er) => er.field === 'stock_qty'))).toBe(true);
  });
});
```

- [ ] **Step 3: Implement parser**

Create `netlify/functions/_shared/products-import-parse.ts`:
```ts
import * as XLSX from 'xlsx';
import { validateTypeFields, type FieldError } from './products-validate';

export interface ParsedImportRow {
  row_index: number;
  sku?: string | null;
  name: string;
  type: 'physical' | 'service';
  category_name?: string | null;
  brand?: string | null;
  price_cents: number;
  currency: string;
  stock_qty?: number | null;
  unit?: string | null;
  status: 'active' | 'draft' | 'archived';
  tags: string[];
  description?: string | null;
  errors: FieldError[];
}

export interface ParsedImport {
  rows: ParsedImportRow[];
  meta: { total: number; valid: number; error: number; };
}

function trim(s: unknown): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t.length === 0 ? null : t;
}

function parsePrice(s: string | null, errors: FieldError[]): number {
  if (!s) { errors.push({ field: 'price', message: 'required' }); return 0; }
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) { errors.push({ field: 'price', message: 'not a number' }); return 0; }
  if (n < 0) { errors.push({ field: 'price', message: 'must be >= 0' }); return 0; }
  return Math.round(n * 100);
}

function parseRow(raw: Record<string, unknown>, idx: number): ParsedImportRow {
  const errors: FieldError[] = [];
  const sku = trim(raw['sku']);
  const name = trim(raw['name']);
  if (!name) errors.push({ field: 'name', message: 'required' });
  const typeRaw = (trim(raw['type']) ?? '').toLowerCase();
  if (typeRaw !== 'physical' && typeRaw !== 'service') errors.push({ field: 'type', message: 'must be physical|service' });
  const type = (typeRaw === 'service' ? 'service' : 'physical') as 'physical' | 'service';
  const price_cents = parsePrice(trim(raw['price']), errors);
  const currency = (trim(raw['currency']) ?? 'USD').toUpperCase();
  if (currency !== 'USD') errors.push({ field: 'currency', message: 'Phase A locks to USD' });
  const stock_qty_raw = trim(raw['stock_qty']);
  let stock_qty: number | null = null;
  if (stock_qty_raw != null) {
    const n = Number(stock_qty_raw);
    if (!Number.isInteger(n) || n < 0) errors.push({ field: 'stock_qty', message: 'integer >= 0' });
    else stock_qty = n;
  }
  const unit = trim(raw['unit']);
  const statusRaw = (trim(raw['status']) ?? 'draft').toLowerCase();
  const status = (['active','draft','archived'].includes(statusRaw) ? statusRaw : 'draft') as 'active'|'draft'|'archived';
  const tagsRaw = trim(raw['tags']) ?? '';
  const tags = tagsRaw.length === 0 ? [] : tagsRaw.split(';').map((t) => t.trim()).filter(Boolean);
  const category_name = trim(raw['category']);
  const brand = trim(raw['brand']);
  const description = trim(raw['description']);

  errors.push(...validateTypeFields({ type, sku, stock_qty, unit }));

  return {
    row_index: idx + 2, // header is row 1
    sku, name: name ?? '', type,
    category_name, brand, price_cents, currency,
    stock_qty: type === 'service' ? null : stock_qty,
    unit: type === 'service' ? null : unit,
    status, tags, description, errors,
  };
}

export function parseCsvBytes(bytes: Uint8Array | Buffer): ParsedImport {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const rows = raw.map((r, i) => parseRow(r, i));
  const valid = rows.filter((r) => r.errors.length === 0).length;
  return { rows, meta: { total: rows.length, valid, error: rows.length - valid } };
}
```

- [ ] **Step 4: Write integration tests**

`tests/integration/products/products-import.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { withFreshDb, makeBucketUser, fetchAs } from '../_helpers/harness';
import { readFileSync } from 'fs';
import { join } from 'path';

const validCsv  = () => new Blob([readFileSync(join(__dirname, '../../fixtures/products/import-valid.csv'))], { type: 'text/csv' });
const mixedCsv  = () => new Blob([readFileSync(join(__dirname, '../../fixtures/products/import-mixed-errors.csv'))], { type: 'text/csv' });

async function postFile(session: any, path: string, file: Blob, qs = '') {
  const fd = new FormData();
  fd.append('file', file, 'in.csv');
  return fetchAs(session, 'POST', `${path}${qs}`, fd as any);
}

describe('u-products-import', () => {
  it('dry-run returns summary without writing', async () => {
    await withFreshDb(async (db) => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true, 'products.categories.manage': true } });
      const res = await postFile(s, '/u-products-import', validCsv(), '?dry_run=true');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.summary.to_create).toBe(3);
      const rows = await db`SELECT COUNT(*)::int AS c FROM products`;
      expect(rows[0].c).toBe(0);
    });
  });

  it('commit writes rows and creates missing categories with manage flag', async () => {
    await withFreshDb(async (db) => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true, 'products.categories.manage': true } });
      const res = await postFile(s, '/u-products-import', validCsv());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.committed).toBe(true);
      const cats = await db`SELECT name FROM product_categories ORDER BY name`;
      expect(cats.map((c: any) => c.name)).toEqual(['Electronics', 'Services']);
    });
  });

  it('missing category + no manage flag → error', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.edit': true, 'products.catalog.view': true } });
      const res = await postFile(s, '/u-products-import', validCsv(), '?dry_run=true');
      const body = await res.json();
      expect(body.errors.some((e: any) => /category/i.test(e.message))).toBe(true);
    });
  });

  it('mixed errors surface per-row', async () => {
    await withFreshDb(async () => {
      const s = await makeBucketUser({ perms: { 'products.catalog.view': true, 'products.catalog.edit': true, 'products.categories.manage': true } });
      const res = await postFile(s, '/u-products-import', mixedCsv(), '?dry_run=true');
      const body = await res.json();
      expect(body.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});
```

- [ ] **Step 5: Implement import endpoint**

Create `netlify/functions/u-products-import.ts`:
```ts
import { db } from './_shared/db';
import { jsonOk, jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { writeAudit } from './_shared/audit';
import { parseCsvBytes, type ParsedImportRow } from './_shared/products-import-parse';

const EDIT   = 'products.catalog.edit';
const MANAGE = 'products.categories.manage';

export default async function handler(req: Request) {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  try {
    const { credential, claims } = await requireBucketUser(req);
    const sql = db();
    const perms = (await sql`
      SELECT permissions FROM client_levels WHERE client_id = ${credential.client_id}::uuid AND level_number = ${claims.level_number} LIMIT 1
    `)[0]?.permissions ?? {};
    if (!perms[EDIT]) return jsonError(403, 'forbidden');

    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dry_run') === 'true';

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) return jsonError(422, 'file_required');
    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseCsvBytes(buf);

    // Load existing categories + products for matching
    const existingCats = await sql`SELECT id, name FROM product_categories WHERE client_id = ${credential.client_id}::uuid AND deleted_at IS NULL`;
    const catMap = new Map<string, string>(existingCats.map((c: any) => [c.name.toLowerCase(), c.id]));
    const existingProds = await sql`SELECT id, sku, name, type FROM products WHERE client_id = ${credential.client_id}::uuid AND deleted_at IS NULL` as any[];
    const skuMap = new Map<string, string>();
    for (const p of existingProds) if (p.sku) skuMap.set(p.sku.toLowerCase(), p.id);
    const nameTypeMap = new Map<string, string>();
    for (const p of existingProds) nameTypeMap.set(`${p.type}:${p.name.toLowerCase()}`, p.id);

    const errors: any[] = [];
    const warnings: any[] = [];
    const valid: any[] = [];
    const catsToCreate = new Set<string>();
    let to_create = 0, to_update = 0;

    for (const r of parsed.rows) {
      // structural errors
      for (const err of r.errors) errors.push({ row: r.row_index, field: err.field, message: err.message });

      // category resolution
      let category_id: string | null = null;
      if (r.category_name) {
        const existing = catMap.get(r.category_name.toLowerCase());
        if (existing) category_id = existing;
        else if (perms[MANAGE]) {
          catsToCreate.add(r.category_name);
          warnings.push({ row: r.row_index, message: `category '${r.category_name}' will be auto-created` });
        } else {
          errors.push({ row: r.row_index, field: 'category', message: `category '${r.category_name}' not found (no manage perm)` });
          continue;
        }
      }

      // upsert key
      let action: 'create' | 'update' = 'create';
      let existingId: string | undefined;
      if (r.sku && skuMap.has(r.sku.toLowerCase())) { action = 'update'; existingId = skuMap.get(r.sku.toLowerCase()); }
      else if (!r.sku && nameTypeMap.has(`${r.type}:${r.name.toLowerCase()}`)) { action = 'update'; existingId = nameTypeMap.get(`${r.type}:${r.name.toLowerCase()}`); }

      if (r.errors.length === 0) {
        valid.push({ row: r.row_index, name: r.name, action, ...(existingId ? { id: existingId } : {}), _row: r, _category_name: r.category_name });
        if (action === 'create') to_create++; else to_update++;
      }
    }

    const summary = { to_create, to_update, errors: errors.length, warnings: warnings.length };

    if (dryRun) {
      return jsonOk({ valid: valid.map(({ _row, _category_name, ...v }) => v), errors, warnings, summary });
    }

    // COMMIT
    if (errors.length > 0) return jsonOk({ valid: valid.map(({ _row, ...v }) => v), errors, warnings, summary, committed: false });

    // Auto-create categories first
    for (const name of catsToCreate) {
      const ins = await sql`
        INSERT INTO product_categories (client_id, name) VALUES (${credential.client_id}::uuid, ${name})
        ON CONFLICT DO NOTHING RETURNING id, name
      ` as Array<{ id: string; name: string }>;
      if (ins[0]) catMap.set(name.toLowerCase(), ins[0].id);
      else {
        // already existed (race) — read it back
        const r = await sql`SELECT id FROM product_categories WHERE client_id = ${credential.client_id}::uuid AND name = ${name} AND deleted_at IS NULL LIMIT 1` as any[];
        if (r[0]) catMap.set(name.toLowerCase(), r[0].id);
      }
    }

    // Insert/update products
    const createdIds: string[] = [];
    const updatedIds: string[] = [];
    for (const v of valid) {
      const r: ParsedImportRow = v._row;
      const category_id = r.category_name ? catMap.get(r.category_name.toLowerCase()) ?? null : null;
      if (v.action === 'create') {
        const ins = await sql`
          INSERT INTO products (
            client_id, type, name, description, category_id, brand, tags,
            price_cents, sku, stock_qty, unit, status, created_by_user_node
          ) VALUES (
            ${credential.client_id}::uuid, ${r.type}, ${r.name}, ${r.description ?? null},
            ${category_id}::uuid, ${r.brand ?? null}, ${r.tags}::text[], ${r.price_cents},
            ${r.sku ?? null}, ${r.stock_qty ?? null}, ${r.unit ?? null},
            ${r.status}, ${credential.user_node_id}::uuid
          ) RETURNING id
        ` as Array<{ id: string }>;
        createdIds.push(ins[0].id);
      } else if (v.id) {
        await sql`
          UPDATE products SET
            type=${r.type}::product_type, name=${r.name}, description=${r.description ?? null},
            category_id=${category_id}::uuid, brand=${r.brand ?? null}, tags=${r.tags}::text[],
            price_cents=${r.price_cents}, sku=${r.sku ?? null},
            stock_qty=${r.stock_qty ?? null}, unit=${r.unit ?? null}, status=${r.status}::product_status,
            updated_at=now()
          WHERE id=${v.id}::uuid AND client_id=${credential.client_id}::uuid
        `;
        updatedIds.push(v.id);
      }
    }

    await writeAudit(sql, {
      actor_user_node_id: credential.user_node_id, client_id: credential.client_id,
      entity_id: credential.client_id, // batch — use client as entity
      op: 'products.imported', meta: { created: createdIds.length, updated: updatedIds.length },
    });

    return jsonOk({
      valid: valid.map(({ _row, _category_name, ...v }) => v),
      errors, warnings, summary, committed: true,
      created_ids: createdIds, updated_ids: updatedIds,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, e.reason);
    console.error('u-products-import error', e);
    return jsonError(500, 'internal_error');
  }
}

export const config = { path: '/u-products-import' };
```

- [ ] **Step 6: Run + pass**

```bash
npx vitest run tests/unit/products-import-parse.test.ts tests/integration/products/products-import.test.ts && npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/_shared/products-import-parse.ts netlify/functions/u-products-import.ts tests/unit/products-import-parse.test.ts tests/integration/products/products-import.test.ts tests/fixtures/products/
git commit -m "feat(products): CSV/XLSX import with dry-run + commit"
```

---

## Task 15: Audit-log full sweep test

**Files:**
- Create: `tests/integration/products/products-audit.test.ts`

- [ ] **Step 1: Write test that exercises every audit op**

```ts
import { describe, it, expect } from 'vitest';
import { withFreshDb, makeBucketUser, fetchAs, createProduct } from '../_helpers/harness';

describe('products audit ops', () => {
  it('emits the full expected op set across a lifecycle', async () => {
    await withFreshDb(async (db) => {
      const s = await makeBucketUser({ perms: {
        'products.catalog.view': true, 'products.catalog.edit': true,
        'products.catalog.delete': true, 'products.categories.manage': true,
      } });

      const cat = await (await fetchAs(s, 'POST', '/u-product-categories', { name: 'C' })).json();
      const p = await createProduct(s, { type: 'physical', name: 'X', price_cents: 100 });
      await fetchAs(s, 'PATCH', `/u-products/${p.id}`, { name: 'Y' });
      await fetchAs(s, 'PATCH', `/u-products/${p.id}`, { status: 'active' });
      await fetchAs(s, 'PATCH', `/u-products/${p.id}`, { category_id: cat.id });
      await fetchAs(s, 'DELETE', `/u-products/${p.id}`);
      await fetchAs(s, 'DELETE', `/u-product-categories/${cat.id}`);

      const ops = (await db`SELECT op FROM audit_log ORDER BY created_at` as any[]).map((r) => r.op);
      expect(ops).toEqual(expect.arrayContaining([
        'product_categories.created',
        'products.created',
        'products.updated',
        'products.status_changed',
        'products.category_changed',
        'products.archived',
        'product_categories.deleted',
      ]));
    });
  });
});
```

- [ ] **Step 2: Run + pass + commit**

```bash
npx vitest run tests/integration/products/products-audit.test.ts
git add tests/integration/products/products-audit.test.ts
git commit -m "test(products): full audit-op sweep"
```

---

## Task 16: Frontend shared layer — types, api client, permissions

**Files:**
- Create: `src/modules/products/shared/types.ts`
- Create: `src/modules/products/shared/api.ts`
- Create: `src/modules/products/shared/permissions.ts`

- [ ] **Step 1: Types**

Create `src/modules/products/shared/types.ts`:
```ts
export type ProductType   = 'physical' | 'service';
export type ProductStatus = 'active' | 'draft' | 'archived';

export interface ProductImage {
  id: string;
  blob_key: string;
  sort_order: number;
}

export interface Product {
  id: string;
  type: ProductType;
  name: string;
  description: string | null;
  category_id: string | null;
  brand: string | null;
  tags: string[];
  price_cents: number;
  currency: string;
  sku: string | null;
  stock_qty: number | null;
  unit: string | null;
  status: ProductStatus;
  hero_image_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductWithImages extends Product { images: ProductImage[]; }

export interface ProductCategory {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
  counts: { all: number; active: number; draft: number; archived: number };
}

export interface ProductFilters {
  status?: ProductStatus | 'all';
  type?: ProductType;
  category_id?: string;
  brand?: string;
  q?: string;
  tags?: string[];
  page?: number;
  page_size?: number;
  sort?: 'created_at' | 'name' | 'price_cents';
  order?: 'asc' | 'desc';
}

export type BulkAction =
  | { ids: string[]; action: 'set_status'; value: ProductStatus }
  | { ids: string[]; action: 'set_category'; category_id: string | null }
  | { ids: string[]; action: 'delete' };

export interface ImportSummary {
  to_create: number;
  to_update: number;
  errors: number;
  warnings: number;
}

export interface ImportDryRun {
  valid: Array<{ row: number; name: string; action: 'create' | 'update'; id?: string }>;
  errors: Array<{ row: number; field: string; message: string }>;
  warnings: Array<{ row: number; message: string }>;
  summary: ImportSummary;
  committed?: boolean;
}
```

- [ ] **Step 2: API client**

Create `src/modules/products/shared/api.ts`:
```ts
import { apiClient } from '../../../lib/api-client';
import type {
  Product, ProductWithImages, ProductCategory, ProductListResponse,
  ProductFilters, BulkAction, ImportDryRun,
} from './types';

function qs(filters: ProductFilters): string {
  const p = new URLSearchParams();
  if (filters.status)       p.set('status', filters.status);
  if (filters.type)         p.set('type', filters.type);
  if (filters.category_id)  p.set('category_id', filters.category_id);
  if (filters.brand)        p.set('brand', filters.brand);
  if (filters.q)            p.set('q', filters.q);
  if (filters.tags)         for (const t of filters.tags) p.append('tag', t);
  if (filters.page)         p.set('page', String(filters.page));
  if (filters.page_size)    p.set('page_size', String(filters.page_size));
  if (filters.sort)         p.set('sort', filters.sort);
  if (filters.order)        p.set('order', filters.order);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const productsApi = {
  list: (f: ProductFilters): Promise<ProductListResponse> =>
    apiClient.get(`/u-products${qs(f)}`),
  get: (id: string): Promise<ProductWithImages> =>
    apiClient.get(`/u-products/${id}`),
  create: (body: Partial<Product>): Promise<Product> =>
    apiClient.post('/u-products', body),
  update: (id: string, body: Partial<Product>): Promise<Product> =>
    apiClient.patch(`/u-products/${id}`, body),
  remove: (id: string): Promise<void> =>
    apiClient.delete(`/u-products/${id}`),
  bulk: (body: BulkAction): Promise<{ ok: string[]; errors: { id: string; code: string }[] }> =>
    apiClient.post('/u-products-bulk', body),
  exportUrl: (f: ProductFilters & { format: 'csv'|'xlsx' }): string =>
    `/u-products-export${qs(f)}${qs(f) ? '&' : '?'}format=${f.format}`,
  importDryRun: (file: File): Promise<ImportDryRun> => {
    const fd = new FormData();
    fd.append('file', file);
    return apiClient.postFormData('/u-products-import?dry_run=true', fd);
  },
  importCommit: (file: File): Promise<ImportDryRun & { committed: true }> => {
    const fd = new FormData();
    fd.append('file', file);
    return apiClient.postFormData('/u-products-import', fd);
  },
};

export const categoriesApi = {
  list: (): Promise<{ items: ProductCategory[] }> => apiClient.get('/u-product-categories'),
  create: (name: string): Promise<ProductCategory> => apiClient.post('/u-product-categories', { name }),
  update: (id: string, body: Partial<ProductCategory>): Promise<ProductCategory> =>
    apiClient.patch(`/u-product-categories/${id}`, body),
  remove: (id: string): Promise<void> => apiClient.delete(`/u-product-categories/${id}`),
};

export const imagesApi = {
  uploadUrl: (product_id: string, file: File): Promise<{ uploadUrl: string; blob_key: string }> =>
    apiClient.post('/u-products-upload-url', { product_id, mime: file.type, byte_size: file.size }),
  register: (product_id: string, blob_key: string, sort_order: number): Promise<{ id: string; blob_key: string; sort_order: number }> =>
    apiClient.post('/u-products-image', { product_id, blob_key, sort_order }),
  remove: (id: string): Promise<void> => apiClient.delete(`/u-products-image/${id}`),
};

export async function uploadImage(product_id: string, file: File, sort_order: number) {
  const { uploadUrl, blob_key } = await imagesApi.uploadUrl(product_id, file);
  const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  if (!put.ok) throw new Error(`upload failed: ${put.status}`);
  return imagesApi.register(product_id, blob_key, sort_order);
}
```

If `apiClient` doesn't have `.postFormData`, add it — same shape as `.post` but skip JSON serialization and don't set Content-Type.

- [ ] **Step 3: Permission helpers**

Create `src/modules/products/shared/permissions.ts`:
```ts
type LevelPerms = Record<string, boolean> | null | undefined;

export const canViewProducts        = (p: LevelPerms) => Boolean(p?.['products.catalog.view']);
export const canEditProducts        = (p: LevelPerms) => Boolean(p?.['products.catalog.edit']);
export const canDeleteProducts      = (p: LevelPerms) => Boolean(p?.['products.catalog.delete']);
export const canManageCategories    = (p: LevelPerms) => Boolean(p?.['products.categories.manage']);
```

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add src/modules/products/shared/
git commit -m "feat(products): shared frontend layer — types, api, permissions"
```

---

## Task 17: List page — table, filters, tabs, bulk bar, pagination, polling

**Files:**
- Create: all of `src/modules/products/workspace/components/*` and `ProductsListPage.tsx`
- Modify: `src/lib/router.tsx` (add list route)

This is a single task that creates several small components — keep each file under ~120 lines. Use a TDD-light approach: build the page, manually test, then write a component test or two for the table.

- [ ] **Step 1: Build `ProductStatusTabs.tsx`**

```tsx
import type { ProductStatus, ProductListResponse } from '../../shared/types';

export type StatusFilter = ProductStatus | 'all';

export function ProductStatusTabs(props: {
  active: StatusFilter;
  counts: ProductListResponse['counts'];
  onChange: (s: StatusFilter) => void;
}) {
  const { active, counts, onChange } = props;
  const tab = (key: StatusFilter, label: string, n: number) => (
    <button
      key={key}
      className={`pm-tab ${active === key ? 'pm-tab-active' : ''}`}
      onClick={() => onChange(key)}
    >
      {label} <span className="pm-tab-count">{n}</span>
    </button>
  );
  return (
    <div className="pm-tabs">
      {tab('all',      'All',      counts.all)}
      {tab('active',   'Active',   counts.active)}
      {tab('draft',    'Draft',    counts.draft)}
      {tab('archived', 'Archived', counts.archived)}
    </div>
  );
}
```

- [ ] **Step 2: Build `ProductFiltersBar.tsx`**

```tsx
import type { ProductFilters } from '../../shared/types';
import type { ProductCategory } from '../../shared/types';

export function ProductFiltersBar(props: {
  filters: ProductFilters;
  categories: ProductCategory[];
  canEdit: boolean;
  onChange: (next: Partial<ProductFilters>) => void;
  onExport: () => void;
  onImport: () => void;
  onAdd: () => void;
}) {
  const { filters, categories, canEdit, onChange, onExport, onImport, onAdd } = props;
  return (
    <div className="pm-filters">
      <select value={filters.type ?? ''} onChange={(e) => onChange({ type: (e.target.value || undefined) as any })}>
        <option value="">Type</option>
        <option value="physical">Physical</option>
        <option value="service">Service</option>
      </select>
      <select value={filters.category_id ?? ''} onChange={(e) => onChange({ category_id: e.target.value || undefined })}>
        <option value="">Category</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input
        placeholder="Brand"
        value={filters.brand ?? ''}
        onChange={(e) => onChange({ brand: e.target.value || undefined })}
      />
      <input
        className="pm-search"
        placeholder="🔍 Search name, SKU, brand…"
        value={filters.q ?? ''}
        onChange={(e) => onChange({ q: e.target.value || undefined })}
      />
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button onClick={onExport}>↓ Export</button>
        {canEdit && <button onClick={onImport}>↑ Import</button>}
        {canEdit && <button className="pm-primary" onClick={onAdd}>+ Add Product</button>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build `ProductBulkBar.tsx`**

```tsx
export function ProductBulkBar(props: {
  count: number;
  canDelete: boolean;
  onSetStatus: (s: 'draft' | 'active' | 'archived') => void;
  onSetCategory: () => void;
  onClear: () => void;
}) {
  if (props.count === 0) return null;
  return (
    <div className="pm-bulkbar">
      <b>{props.count} selected</b>
      <button onClick={() => props.onSetStatus('draft')}>Move to Draft</button>
      <button onClick={() => props.onSetStatus('active')}>Move to Active</button>
      <button onClick={props.onSetCategory}>Set Category…</button>
      {props.canDelete && (
        <button className="pm-danger" onClick={() => props.onSetStatus('archived')}>Archive</button>
      )}
      <button className="pm-link" onClick={props.onClear}>Clear</button>
    </div>
  );
}
```

- [ ] **Step 4: Build `ProductTable.tsx` (+row + pager)**

```tsx
import { Link } from 'react-router-dom';
import type { Product } from '../../shared/types';

export function ProductTable(props: {
  items: Product[];
  selected: Set<string>;
  basePath: string;
  canEdit: boolean;
  canDelete: boolean;
  startIndex: number;
  categoriesById: Map<string, string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { items, selected, basePath, canEdit, canDelete, startIndex, categoriesById, onToggleSelect, onToggleAll, onEdit, onDelete } = props;
  const allSelected = items.length > 0 && items.every((p) => selected.has(p.id));
  return (
    <table className="pm-table">
      <thead>
        <tr>
          <th><input type="checkbox" checked={allSelected} onChange={onToggleAll} /></th>
          <th>#</th><th>Image</th><th>Name</th><th>SKU</th><th>Category</th>
          <th>Brand</th><th>Price</th><th>Stock</th><th>Status</th><th>Created</th><th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((p, i) => (
          <tr key={p.id} className={selected.has(p.id) ? 'pm-row-selected' : ''}>
            <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => onToggleSelect(p.id)} /></td>
            <td>{startIndex + i + 1}</td>
            <td>{p.hero_image_key
              ? <img className="pm-thumb" src={`/u-product-image-thumb?key=${encodeURIComponent(p.hero_image_key)}`} alt="" />
              : <div className="pm-thumb pm-thumb-empty" />
            }</td>
            <td>
              <Link to={`${basePath}/${p.id}/edit`}>{p.name}</Link>
              {p.tags.length > 0 && <div className="pm-row-tags">+ {p.tags.length} tags</div>}
              {p.type === 'service' && <div className="pm-row-tags">Service</div>}
            </td>
            <td>{p.sku ?? '—'}</td>
            <td>{p.category_id ? (categoriesById.get(p.category_id) ?? '—') : '—'}</td>
            <td>{p.brand ?? '—'}</td>
            <td>${(p.price_cents / 100).toFixed(2)}{p.type === 'service' && p.unit ? ` /${p.unit}` : ''}</td>
            <td>{p.stock_qty ?? '—'}</td>
            <td><span className={`pm-status pm-status-${p.status}`}>{p.status}</span></td>
            <td className="pm-muted">{p.created_at.slice(0, 10)}</td>
            <td className="pm-ops">
              {canEdit && <button onClick={() => onEdit(p.id)}>✎</button>}
              {canDelete && <button onClick={() => onDelete(p.id)}>🗑</button>}
            </td>
          </tr>
        ))}
        {items.length === 0 && (
          <tr><td colSpan={12} className="pm-empty">No products</td></tr>
        )}
      </tbody>
    </table>
  );
}
```

For `ProductTablePager.tsx`, keep it minimal:

```tsx
export function ProductTablePager(props: { page: number; pageSize: number; total: number; onPage: (n: number) => void }) {
  const { page, pageSize, total, onPage } = props;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pm-pager">
      <div>Showing {from}–{to} of {total}</div>
      <div>
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
        <span> {page} / {pages} </span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build `ProductsListPage.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { productsApi, categoriesApi } from '../../shared/api';
import type { Product, ProductFilters, ProductCategory, ProductListResponse, ProductStatus } from '../../shared/types';
import { canEditProducts, canDeleteProducts, canViewProducts, canManageCategories } from '../../shared/permissions';
import { useAuth } from '../../../../lib/auth-context';
import { ProductStatusTabs, type StatusFilter } from '../components/ProductStatusTabs';
import { ProductFiltersBar } from '../components/ProductFiltersBar';
import { ProductBulkBar } from '../components/ProductBulkBar';
import { ProductTable } from '../components/ProductTable';
import { ProductTablePager } from '../components/ProductTablePager';
import { ProductImportModal } from '../components/ProductImportModal';

const POLL_MS = 5_000;
const PAGE_SIZE = 20;

export default function ProductsListPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { perms } = useAuth(); // assumes auth context exposes level permissions
  const basePath = `/w/${slug}/products`;

  const filters: ProductFilters = useMemo(() => ({
    status: (search.get('status') as StatusFilter) ?? 'all',
    type: (search.get('type') as any) ?? undefined,
    category_id: search.get('category_id') ?? undefined,
    brand: search.get('brand') ?? undefined,
    q: search.get('q') ?? undefined,
    page: Math.max(1, parseInt(search.get('page') ?? '1', 10) || 1),
    page_size: PAGE_SIZE,
  }), [search.toString()]);

  const [data, setData] = useState<ProductListResponse | null>(null);
  const [cats, setCats] = useState<ProductCategory[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const pollRef = useRef<number | null>(null);

  function update(next: Partial<ProductFilters>) {
    const merged = new URLSearchParams(search);
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') merged.delete(k); else merged.set(k, String(v));
    }
    if (!('page' in next)) merged.delete('page');
    setSearch(merged);
  }

  async function load() {
    const [list, c] = await Promise.all([productsApi.list(filters), categoriesApi.list()]);
    setData(list);
    setCats(c.items);
  }
  useEffect(() => {
    let alive = true;
    (async () => { try { if (alive) await load(); } catch (e) { console.error(e); } })();
    pollRef.current = window.setInterval(load, POLL_MS) as unknown as number;
    return () => { alive = false; if (pollRef.current) clearInterval(pollRef.current); };
  }, [filters]);

  if (!canViewProducts(perms)) return <div className="pm-shell">You don't have access to Products.</div>;

  const catsById = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats]);

  async function bulk(action: 'set_status', value: ProductStatus) {
    await productsApi.bulk({ ids: Array.from(selected), action, value } as any);
    setSelected(new Set());
    await load();
  }

  return (
    <div className="pm-shell">
      <div className="pm-header">
        <h1>Product Manager</h1>
        {canManageCategories(perms) && (
          <a className="pm-link" href={`${basePath}/categories`}>Categories →</a>
        )}
      </div>

      <ProductStatusTabs
        active={(filters.status ?? 'all') as StatusFilter}
        counts={data?.counts ?? { all: 0, active: 0, draft: 0, archived: 0 }}
        onChange={(s) => update({ status: s === 'all' ? undefined : s })}
      />

      <ProductFiltersBar
        filters={filters}
        categories={cats}
        canEdit={canEditProducts(perms)}
        onChange={(next) => update(next)}
        onExport={() => { window.location.href = productsApi.exportUrl({ ...filters, format: 'csv' }); }}
        onImport={() => setImportOpen(true)}
        onAdd={() => nav(`${basePath}/new`)}
      />

      <ProductBulkBar
        count={selected.size}
        canDelete={canDeleteProducts(perms)}
        onSetStatus={(s) => bulk('set_status', s)}
        onSetCategory={() => { /* simple prompt UI deferred to Phase B */ }}
        onClear={() => setSelected(new Set())}
      />

      <ProductTable
        items={data?.items ?? []}
        selected={selected}
        basePath={basePath}
        canEdit={canEditProducts(perms)}
        canDelete={canDeleteProducts(perms)}
        startIndex={((data?.page ?? 1) - 1) * (data?.page_size ?? PAGE_SIZE)}
        categoriesById={catsById}
        onToggleSelect={(id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
        onToggleAll={() => setSelected((s) => {
          if (!data) return s;
          const all = data.items.every((p) => s.has(p.id));
          return new Set(all ? [] : data.items.map((p) => p.id));
        })}
        onEdit={(id) => nav(`${basePath}/${id}/edit`)}
        onDelete={async (id) => { if (confirm('Archive this product?')) { await productsApi.remove(id); await load(); } }}
      />

      <ProductTablePager
        page={data?.page ?? 1}
        pageSize={data?.page_size ?? PAGE_SIZE}
        total={data?.total ?? 0}
        onPage={(n) => update({ page: n })}
      />

      <ProductImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => { setImportOpen(false); load(); }}
      />
    </div>
  );
}
```

> If `useAuth().perms` doesn't match — read `src/lib/auth-context.tsx` and use the actual permission accessor. If the workspace permissions are loaded elsewhere, import from that hook instead. **Do not introduce a new permission-loading mechanism.**

- [ ] **Step 6: Add route**

In `src/lib/router.tsx`, add under the workspace branch:
```tsx
{
  path: 'products',
  children: [
    { index: true, lazy: () => import('../modules/products/workspace/pages/ProductsListPage').then((m) => ({ Component: m.default })) },
    { path: 'new', lazy: () => import('../modules/products/workspace/pages/ProductEditPage').then((m) => ({ Component: m.default })) },
    { path: ':productId/edit', lazy: () => import('../modules/products/workspace/pages/ProductEditPage').then((m) => ({ Component: m.default })) },
    { path: 'categories', lazy: () => import('../modules/products/workspace/pages/ProductCategoriesPage').then((m) => ({ Component: m.default })) },
  ],
},
```

- [ ] **Step 7: Manual smoke**

```bash
npm run dev
```
Navigate to `/w/<slug>/products`. Verify status tabs render counts, filters change URL, table renders rows. Tabs/filters/pagination round-trip via URL state.

- [ ] **Step 8: Commit**

```bash
git add src/modules/products/workspace/components/ src/modules/products/workspace/pages/ProductsListPage.tsx src/lib/router.tsx
git commit -m "feat(products): list page (tabs + filters + table + bulk + pager)"
```

---

## Task 18: Edit page — sections + form + image gallery

**Files:**
- Create: `src/modules/products/workspace/components/ProductBasicsSection.tsx`
- Create: `src/modules/products/workspace/components/ProductPricingSection.tsx`
- Create: `src/modules/products/workspace/components/ProductMediaSection.tsx`
- Create: `src/modules/products/workspace/components/ProductImageGallery.tsx`
- Create: `src/modules/products/workspace/components/ProductOrgSection.tsx`
- Create: `src/modules/products/workspace/components/ProductForm.tsx`
- Create: `src/modules/products/workspace/pages/ProductEditPage.tsx`

- [ ] **Step 1: Basics section**

```tsx
import type { ProductType } from '../../shared/types';

export function ProductBasicsSection(props: {
  type: ProductType;
  name: string;
  description: string | null;
  onChange: (patch: Partial<{ type: ProductType; name: string; description: string | null }>) => void;
}) {
  return (
    <div className="pm-section">
      <h3>Basics</h3>
      <label>Type</label>
      <div className="pm-toggle">
        {(['physical', 'service'] as const).map((t) => (
          <button key={t} type="button"
            className={props.type === t ? 'on' : ''}
            onClick={() => props.onChange({ type: t })}>
            {t === 'physical' ? 'Physical' : 'Service'}
          </button>
        ))}
      </div>
      <label>Name *</label>
      <input value={props.name} maxLength={120} onChange={(e) => props.onChange({ name: e.target.value })} />
      <label>Description</label>
      <textarea value={props.description ?? ''} onChange={(e) => props.onChange({ description: e.target.value || null })} />
    </div>
  );
}
```

- [ ] **Step 2: Pricing section (with conditional physical-only block)**

```tsx
import type { ProductType } from '../../shared/types';

export function ProductPricingSection(props: {
  type: ProductType;
  price_cents: number;
  sku: string | null;
  stock_qty: number | null;
  unit: string | null;
  onChange: (patch: Partial<{ price_cents: number; sku: string | null; stock_qty: number | null; unit: string | null }>) => void;
}) {
  const { type, price_cents, sku, stock_qty, unit, onChange } = props;
  return (
    <div className="pm-section">
      <h3>Pricing &amp; Stock</h3>
      <label>Price (USD) *</label>
      <input
        type="number" step="0.01" min="0"
        value={(price_cents / 100).toString()}
        onChange={(e) => onChange({ price_cents: Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)) })}
      />
      {type === 'physical' && (
        <div className="pm-physical-only">
          <label>SKU</label>
          <input value={sku ?? ''} onChange={(e) => onChange({ sku: e.target.value || null })} />
          <label>Stock</label>
          <input type="number" min="0" value={stock_qty ?? 0} onChange={(e) => onChange({ stock_qty: parseInt(e.target.value || '0', 10) })} />
          <label>Unit</label>
          <select value={unit ?? 'each'} onChange={(e) => onChange({ unit: e.target.value })}>
            <option value="each">each</option>
            <option value="kg">kg</option>
            <option value="g">g</option>
            <option value="lb">lb</option>
            <option value="m">m</option>
            <option value="hr">hr</option>
          </select>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Image gallery + media section**

`ProductImageGallery.tsx`:
```tsx
import { useState } from 'react';
import type { ProductImage } from '../../shared/types';
import { imagesApi, uploadImage } from '../../shared/api';

export function ProductImageGallery(props: {
  productId: string;
  images: ProductImage[];
  heroKey: string | null;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      let next = props.images.length;
      for (const f of Array.from(files)) {
        if (next >= 20) break;
        await uploadImage(props.productId, f, next++);
      }
      await props.onChange();
    } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="pm-drop" onDragOver={(e) => e.preventDefault()}
           onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}>
        <input id="pm-file" type="file" multiple accept="image/*" onChange={(e) => onFiles(e.target.files)} hidden />
        <label htmlFor="pm-file">{busy ? 'Uploading…' : 'Drop images here or click to browse'}</label>
      </div>
      <div className="pm-img-row">
        {props.images.map((im) => (
          <div key={im.id} className={`pm-img-tile ${im.blob_key === props.heroKey ? 'is-hero' : ''}`}>
            <img src={`/u-product-image-thumb?key=${encodeURIComponent(im.blob_key)}`} alt="" />
            <button className="pm-img-x" onClick={async () => { await imagesApi.remove(im.id); await props.onChange(); }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

> The `/u-product-image-thumb` endpoint is **not in the spec**. For Phase A, serve image bytes via the existing Netlify Blob public URL pattern (mirror `files-thumbnail.ts` if it exists). If neither is wired up yet, render `<img src={`/.netlify/blobs/product-images/${blob_key}`}` (verify path with `getStore` docs) or punt with a placeholder grey box. **Do not block the rest of the plan on thumbnail rendering.**

`ProductMediaSection.tsx`:
```tsx
import type { ProductImage } from '../../shared/types';
import { ProductImageGallery } from './ProductImageGallery';

export function ProductMediaSection(props: {
  productId: string | null;
  images: ProductImage[];
  heroKey: string | null;
  onChange: () => Promise<void>;
}) {
  return (
    <div className="pm-section">
      <h3>Media</h3>
      {props.productId
        ? <ProductImageGallery productId={props.productId} images={props.images} heroKey={props.heroKey} onChange={props.onChange} />
        : <div className="pm-muted">Save the product first to upload images.</div>}
    </div>
  );
}
```

- [ ] **Step 4: Organization section**

```tsx
import type { ProductCategory, ProductStatus } from '../../shared/types';

export function ProductOrgSection(props: {
  category_id: string | null;
  brand: string | null;
  tags: string[];
  status: ProductStatus;
  categories: ProductCategory[];
  onChange: (patch: Partial<{ category_id: string | null; brand: string | null; tags: string[]; status: ProductStatus }>) => void;
}) {
  return (
    <div className="pm-section">
      <h3>Organization</h3>
      <label>Category *</label>
      <select value={props.category_id ?? ''} onChange={(e) => props.onChange({ category_id: e.target.value || null })}>
        <option value="">— select —</option>
        {props.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label>Brand</label>
      <input value={props.brand ?? ''} onChange={(e) => props.onChange({ brand: e.target.value || null })} />
      <label>Tags (comma separated)</label>
      <input
        value={props.tags.join(', ')}
        onChange={(e) => props.onChange({ tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
      />
      <label>Status</label>
      <select value={props.status} onChange={(e) => props.onChange({ status: e.target.value as ProductStatus })}>
        <option value="draft">Draft</option>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 5: Form + ProductEditPage**

`ProductForm.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { Product, ProductWithImages, ProductCategory, ProductType, ProductStatus } from '../../shared/types';
import { ProductBasicsSection } from './ProductBasicsSection';
import { ProductPricingSection } from './ProductPricingSection';
import { ProductMediaSection } from './ProductMediaSection';
import { ProductOrgSection } from './ProductOrgSection';

export interface ProductDraft extends Omit<Product, 'id' | 'created_at' | 'updated_at' | 'currency' | 'hero_image_key'> {
  hero_image_key: string | null;
}

export const emptyDraft = (): ProductDraft => ({
  type: 'physical',
  name: '',
  description: null,
  category_id: null,
  brand: null,
  tags: [],
  price_cents: 0,
  sku: null,
  stock_qty: 0,
  unit: 'each',
  status: 'draft',
  hero_image_key: null,
});

export function ProductForm(props: {
  draft: ProductDraft;
  loaded: ProductWithImages | null;
  categories: ProductCategory[];
  onChange: (patch: Partial<ProductDraft>) => void;
  onReloadImages: () => Promise<void>;
}) {
  // When type flips to 'service', null out physical-only fields client-side too
  useEffect(() => {
    if (props.draft.type === 'service' && (props.draft.sku || props.draft.stock_qty || props.draft.unit)) {
      props.onChange({ sku: null, stock_qty: null, unit: null });
    }
  }, [props.draft.type]);

  return (
    <div className="pm-form-grid">
      <div>
        <ProductBasicsSection
          type={props.draft.type}
          name={props.draft.name}
          description={props.draft.description}
          onChange={(p) => props.onChange(p)}
        />
        <ProductPricingSection
          type={props.draft.type}
          price_cents={props.draft.price_cents}
          sku={props.draft.sku}
          stock_qty={props.draft.stock_qty}
          unit={props.draft.unit}
          onChange={(p) => props.onChange(p)}
        />
      </div>
      <div>
        <ProductMediaSection
          productId={props.loaded?.id ?? null}
          images={props.loaded?.images ?? []}
          heroKey={props.loaded?.hero_image_key ?? null}
          onChange={props.onReloadImages}
        />
        <ProductOrgSection
          category_id={props.draft.category_id}
          brand={props.draft.brand}
          tags={props.draft.tags}
          status={props.draft.status}
          categories={props.categories}
          onChange={(p) => props.onChange(p)}
        />
      </div>
    </div>
  );
}
```

`ProductEditPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { productsApi, categoriesApi } from '../../shared/api';
import type { ProductCategory, ProductWithImages, ProductStatus } from '../../shared/types';
import { ProductForm, emptyDraft, type ProductDraft } from '../components/ProductForm';

export default function ProductEditPage(props: { mode?: 'create' | 'edit' }) {
  const params = useParams();
  const mode = props.mode ?? (params.productId ? 'edit' : 'create');
  const nav = useNavigate();
  const basePath = `/w/${params.slug}/products`;

  const [draft, setDraft] = useState<ProductDraft>(emptyDraft());
  const [loaded, setLoaded] = useState<ProductWithImages | null>(null);
  const [cats, setCats] = useState<ProductCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reloadProduct() {
    if (!params.productId) return;
    const p = await productsApi.get(params.productId);
    setLoaded(p);
    setDraft({
      type: p.type, name: p.name, description: p.description, category_id: p.category_id,
      brand: p.brand, tags: p.tags, price_cents: p.price_cents,
      sku: p.sku, stock_qty: p.stock_qty, unit: p.unit, status: p.status,
      hero_image_key: p.hero_image_key,
    });
  }

  useEffect(() => {
    categoriesApi.list().then((c) => setCats(c.items));
    if (mode === 'edit') reloadProduct().catch((e) => setError(String(e)));
  }, [mode, params.productId]);

  async function save(targetStatus?: ProductStatus) {
    setSaving(true); setError(null);
    try {
      const payload = { ...draft, ...(targetStatus ? { status: targetStatus } : {}) };
      const saved = mode === 'create'
        ? await productsApi.create(payload as any)
        : await productsApi.update(params.productId!, payload as any);
      if (mode === 'create') nav(`${basePath}/${saved.id}/edit`);
      else { await reloadProduct(); }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setSaving(false); }
  }

  return (
    <div className="pm-shell">
      <div className="pm-edit-header">
        <button onClick={() => nav(basePath)}>← Back</button>
        <h1>{mode === 'create' ? 'New Product' : draft.name || 'Edit Product'}</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button disabled={saving} onClick={() => save('draft')}>Save Draft</button>
          <button className="pm-primary" disabled={saving} onClick={() => save('active')}>Publish</button>
        </div>
      </div>
      {error && <div className="pm-error">{error}</div>}
      <ProductForm
        draft={draft}
        loaded={loaded}
        categories={cats}
        onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
        onReloadImages={reloadProduct}
      />
    </div>
  );
}
```

- [ ] **Step 6: Manual smoke**

```bash
npm run dev
```
Open `/w/<slug>/products/new`, fill, save draft, switch to physical/service and verify SKU/stock vanish, publish, upload an image (if thumb endpoint exists), return to list and confirm row appears.

- [ ] **Step 7: Commit**

```bash
git add src/modules/products/workspace/
git commit -m "feat(products): full-page edit form with media + org sections"
```

---

## Task 19: Categories page

**Files:**
- Create: `src/modules/products/workspace/pages/ProductCategoriesPage.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { categoriesApi } from '../../shared/api';
import type { ProductCategory } from '../../shared/types';
import { useAuth } from '../../../../lib/auth-context';
import { canManageCategories } from '../../shared/permissions';

export default function ProductCategoriesPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { perms } = useAuth();
  const [items, setItems] = useState<ProductCategory[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() { const r = await categoriesApi.list(); setItems(r.items); }
  useEffect(() => { load(); }, []);

  if (!canManageCategories(perms)) {
    return <div className="pm-shell">You don't have access to manage categories.</div>;
  }

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try { await categoriesApi.create(name.trim()); setName(''); await load(); }
    catch (e: any) { alert(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm('Delete this category? Products that reference it will keep working but show no category.')) return;
    await categoriesApi.remove(id); await load();
  }
  async function rename(id: string, current: string) {
    const next = prompt('Rename category:', current);
    if (next == null || next.trim() === current) return;
    await categoriesApi.update(id, { name: next.trim() } as any); await load();
  }

  return (
    <div className="pm-shell">
      <button onClick={() => nav(`/w/${slug}/products`)}>← Back to products</button>
      <h1>Categories</h1>
      <ul className="pm-cat-list">
        {items.map((c) => (
          <li key={c.id}>
            <span>{c.name}</span>
            <button onClick={() => rename(c.id, c.name)}>✎</button>
            <button onClick={() => remove(c.id)}>🗑</button>
          </li>
        ))}
        {items.length === 0 && <li className="pm-muted">No categories yet.</li>}
      </ul>
      <div className="pm-cat-add">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name…" maxLength={80} />
        <button disabled={busy || !name.trim()} onClick={add}>+ Add</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke + commit**

```bash
npm run dev   # navigate to /w/<slug>/products/categories
git add src/modules/products/workspace/pages/ProductCategoriesPage.tsx
git commit -m "feat(products): categories management page"
```

---

## Task 20: Import modal + sidebar entry

**Files:**
- Create: `src/modules/products/workspace/components/ProductImportModal.tsx`
- Modify: workspace sidebar component — add the Product Manager link

- [ ] **Step 1: Import modal**

```tsx
import { useState } from 'react';
import { productsApi } from '../../shared/api';
import type { ImportDryRun } from '../../shared/types';

export function ProductImportModal(props: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<ImportDryRun | null>(null);
  const [busy, setBusy] = useState(false);
  if (!props.open) return null;

  async function runDry(f: File) {
    setBusy(true);
    try { setDryRun(await productsApi.importDryRun(f)); }
    catch (e: any) { alert(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!file) return;
    setBusy(true);
    try { await productsApi.importCommit(file); props.onDone(); }
    catch (e: any) { alert(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  const blocked = (dryRun?.errors.length ?? 0) > 0;

  return (
    <div className="pm-modal-backdrop">
      <div className="pm-modal">
        <div className="pm-modal-header">
          <h3>Import Products</h3>
          <button onClick={props.onClose}>✕</button>
        </div>
        <div className="pm-modal-body">
          <input type="file" accept=".csv,.xlsx" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setDryRun(null); if (f) runDry(f); }} />
          {busy && <p>Validating…</p>}
          {dryRun && (
            <div className="pm-import-result">
              <div className="pm-summary">
                <span>Create: {dryRun.summary.to_create}</span>
                <span>Update: {dryRun.summary.to_update}</span>
                <span className={dryRun.summary.errors > 0 ? 'pm-bad' : ''}>Errors: {dryRun.summary.errors}</span>
                <span>Warnings: {dryRun.summary.warnings}</span>
              </div>
              {dryRun.errors.length > 0 && (
                <ul className="pm-errors">
                  {dryRun.errors.map((e, i) => (
                    <li key={i}>Row {e.row} · <code>{e.field}</code> · {e.message}</li>
                  ))}
                </ul>
              )}
              {dryRun.warnings.length > 0 && (
                <ul className="pm-warnings">
                  {dryRun.warnings.map((w, i) => <li key={i}>Row {w.row} · {w.message}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="pm-modal-footer">
          <button onClick={props.onClose}>Cancel</button>
          <button className="pm-primary" disabled={!dryRun || blocked || busy} onClick={commit}>
            {blocked ? 'Fix errors to apply' : `Apply ${(dryRun?.summary.to_create ?? 0) + (dryRun?.summary.to_update ?? 0)} changes`}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Sidebar entry**

Find the workspace sidebar component:
```bash
grep -rln "My Files\|file-manager\|user-portal" src/modules/user-portal/ src/lib/
```
Open the matching file (likely `src/modules/user-portal/pages/UserHome.tsx` or a dedicated `WorkspaceSidebar.tsx`). Add a link entry after "My Files":
```tsx
{canViewProducts(perms) && (
  <NavLink to={`/w/${slug}/products`} className="ws-nav-item">Product Manager</NavLink>
)}
```
Import `canViewProducts` from `src/modules/products/shared/permissions`.

- [ ] **Step 3: Manual smoke**

Verify:
- Sidebar entry appears for a user with `products.catalog.view` and is hidden otherwise
- Clicking opens the list page
- Import button opens the modal; uploading the valid fixture shows "Create: 3" summary; commit refreshes the list
- Uploading the mixed-errors fixture shows errors + disables apply

- [ ] **Step 4: Commit**

```bash
git add src/modules/products/workspace/components/ProductImportModal.tsx src/modules/user-portal/
git commit -m "feat(products): import modal + sidebar entry"
```

---

## Task 21: Final verification + production migrate

**Files:** none — verification step only.

- [ ] **Step 1: Full test pass**

```bash
npm run typecheck && npm test
```
Expected: green across the board, no new warnings.

- [ ] **Step 2: Verify coverage**

```bash
npm run test -- --coverage
```
Expected: products code ≥ 90% line coverage.

- [ ] **Step 3: Manual e2e**

```bash
npm run dev
```

Walk through (with a level granted all four flags):
1. Create category "Electronics"
2. Create physical product "Headphones" — fill SKU/price/stock, upload image
3. Switch type to service mid-form → verify SKU/stock vanish
4. Publish (draft → active)
5. Return to list → row appears in Active tab with correct count
6. Select two rows → bulk Archive
7. Export CSV → confirm filename + first row matches
8. Import the same CSV — dry-run shows 0 errors, commit creates updates rather than duplicates (SKU upsert)
9. Login as a user without `products.catalog.edit` → confirm sidebar still shows but buttons hidden / disabled

- [ ] **Step 4: Prod migration pre-flight**

```bash
# 1. Echo prod host first
PGURL=$PROD_DATABASE_URL psql "$PGURL" -c "SELECT current_database(), inet_server_addr();"
# 2. Confirm host matches expected prod endpoint, then run migrate
DATABASE_URL=$PROD_DATABASE_URL npm run migrate
# 3. Verify
DATABASE_URL=$PROD_DATABASE_URL psql -c "SELECT version FROM schema_ops_log ORDER BY id DESC LIMIT 5;"
```

- [ ] **Step 5: Netlify deploy verification (read-only checks)**

After the user pushes `feat/product-manager` → `main`:
1. Watch the Netlify deploy log; ensure every new function listed
2. After deploy, probe one new endpoint: `curl -i https://<prod>/u-products` → expect 401 (auth required, function exists)
3. If 404: trigger `netlify api restoreSiteDeploy` per the existing memory rule (see `feedback_netlify_new_function_404.md`)

- [ ] **Step 6: Final commit + branch summary**

If any small fixes emerged in steps 1-5, commit them with a `chore(products): final-pass fixes` message and push the branch.

---

## Self-review (executed inline)

**Spec coverage:**
- §1 overview, §1.1 goals, §1.2 non-goals — informational; design followed throughout.
- §2 architecture — Tasks 5, 16-20.
- §3 schema — Tasks 2, 3, 4.
- §4 permissions — Tasks 5 (manifest), 7-15 (server enforcement), 16 (FE helpers), 17, 19 (UI gates).
- §5.1-5.6 endpoints — Tasks 7-14 cover all rows in the endpoint table.
- §5.7 audit ops — Tasks 7, 9, 12, 14 emit them; Task 15 sweeps the full set.
- §6 UI — Tasks 17 (list), 18 (edit), 19 (categories), 20 (import + sidebar).
- §7 testing — TDD integrated into every server task; coverage check in Task 21.
- §8 edge cases — covered: archive-import (parser), SKU upsert (import), category SET NULL (Task 7), 403 on mid-session perm loss (handled by 401/403 + caller refetch), service+stock import (Task 14), tab counts (Task 8).
- §9 rollout — Task 21.

**No placeholder scan:** no "TBD"/"implement later"; every code block is concrete; permissions, audit ops, file paths all specified.

**Type consistency:** `Product`, `ProductWithImages`, `ProductFilters`, `BulkAction`, `ImportDryRun` are defined in Task 16 and used consistently in Tasks 17-20. Endpoint function names (`u-products`, `u-products-detail`, etc.) match the spec table and `config.path` declarations. Permission flag keys (`products.catalog.view/edit/delete`, `products.categories.manage`) appear identically server-side (Tasks 5, 7-14) and client-side (Task 16).

Issues found and fixed inline:
- Image thumbnail endpoint isn't in the spec. Task 18 notes this and tolerates either a `/u-product-image-thumb` or direct blob URL; not blocking.
- `apiClient.postFormData` may not exist — Task 16 notes to add if missing.
- `useAuth().perms` accessor shape is unverified — Task 17 notes to read `auth-context.tsx` first.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-08-product-manager.md` (21 tasks).

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration via `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in this session via `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?
