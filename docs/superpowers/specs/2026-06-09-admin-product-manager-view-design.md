# Admin View of Client Product Manager — Design

**Date:** 2026-06-09
**Module:** Product Manager (Phase B) + AMS
**Status:** Approved
**Predecessor specs:** `docs/superpowers/specs/2026-06-08-product-manager-design.md`
**Sibling spec:** `docs/superpowers/specs/2026-06-09-product-image-thumbnails-design.md`

---

## Problem

The workspace Product Manager (shipped 2026-06-08) is gated behind bucket-user auth (`/c/:slug/products*`). When an admin logs into a client's admin dashboard (`/clients/:clientId`), there is no way to view or manage that client's product catalog. Admins need this for onboarding support, troubleshooting bad imports, and answering customer questions about catalog state.

## Non-goals

- "View as workspace user" / admin impersonation of bucket users. Out of scope and a different security model.
- A new admin-only catalog (e.g., admin-curated reference products). Admin sees the *client's own* products through the existing tables.
- Cross-client admin views (e.g., "all products across all clients"). Not needed today.
- Discovery surfaces beyond the sidebar (AccessDashboard tile, breadcrumbs, etc.) — user chose sidebar-only for now.
- Audit-op renaming. Admin actions already log via the existing audit helper with admin actor identity; no schema change.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope mechanism | `useProductsScope()` hook with two providers (workspace, admin) | Centralizes the workspace-vs-admin difference into one context; pages stay shell-agnostic. |
| API client change | Every method accepts optional `{ clientId }`; appended as `?client=<id>` when set | Backend `resolveClientId` already requires `?client=` for admin; explicit threading is grep-able and testable. No global mutable state. |
| Component reuse | Pages stay in `workspace/`; admin wrappers compose them with `<AdminProductsScopeProvider>` | Single source of truth for pages; admin entry is a 15-line file per route. |
| Permissions model | Admin scope returns `levelNumber=1` (synthesized) | Existing client-side gates (`canViewProducts`, etc.) already bypass for `levelNumber === 1`. No new helpers needed. |
| Routes | New `/clients/:clientId/products*` group under `RequireAdmin` | Mirrors workspace route shape; admin tenancy from URL. |
| Admin sidebar | Single "Product Manager" link in the `inClient` branch of `ams/components/Sidebar.tsx` | Smallest discoverable surface for Phase B. AccessDashboard tile deferred. |
| Capability scope | Full parity — read + write + import + bulk | Admin already passes every server-side permission check; UI exposing less would be cosmetic. |
| Backend changes | None | `requirePermission` already accepts admin sessions; `resolveClientId` already accepts `?client=`; every `u-products*` endpoint already routes through these helpers. |

## Architecture

```
Workspace shell                          Admin shell
─────────────────                        ──────────────
/c/:slug/products                        /clients/:clientId/products
        │                                        │
        ▼                                        ▼
<WorkspaceProductsScopeProvider>         <AdminProductsScopeProvider>
   useUserAuth() → {                        useAuth() + useParams() → {
     clientId: client.id,                     clientId: params.clientId,
     levelNumber: user.level_number,          levelNumber: 1,
     queryParam: undefined,                   queryParam: clientId,
     mode: 'workspace',                       mode: 'admin',
   }                                         }
        │                                        │
        └──────► <ProductsListPage> + children ◄──────┘
                    reads useProductsScope()
                    calls productsApi.list(filters, { clientId: scope.queryParam })
                          │
                          ▼
                   /api/u-products[?client=<id>]
                          │
                          ▼
                   authenticateForPermission (admin OR bucket-user)
                   resolveClientId (admin→param, BU→JWT)
```

## Files

### New

| Path | Purpose | LOC |
|---|---|---|
| `src/modules/products/shared/scope.tsx` | `ProductsScope` context + `useProductsScope()` + `<WorkspaceProductsScopeProvider>` + `<AdminProductsScopeProvider>` | ~80 |
| `src/modules/products/admin/AdminProductsListPage.tsx` | Wraps `ProductsListPage` in `<AdminProductsScopeProvider>` | ~15 |
| `src/modules/products/admin/AdminProductEditPage.tsx` | Same shape for `ProductEditPage` | ~15 |
| `src/modules/products/admin/AdminProductCategoriesPage.tsx` | Same for `ProductCategoriesPage` | ~15 |
| `tests/unit/products-scope.test.tsx` | Hook + provider unit tests | ~80 |
| `tests/integration/u-products-admin-view.test.ts` | Admin-session API integration tests (or extend existing `u-products.test.ts`) | ~150 |

