# Product Manager Module — Design Spec

**Date:** 2026-06-08
**Status:** Approved (pending user review of this document)
**Author:** Claude + Faraaz
**Phase:** A (workspace-facing vertical slice)

---

## 1. Overview

A workspace-facing module that lets bucket users CRUD a catalog of the products and services their business sells. The module appears as **"Product Manager"** in the workspace sidebar. It supports a mixed catalog (physical goods + services), managed categories, image galleries, bulk operations, and CSV/XLSX import/export.

Phase A delivers a complete vertical slice — schema, endpoints, UI, permissions, audit, tests — production-ready. Phase B (admin-side read view, variants, low-stock alerts, etc.) is a separate future spec.

### 1.1 Goals

- Workspace users can list, search, filter, create, edit, archive, and delete products
- Mixed catalog: each product is `type=physical` or `type=service`; physical-only fields (SKU, stock, unit) are conditional
- A managed category list, gated behind a separate permission flag
- Image gallery per product with a designated hero image
- Bulk operations: status change, category change, archive
- CSV/XLSX import (dry-run + commit) and export (filter-aware)
- Full audit trail of all mutations

### 1.2 Non-goals (out of scope)

- Variants (size/color matrices)
- Multi-currency per product
- Inventory adjustments / stock movement history
- Public-facing storefront pages
- Pricing tiers (B2B price lists)
- Admin-side catalog browsing across clients (deferred to Phase B)
- AMS-level integration (no per-node product visibility — flat per-workspace catalog)

---

## 2. Architecture

### 2.1 Module structure

`src/modules/products/` mirroring the existing `src/modules/files/` shape:

```
src/modules/products/
├── shared/
│   ├── api.ts            # Fetch wrappers for u-products* endpoints
│   ├── types.ts          # Product, ProductCategory, ProductImage TypeScript types
│   └── permissions.ts    # canViewProducts / canEditProducts / canDeleteProducts / canManageCategories
├── workspace/
│   ├── pages/
│   │   ├── ProductsListPage.tsx
│   │   ├── ProductEditPage.tsx          # mode: 'create' | 'edit'
│   │   └── ProductCategoriesPage.tsx
│   └── components/
│       ├── ProductStatusTabs.tsx
│       ├── ProductFiltersBar.tsx
│       ├── ProductBulkBar.tsx
│       ├── ProductTable.tsx
│       ├── ProductTableRow.tsx
│       ├── ProductTablePager.tsx
│       ├── ProductForm.tsx
│       ├── ProductBasicsSection.tsx
│       ├── ProductPricingSection.tsx
│       ├── ProductMediaSection.tsx
│       ├── ProductOrgSection.tsx
│       ├── ProductImageGallery.tsx
│       └── ProductImportModal.tsx
└── admin/                # Phase B — placeholder only this phase
```

### 2.2 Routing

Added under the workspace router (`/w/:slug/*`):

```ts
{
  path: '/w/:slug/products',
  children: [
    { index: true,                    element: <ProductsListPage/> },
    { path: 'new',                    element: <ProductEditPage mode="create"/> },
    { path: ':productId/edit',        element: <ProductEditPage mode="edit"/> },
    { path: 'categories',             element: <ProductCategoriesPage/> },
  ]
}
```

### 2.3 Sidebar entry

"Product Manager" link visible to any workspace user whose level grants `products.products.view`. Placed in the sidebar after "My Files".

### 2.4 Reused infrastructure

- **Auth:** bucket-user JWT, same flow as `u-me` / `u-login`
- **Image storage:** Netlify Blobs, **new `product-images` store** parallel to the file-manager store; never co-mingled
- **Polling:** 5-second poll on the list page, matching the Files module
- **Audit:** entries written to the existing `audit_log` table
- **Bulk pattern:** payload shape mirrors `user-nodes-bulk` (proven in production)
- **Import pattern:** dry-run → commit two-step mirroring `onboard-client-bulk`

---

## 3. Data model

Three migrations, numbered after the current `032_file_audience.sql`.

### 3.1 Migration 033 — `product_categories`

```sql
CREATE TABLE public.product_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE UNIQUE INDEX product_categories_client_name_uniq
  ON public.product_categories (client_id, name) WHERE deleted_at IS NULL;
CREATE INDEX product_categories_client_idx
  ON public.product_categories (client_id) WHERE deleted_at IS NULL;
```