### Modified

| Path | Change |
|---|---|
| `src/modules/products/shared/api.ts` | Every method gains optional `opts?: { clientId?: string }`. URL builder merges `?client=<id>` into existing query string. `formFetch`/`jsonFetch` unchanged. |
| `src/modules/products/workspace/pages/ProductsListPage.tsx` | Replace direct `useUserAuth()` reads of `permissions` and `user.level_number` with `useProductsScope()`. All `productsApi.*` and `categoriesApi.*` calls pass `{ clientId: scope.queryParam }`. |
| `src/modules/products/workspace/pages/ProductEditPage.tsx` | Same swap. `imagesApi.upload/remove` calls pick up `{ clientId }`. |
| `src/modules/products/workspace/pages/ProductCategoriesPage.tsx` | Same swap for `categoriesApi.*`. |
| `src/modules/products/workspace/components/ProductTable.tsx` | If component reads auth for gating, swap to `useProductsScope()`. |
| `src/modules/products/workspace/components/ProductBulkBar.tsx` | Same; bulk call passes `{ clientId }`. |
| `src/modules/products/workspace/components/ProductFilters.tsx` | If it reads scope at all. |
| `src/modules/products/workspace/components/ProductImageGallery.tsx` | `imagesApi.upload/remove` passes `{ clientId }`. |
| `src/modules/products/workspace/components/ProductImportModal.tsx` | `productsApi.importDryRun/importCommit` passes `{ clientId }`. |
| `src/lib/router.tsx` | Wrap workspace product routes with `<WorkspaceProductsScopeProvider>`. Add admin routes under `RequireAdmin`: `/clients/:clientId/products`, `/clients/:clientId/products/new`, `/clients/:clientId/products/:productId/edit`, `/clients/:clientId/products/categories` — each pointing to its `Admin*Page` wrapper. |
| `src/modules/ams/components/Sidebar.tsx` | Inside `inClient` branch, add `<NavLink to={`/clients/${params.clientId}/products`}>Product Manager</NavLink>` after Dashboard, before Audit. |

## Scope hook contract

```ts
export interface ProductsScope {
  clientId: string;                  // for display/form defaults
  levelNumber: number | null;        // drives canViewProducts() and siblings
  queryParam: string | undefined;    // appended as ?client=<id> when admin
  mode: 'workspace' | 'admin';
}

export function useProductsScope(): ProductsScope;  // throws outside provider
export function WorkspaceProductsScopeProvider({ children }: { children: ReactNode }): JSX.Element;
export function AdminProductsScopeProvider({ children }: { children: ReactNode }): JSX.Element;
```

| Field | Workspace value | Admin value |
|---|---|---|
| `clientId` | `client.id` from `useUserAuth` | `params.clientId` from URL |
| `levelNumber` | `user.level_number` (may be null = L1 owner) | `1` synthesized |
| `queryParam` | `undefined` | the URL `clientId` |
| `mode` | `'workspace'` | `'admin'` |

## API client contract change

```ts
// Before
productsApi.list(filters)
productsApi.bulk(body)
imagesApi.upload(productId, file)

// After
productsApi.list(filters, { clientId: scope.queryParam })
productsApi.bulk(body, { clientId: scope.queryParam })
imagesApi.upload(productId, file, sort_order, { clientId: scope.queryParam })
```

When `clientId` is undefined → URL unchanged (workspace). When set → `?client=<id>` appended, merged with any existing query string.

Methods affected: `productsApi.list, get, create, update, remove, bulk, exportUrl, importDryRun, importCommit`; `categoriesApi.list, create, update, remove`; `imagesApi.upload, remove, thumbUrl` (the last added by the sibling thumbnails spec).

## Data flow