### 3.2 Migration 034 — `products`

```sql
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
CREATE INDEX products_search_idx
  ON public.products USING gin (
    to_tsvector('simple', name || ' ' || coalesce(brand, '') || ' ' || coalesce(sku, ''))
  );
```

### 3.3 Migration 035 — `product_images`

```sql
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

### 3.4 Design notes

- `price_cents int` (not `numeric`) — avoids float drift, matches Stripe convention used elsewhere.
- Soft delete via `deleted_at` matches `files`, `user_nodes`.
- `tags text[]` keeps tags inline; filterable via `@>` operator without a join table.
- GIN full-text index on `name + brand + sku` powers the search box.
- `hero_image_key` is denormalized for the list-page thumbnail; gallery is a separate table so re-ordering doesn't bump the product `updated_at`.
- Category FK uses `ON DELETE SET NULL` — archiving a category does not break products.
- Type-discriminator pattern (STI) is intentional: two types share ~80% of columns, the CHECK constraint enforces invariants at the DB layer. If a third type with very different fields appears, revisit.

---

## 4. Permissions

The existing `<module>.<bucket>.<verb>` system gives us four flags naturally — the `products` module uses the existing `products` data bucket and the four standard verbs (`view`, `create`, `edit`, `delete`). Flags live in the `client_levels.permissions` JSONB (migration 021), sparse-map convention; missing key = false.

| Flag | Grants |
|---|---|
| `products.products.view` | See sidebar entry + list page + individual products + categories list |
| `products.products.create` | Add new products; add new categories; auto-create categories on import |
| `products.products.edit` | Modify existing products; rename categories; upload/delete images |
| `products.products.delete` | Archive products (soft delete) + delete categories |

**Notes:**

- `view` is NOT implicit — must be granted. (Decision from brainstorming.)
- Category management is folded into the same four flags rather than a separate `categories.manage`, because the existing type system has a fixed verb set (`view`/`create`/`edit`/`delete`) and a fixed bucket set. Conceptually: categories are part of the products module's domain, gated by the same verbs.
- Publish (changing status to `active`) is part of `.edit`, not a separate flag.
- A user with `.delete` but not `.edit` can archive existing products and delete categories but not modify either — matches AMS `role.delete` pattern.
- Server enforces all gates; UI affordances are convenience only.
- A "lead" person responsible for the catalog holds all four flags; the matrix in the Access Levels UI exposes them like any other module permissions.

The Module manifest (`src/modules/registry/manifests/products.ts`) registers the module so the access-levels UI surfaces the four flags automatically (one row per verb in the `products` data bucket).

---

## 5. API endpoints

All endpoints under `netlify/functions/` and use the bucket-user JWT (`u-` prefix).

### 5.1 Endpoint table

| File | Method | Path | Purpose | Flag |
|---|---|---|---|---|
| `u-products.ts` | GET | `/u-products` | List w/ filters, search, paging | `products.products.view` |
| `u-products.ts` | POST | `/u-products` | Create | `products.products.create` |
| `u-products-detail.ts` | GET | `/u-products/:id` | Fetch one (with images + category) | `products.products.view` |
| `u-products-detail.ts` | PATCH | `/u-products/:id` | Update | `products.products.edit` |
| `u-products-detail.ts` | DELETE | `/u-products/:id` | Soft-delete | `products.products.delete` |
| `u-products-bulk.ts` | POST | `/u-products-bulk` | Bulk actions | depends on action (see §5.3) |
| `u-products-upload-url.ts` | POST | `/u-products-upload-url` | Issue presigned blob URL | `products.products.edit` |
| `u-products-image.ts` | POST | `/u-products-image` | Register uploaded blob as image | `products.products.edit` |
| `u-products-image.ts` | DELETE | `/u-products-image/:id` | Remove image | `products.products.edit` |
| `u-product-categories.ts` | GET | `/u-product-categories` | List | `products.products.view` |
| `u-product-categories.ts` | POST | `/u-product-categories` | Create | `products.products.create` |
| `u-product-categories.ts` | PATCH | `/u-product-categories/:id` | Update | `products.products.edit` |
| `u-product-categories.ts` | DELETE | `/u-product-categories/:id` | Soft-delete | `products.products.delete` |
| `u-products-export.ts` | GET | `/u-products-export` | CSV/XLSX download | `products.products.view` |
| `u-products-import.ts` | POST | `/u-products-import` | Dry-run + commit import | `products.products.create` for new rows + `.edit` for updates; auto-create cats requires `.create` |

### 5.2 List query (`GET /u-products`)

```
?status=active|draft|archived|all     (default: all)
&type=physical|service
&category_id=<uuid>
&brand=<string>
&q=<search>                            matches name, SKU, brand
&tag=<tag>                             repeatable
&page=1
&page_size=20                          max 100
&sort=created_at|name|price_cents      default: created_at
&order=asc|desc                        default: desc
```

Response:

```json
{
  "items": [Product],
  "total": 42,
  "page": 1,
  "page_size": 20,
  "counts": { "all": 42, "active": 38, "draft": 3, "archived": 1 }
}
```

Counts always reflect the **base filter set** (Type/Category/Brand/search) but ignore the `status` filter — so the tab badges show how many would be available if a user switched tabs. This matches Shopify's behavior.

### 5.3 Bulk endpoint (`POST /u-products-bulk`)

Same shape as the existing `user-nodes-bulk`:

```json
{ "ids": ["uuid", ...], "action": "set_status",   "value": "archived" }
{ "ids": ["uuid", ...], "action": "set_category", "category_id": "uuid" }
{ "ids": ["uuid", ...], "action": "delete" }
```

Response shape (partial-success):

```json
{
  "ok": ["uuid", "uuid"],
  "errors": [{ "id": "uuid", "code": "not_found" }, { "id": "uuid", "code": "forbidden" }]
}
```

### 5.4 Image upload flow

Three steps to stay under the 6 MB Netlify Function body limit:

1. `POST /u-products-upload-url` → `{ uploadUrl, blob_key, expires_at }`
2. Client `PUT`s image bytes directly to `uploadUrl`
3. `POST /u-products-image` `{ product_id, blob_key, sort_order }` to register

Server validates blob exists, MIME type (`image/jpeg|png|webp|gif`), and size (≤ 10 MB per image, ≤ 20 images per product) before inserting the row. Orphaned blobs (uploaded but never registered) are cleaned up by a weekly garbage job — out of scope for Phase A; tracked as a follow-up ticket.

### 5.5 Export (`GET /u-products-export`)

Query string identical to `/u-products` (without paging). Format selected by `?format=csv|xlsx` (default `csv`). Response streams the file with `Content-Disposition: attachment; filename=products_<slug>_<YYYY-MM-DD>.<ext>`.

Columns: `sku, name, type, category, brand, price, currency, stock_qty, unit, status, tags, description, created_at, hero_image_filename`. Image URLs are NOT exported (they would break across workspaces); the filename column is a marker only.

### 5.6 Import (`POST /u-products-import`)

`Content-Type: multipart/form-data` with `file` (CSV or XLSX) and optional `abort_on_error: boolean` (default `true`).

`?dry_run=true` runs validation without writing:

```json
{
  "valid": [
    { "row": 2, "name": "USB-C Hub", "action": "create" },
    { "row": 3, "name": "Repair Service", "action": "update", "id": "uuid" }
  ],
  "errors": [
    { "row": 5, "field": "price", "message": "must be numeric" },
    { "row": 8, "field": "type",  "message": "service rows cannot have stock_qty" }
  ],
  "warnings": [
    { "row": 7, "message": "category 'Gadgets' will be auto-created" }
  ],
  "summary": { "to_create": 12, "to_update": 3, "errors": 1, "warnings": 1 }
}
```

Commit (no `dry_run`) returns the same shape plus `committed: true` and IDs of created/updated rows. All writes run inside a single transaction.

**Import rules:**

- SKU is the upsert key for physical products: matches on `(client_id, sku)` if `sku` provided.
- Services match on `(client_id, name, type)` when no SKU.
- Category lookup by name. Missing categories: warning + auto-create iff caller has `products.products.create`; otherwise hard error.
- Tags: semicolon-separated within one cell (e.g., `"electronics;wireless;new"`).
- Status defaults to `draft` if column blank.
- Archived rows: skipped with warning, never silently re-activated.

### 5.7 Audit log ops

Added to the existing `audit_log` table (no schema change):

- `products.created`
- `products.updated`
- `products.archived`
- `products.deleted`
- `products.status_changed`
- `products.category_changed`
- `products.imported` (batch row with counts in `meta`)
- `product_categories.created`
- `product_categories.updated`
- `product_categories.deleted`

Each row carries `actor_user_node_id`, `client_id`, `entity_id`, and a JSON `meta` payload.

---

## 6. UI specification

### 6.1 List page (`/w/:slug/products`)

Header row: page title + breadcrumb. Link to "Categories →" if `products.products.create` granted.

**Status tabs:** All · Active · Draft · Archived — with live counts.

**Filter bar:**
```
[Type ▾] [Category ▾] [Brand ▾]   [🔍 Search name, SKU, brand, tags…]   [↓ Export] [↑ Import] [+ Add Product]
```

Buttons hidden/disabled per permission flags. `+ Add Product` navigates to `/products/new`.

**Bulk-action bar** (renders only when `selectedIds.size > 0`, above the filter bar):
```
[2 selected]  [Move to Draft] [Move to Active] [Set Category…] [Archive]   Clear
```

**Table columns:**

| # | Image | Name (+tags) | SKU | Category | Brand | Price | Stock | Status | Created | Ops (✎ 🗑) |

- S.no resets per page.
- Service rows show `—` for SKU and Stock; price shown as `$80.00 /hr` (unit suffix).
- Header checkbox selects the current page.
- `🗑` is hidden if user lacks `products.products.delete`.

**Pagination:** classic Prev / 1 / 2 / 3 / Next with "Showing X–Y of Z" on the left. Page size selector (20 / 50 / 100).

**Polling:** 5-second refetch with stale-while-revalidate; pauses while bulk bar is open.

**Empty states:**

- Zero products: friendly empty card with both `+ Add Product` and `↑ Import` actions.
- Zero categories: an inline note links to the Categories settings page.

### 6.2 Add/Edit page (`/w/:slug/products/new` and `/products/:id/edit`)

Full-page two-column form, sticky header with `← Back`, `Save Draft`, `Publish`.

**Left column:**
- **Basics** card: Type toggle (Physical / Service), Name, Description
- **Pricing & Stock** card: Price (USD), and — only when Type=Physical — SKU, Stock, Unit

**Right column:**
- **Media** card: drag-and-drop zone, image tiles, click a tile to designate hero, drag to reorder, ✕ to delete. Max 20 images, ≤ 10 MB each.
- **Organization** card: Category (dropdown), Brand, Tags (chip input, press Enter), Status (Active / Draft / Archived)

**Validation (client + server):**

- Name required, 1–120 chars
- Price required, parsed to cents, ≥ 0
- Category required (a guard prompts to create a category first if zero exist)
- SKU optional but unique per workspace when provided — debounced async check via `HEAD /u-products?sku=...`
- Service products cannot submit with SKU/Stock/Unit values

**Dirty state:** Save buttons disabled while in-flight; on success → toast + return to list. On 422 → inline field errors. On 403 → re-fetch `u-me` and redirect.

### 6.3 Categories page (`/w/:slug/products/categories`)

Visible only with `products.products.create`.

- List of categories with drag-to-reorder (updates `sort_order`)
- Inline "Add category" input at bottom
- Per-row ✎ to rename, 🗑 to soft-delete
- Deleting a category warns about products that reference it (count); deletion proceeds, FK is `SET NULL`

### 6.4 Import modal

Triggered from the topbar. Steps:

1. Drag CSV/XLSX into a drop zone, or click to browse
2. Server runs dry-run; modal shows a table:
   - Valid rows (collapsed, expandable)
   - Errors (highlighted, with row number + field + message)
   - Warnings (e.g., "Category 'Gadgets' will be auto-created")
   - Summary counts
3. If errors and `abort_on_error` enabled, "Apply N changes" button disabled with reason
4. Apply → commit endpoint → success toast → list refetched

### 6.5 Component state

- **List page:** local `useState` for filters/selection + `useProductsQuery({filters, page})` hook calling `GET /u-products`. Polls every 5s. Counts come back in the same response — no extra request.
- **Edit page:** local form state, controlled inputs. PATCH diff. Images upload optimistically (thumbnail immediately, retry on failure).
- **No global store needed.** Filter state mirrors to URL query string so deep-links work (`/products?status=draft&type=physical`).

---

## 7. Testing

### 7.1 Integration tests (`tests/integration/products/`)

- `products-crud.test.ts` — create/read/update/archive happy paths per type
- `products-permissions.test.ts` — every flag gate, 403 paths
- `products-filters.test.ts` — status, type, category, brand, search, tags combinations
- `products-bulk.test.ts` — every action; partial-success shape
- `products-import.test.ts` — dry-run + commit, every error case, category auto-create, SKU upsert
- `products-export.test.ts` — CSV/XLSX, filter preservation, encoding (non-ASCII names)
- `product-categories.test.ts` — CRUD, name uniqueness, FK-on-delete behavior
- `products-images.test.ts` — upload URL, register, delete, reorder, max-20 enforcement
- `products-audit.test.ts` — audit rows emitted for every mutation

### 7.2 Unit tests

- `permissions.ts` helpers — truth table per flag
- Price/cents conversion — decimals, negatives, locale variants
- CSV/XLSX row parser — golden fixtures in `tests/fixtures/products/`
- Type discriminator validation — service can't have SKU at submit time

### 7.3 Component tests (Vitest + RTL)

- `ProductTable` — selection state, S.no across pages, type=service rendering
- `ProductForm` — type-switch hides physical fields, validation messages
- `ProductImportModal` — dry-run → commit flow, error highlighting

### 7.4 E2E smoke (manual)

Create physical → image upload → publish → bulk archive → export → import roundtrip.

### 7.5 Coverage target

- New code ≥ 90% line coverage
- All endpoint paths exercised in integration tests
- No reduction in repo-wide coverage

---

## 8. Edge cases & decisions

| Case | Decision |
|---|---|
| Archived product import row | Skipped with warning; never silently re-activated |
| SKU collision on import | Upsert that product; surfaced as `action: "update"` in dry-run |
| Category deleted while referenced | `ON DELETE SET NULL`; products show "(no category)" until reassigned |
| User loses `products.products.edit` mid-session | Next mutation returns 403; UI re-fetches `u-me` and updates affordances |
| Image upload succeeds but register fails | Orphan blob; cleaned by weekly GC job (follow-up ticket) |
| Concurrent edit (two users) | Last-write-wins; audit log gives the trail. Optimistic lock deferred. |
| Service product with `stock_qty` in CSV | Dry-run error: "Services cannot have stock_qty" |
| `products.products.delete` without `.edit` | Allowed (archive existing, can't modify) — matches AMS `role.delete` pattern |
| Tab counts when filtering | Reflect base filter set (Type/Category/Brand/search), not active tab. Matches Shopify. |
| Currency column in import | Phase A locks currency to `USD`. Non-`USD` values in the import file produce a row-level error. The `currency` DB column exists for forward-compatibility (Phase B multi-currency). |
| `category_id` of a soft-deleted category | Treated as "(no category)" in UI; cannot select on edit |

---

## 9. Rollout plan

**Phase A (this spec, single PR or short sequence):**

1. Migrations 033 / 034 / 035 (dev → prod with pre-promote check per CLAUDE.md memory)
2. Module manifest (registry) entry for the four permission flags
3. Endpoints: list/CRUD/bulk/categories/images/import/export
4. Workspace UI: list page, edit page, categories page, import modal
5. Permission helpers + sidebar entry gated by `products.products.view`
6. Audit log integration
7. Full test suite
8. Local end-to-end verification
9. Merge to `main` (push triggers Netlify production deploy per repo policy)

**Phase B (future, separate spec):**

- Admin read-only view (`src/modules/products/admin/`)
- Product variants (size/color)
- Low-stock alerts and inventory adjustments log
- Per-product currency override
- Public-facing storefront integration

---

## 10. Open questions

None at this time. All clarifying decisions captured above. The "lead product manager" concept is realized as the user(s) holding all four `products.*` flags via the existing Access Levels permission matrix — no separate role construct needed.

---

## 11. Related documents

- `docs/superpowers/specs/2026-06-01-access-levels-design.md` — permission matrix surface
- `docs/superpowers/specs/2026-06-04-file-manager-design.md` — image-upload + module-structure pattern
- `docs/superpowers/specs/2026-06-04-bulk-operations-design.md` — bulk endpoint shape
- `docs/superpowers/specs/2026-06-04-onboarding-import-design.md` — dry-run / commit import pattern
- `docs/superpowers/specs/2026-06-04-audit-log-design.md` — audit log schema and conventions