**Happy path (admin views Acme's products):**
1. Admin clicks `Clients → Acme Co.` → `/clients/<acmeId>` (AccessDashboard).
2. Admin clicks "Product Manager" → `/clients/<acmeId>/products`.
3. `<RequireAdmin>` gate passes (admin session present).
4. `<AdminProductsScopeProvider>` mounts; reads `clientId` from URL params, yields `{ clientId, levelNumber: 1, queryParam: clientId, mode: 'admin' }`.
5. `ProductsListPage` mounts; calls `productsApi.list(filters, { clientId: '<acmeId>' })`.
6. `GET /api/u-products?client=<acmeId>&...` — admin session + `resolveClientId` returns `{ clientId: '<acmeId>' }`, list returns Acme's products.
7. Render. Mutating actions identical.

## Error handling & edge cases

| Case | Behavior |
|---|---|
| Admin opens `/clients/<unknownId>/products` | Backend returns empty list. Page shows "No products yet" state — same UX as a new empty client. No special error. |
| Admin session expires mid-edit | `productsApi` throws `ProductsApiError(401, ...)`. No silent retry. User redirected to `/login?next=...` on next navigation guard. Acceptable for Phase B. |
| Bucket-user navigates to `/clients/<id>/products` | `RequireAdmin` redirects to `/login?next=...`. |
| Admin sends `?client=` while in workspace mode (URL-tampering) | Workspace pages read scope from context, not URL; the URL param is ignored. |
| `useProductsScope()` called outside a provider | Throws `Error('useProductsScope outside provider')`. Caught at dev time. |
| Two browser tabs (admin in client A, BU in client B) | Each tab has independent scope provider; no cross-talk. |
| Admin reloads `/clients/<id>/products` | URL is source of truth — scope reconstructs identically. |
| Workspace API call site missed the scope thread-through | Works in workspace (queryParam undefined → URL unchanged). Fails in admin (`400 missing_client`). Mitigation: implementer greps `productsApi\.|categoriesApi\.|imagesApi\.` and verifies every site receives `{ clientId }`. |

## Tenant isolation

- Existing tenant gate (`resolveClientId` rejects bucket-user `?client=` mismatching JWT) unaffected. Workspace users still cannot escalate to other clients by URL fiddling.
- Admin tenancy is URL-driven, consistent with every other admin client-scoped surface (audit log, access levels, configure).
- No new auth path; no new audit op; admin actions log with admin actor identity via existing `logAudit` helper.

## Testing

### Unit (`tests/unit/products-scope.test.tsx`)

- `useProductsScope()` outside any provider → throws.
- `<WorkspaceProductsScopeProvider>` with mocked `useUserAuth` → returns workspace scope shape.
- `<AdminProductsScopeProvider>` at `/clients/abc-123/products` with mocked `useAuth` → returns admin scope shape with `queryParam='abc-123'` and `levelNumber=1`.
- `productsApi.list({status:'active'}, {clientId:'xyz'})` URL contains `client=xyz&status=active` (param merging correct).
- `imagesApi.upload(...)` with `{clientId:'xyz'}` POSTs to `/api/u-products-image?client=xyz`.
- `productsApi.list(filters)` with no opts → URL has no `client=` param.

### Integration (`tests/integration/u-products-admin-view.test.ts`)

| Test | Setup | Assert |
|---|---|---|
| Admin GET `/api/u-products?client=A` returns A's products | Seed 3 under A, 2 under B; admin session | 200, items.length=3, all `client_id==A` |
| Admin without `?client=` returns `400 missing_client` | Admin session, no query | `400` |
| Admin POST `/api/u-products?client=A` creates under A | Admin + body | 201, row's `client_id==A` |
| Admin POST `/api/u-products-image?client=A` writes to A's blob namespace | Admin + multipart | 201, `blob_key` starts with `product-images/<A>/` |
| Admin PATCH `/api/u-products/<id>?client=A` updates and audits as admin | Admin + body | 200, audit row populated with admin actor (not user_node_id) |
| Bucket-user with `?client=<other>` returns 403 forbidden_cross_client | BU session for A, `?client=B` | `403` — unchanged from current behavior, regression guard |

Skip duplicates if already present in `tests/integration/u-products.test.ts`.

### Manual FE smoke

- Admin: open `/clients/<id>` → click "Product Manager" → list shows.
- Create a product → appears in list, scoped to right client.
- Cross-check: bucket-user (incognito) sees the same product in workspace.
- Upload image → renders (placeholder until thumbnails spec ships).
- Bulk-archive → status flips, audit shows admin actor.
- Categories CRUD works.
- CSV import dry-run + commit works.
- Switch `/clients/<other>/products` → list reflects new client only.

## Risks & follow-ups

- **API call site coverage** is the single highest-risk class of bug. Plan must include a grep gate. Missing a call site silently breaks admin mode only.
- **Refresh on session expiry** — admin sessions can expire mid-edit. No special handling for now; same posture as the rest of admin UI.
- **AccessDashboard tile** (deferred) — easy follow-up if discoverability becomes an issue.
- **Admin audit grouping** — admin actions on products are logged under `products.*` ops with admin actor. If a product audit view is later added to the workspace, decide whether admin-actor rows are visible to workspace users (probably yes, with a "by ExSol Admin" label).

## Plan reference

Implementation plan to be written at `docs/superpowers/plans/2026-06-09-admin-product-manager-view.md` by the `superpowers:writing-plans` skill.
