# Admin View of Client Product Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins view + manage a client's product catalog from `/clients/:clientId/products`. Reuses the existing workspace Product Manager pages by abstracting their auth/scope into a `useProductsScope()` hook with two providers (workspace, admin).

**Architecture:** Pure FE shell change. New `ProductsScope` context with `WorkspaceProductsScopeProvider` (delegates to `useUserAuth`) and `AdminProductsScopeProvider` (delegates to `useAuth` + URL `clientId` param + synthesized owner-level perms). The 3 workspace page files swap their direct `useUserAuth()` reads for the new hook. The API client gains an optional `{ clientId }` opts that appends `?client=<id>`. Admin routes mount the workspace pages via thin wrappers, with a new sidebar link. **Backend untouched** — every `u-products*` endpoint already routes admin sessions through `authenticateForPermission` + `resolveClientId(?client=...)`.

**Tech Stack:** TypeScript, React 18, react-router-dom v6, Vitest + `@testing-library/react` (verify availability first), Netlify Functions v2.

**Spec:** `docs/superpowers/specs/2026-06-09-admin-product-manager-view-design.md`

**Binding repo rules:**
- Never `git push` without user approval.
- Never `gh pr create` (burns Netlify preview build credits).
- Implementer verification at the end of every task = `npm run typecheck` + the specific tests for the task.
- Commit at the end of every task; never batch.

**Branch:** Work directly on `main` unless the user opts otherwise.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/modules/products/shared/scope.tsx` | `ProductsScope` context + `useProductsScope()` hook + `<WorkspaceProductsScopeProvider>` + `<AdminProductsScopeProvider>`. |
| `src/modules/products/admin/AdminProductsListPage.tsx` | Wrap `ProductsListPage` in `<AdminProductsScopeProvider>`. |
| `src/modules/products/admin/AdminProductEditPage.tsx` | Same for `ProductEditPage`. |
| `src/modules/products/admin/AdminProductCategoriesPage.tsx` | Same for `ProductCategoriesPage`. |
| `tests/unit/products-scope.test.tsx` | Hook + provider unit tests. |
| `tests/integration/u-products-admin-view.test.ts` | Admin-session integration tests for the `u-products*` endpoints. |

### Modified files

| Path | Change |
|---|---|
| `src/modules/products/shared/api.ts` | Every method gains optional `opts?: { clientId?: string }`. URL builder merges `?client=<id>` into any existing query string. `imagesApi.thumbUrl` (from sibling plan, if landed) also takes opts. |
| `src/modules/products/workspace/pages/ProductsListPage.tsx` | Swap direct `useUserAuth()` reads for `useProductsScope()`. Thread `{ clientId: scope.queryParam }` into every API call. |
| `src/modules/products/workspace/pages/ProductEditPage.tsx` | Same swap; threads `{ clientId }` into `productsApi.*`, `categoriesApi.*`, `imagesApi.*`. |
| `src/modules/products/workspace/pages/ProductCategoriesPage.tsx` | Same swap; threads `{ clientId }` into `categoriesApi.*` and `productsApi.list` (if used). |
| `src/lib/router.tsx` | Wrap workspace product routes in `<WorkspaceProductsScopeProvider>`. Add `/clients/:clientId/products*` admin routes under `RequireAdmin`. |
| `src/modules/ams/components/Sidebar.tsx` | Add `<NavLink>` to `/clients/${params.clientId}/products` in the `inClient` branch. |

---

## Task 1: API client — accept optional `{ clientId }` opts

**Files:**
- Modify: `src/modules/products/shared/api.ts`
- Create: `tests/unit/products-api-client-scope.test.ts`

The API client is the foundation. Once it threads `?client=`, every caller can be migrated.

- [ ] **Step 1: Write failing tests for URL construction**

Create `tests/unit/products-api-client-scope.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { productsApi, categoriesApi, imagesApi } from '../../src/modules/products/shared/api';

const capturedUrls: string[] = [];
let originalFetch: typeof fetch;

beforeEach(() => {
  capturedUrls.length = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    capturedUrls.push(url);
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('products-api client scope threading', () => {
  test('productsApi.list without opts does not include client= param', async () => {
    await productsApi.list({ status: 'active' });
    expect(capturedUrls[0]).toContain('/api/u-products');
    expect(capturedUrls[0]).toContain('status=active');
    expect(capturedUrls[0]).not.toContain('client=');
  });

  test('productsApi.list with clientId appends ?client=<id> (merged with other params)', async () => {
    await productsApi.list({ status: 'active' }, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toContain('client=abc-123');
    expect(capturedUrls[0]).toContain('status=active');
  });

  test('productsApi.get with clientId appends ?client=<id>', async () => {
    await productsApi.get('prod-1', { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products/prod-1?client=abc-123');
  });

  test('productsApi.create with clientId POSTs to ?client=<id>', async () => {
    await productsApi.create({ name: 'X', type: 'physical', price_cents: 100 }, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products?client=abc-123');
  });

  test('productsApi.update with clientId PATCHes to ?client=<id>', async () => {
    await productsApi.update('prod-1', { name: 'Y' }, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products/prod-1?client=abc-123');
  });

  test('productsApi.remove with clientId DELETEs at ?client=<id>', async () => {
    await productsApi.remove('prod-1', { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products/prod-1?client=abc-123');
  });

  test('productsApi.bulk with clientId posts to /api/u-products-bulk?client=<id>', async () => {
    await productsApi.bulk({ action: 'set_status', ids: ['p1'], value: 'archived' } as any, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products-bulk?client=abc-123');
  });

  test('productsApi.exportUrl appends client= alongside other filter params', () => {
    const url = productsApi.exportUrl({ status: 'active' }, 'csv', { clientId: 'abc-123' });
    expect(url).toContain('client=abc-123');
    expect(url).toContain('format=csv');
    expect(url).toContain('status=active');
  });

  test('categoriesApi.list with clientId appends ?client=<id>', async () => {
    await categoriesApi.list({ clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-product-categories?client=abc-123');
  });

  test('categoriesApi.create with clientId POSTs to ?client=<id>', async () => {
    await categoriesApi.create('cat', { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-product-categories?client=abc-123');
  });

  test('categoriesApi.update with clientId PATCHes to ?client=<id>', async () => {
    await categoriesApi.update('cat-1', { name: 'Y' }, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-product-categories/cat-1?client=abc-123');
  });

  test('categoriesApi.remove with clientId DELETEs at ?client=<id>', async () => {
    await categoriesApi.remove('cat-1', { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-product-categories/cat-1?client=abc-123');
  });

  test('imagesApi.upload with clientId POSTs to ?client=<id>', async () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await imagesApi.upload('prod-1', file, undefined, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products-image?client=abc-123');
  });

  test('imagesApi.remove with clientId DELETEs at ?client=<id>', async () => {
    await imagesApi.remove('img-1', { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products-image/img-1?client=abc-123');
  });

  test('imagesApi.thumbUrl with clientId appends ?client=<id>', () => {
    const url = imagesApi.thumbUrl('img-1', { clientId: 'abc-123' });
    expect(url).toBe('/api/u-products-image-thumb/img-1?client=abc-123');
  });
});
```

If the sibling thumbnails plan has NOT yet landed, the last test (`imagesApi.thumbUrl`) and any reference to it will be missing from `api.ts`. In that case, delete the last test and skip the `thumbUrl` change in Step 2.

- [ ] **Step 2: Run tests — expect failure (no `opts` arg accepted yet)**

```bash
npx vitest run tests/unit/products-api-client-scope.test.ts
```

Expected: ALL failing — the existing methods don't accept the second argument.

- [ ] **Step 3: Refactor `api.ts` to accept opts**

Open `src/modules/products/shared/api.ts`. Add at the top of the file (above `class ProductsApiError`):

```ts
export interface ScopeOpts {
  clientId?: string;
}

function withScope(url: string, opts?: ScopeOpts): string {
  if (!opts?.clientId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}client=${encodeURIComponent(opts.clientId)}`;
}
```

Update each API method to accept `opts?: ScopeOpts` and pass through `withScope(...)`:

```ts
export const productsApi = {
  list: (f: ProductFilters, opts?: ScopeOpts): Promise<ProductListResponse> => {
    const q = qs(f);
    return jsonFetch(withScope(`/api/u-products${q ? `?${q}` : ''}`, opts));
  },
  get: (id: string, opts?: ScopeOpts): Promise<ProductWithImages> =>
    jsonFetch(withScope(`/api/u-products/${id}`, opts)),
  create: (body: Partial<Product>, opts?: ScopeOpts): Promise<Product> =>
    jsonFetch(withScope('/api/u-products', opts), { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Product>, opts?: ScopeOpts): Promise<Product> =>
    jsonFetch(withScope(`/api/u-products/${id}`, opts), { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string, opts?: ScopeOpts): Promise<void> =>
    jsonFetch<void>(withScope(`/api/u-products/${id}`, opts), { method: 'DELETE' }),
  bulk: (body: BulkAction, opts?: ScopeOpts): Promise<BulkResult> =>
    jsonFetch(withScope('/api/u-products-bulk', opts), { method: 'POST', body: JSON.stringify(body) }),
  exportUrl: (f: ProductFilters, format: 'csv' | 'xlsx', opts?: ScopeOpts): string => {
    const q = qs(f);
    const sep = q ? '&' : '';
    return withScope(`/api/u-products-export?${q}${sep}format=${format}`, opts);
  },
  importDryRun: (file: File, opts?: ScopeOpts): Promise<ImportDryRun> => {
    const fd = new FormData();
    fd.append('file', file);
    return formFetch(withScope(`/api/u-products-import?dry_run=true`, opts), fd);
  },
  importCommit: (file: File, opts?: ScopeOpts): Promise<ImportDryRun & { committed: true }> => {
    const fd = new FormData();
    fd.append('file', file);
    return formFetch(withScope('/api/u-products-import', opts), fd);
  },
};

export const categoriesApi = {
  list: (opts?: ScopeOpts): Promise<{ items: ProductCategory[] }> =>
    jsonFetch(withScope('/api/u-product-categories', opts)),
  create: (name: string, opts?: ScopeOpts): Promise<ProductCategory> =>
    jsonFetch(withScope('/api/u-product-categories', opts), { method: 'POST', body: JSON.stringify({ name }) }),
  update: (id: string, body: { name?: string; sort_order?: number }, opts?: ScopeOpts): Promise<ProductCategory> =>
    jsonFetch(withScope(`/api/u-product-categories/${id}`, opts), { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string, opts?: ScopeOpts): Promise<void> =>
    jsonFetch<void>(withScope(`/api/u-product-categories/${id}`, opts), { method: 'DELETE' }),
};

export const imagesApi = {
  upload: (product_id: string, file: File, sort_order?: number, opts?: ScopeOpts): Promise<ProductImageRow> => {
    const fd = new FormData();
    fd.append('product_id', product_id);
    if (sort_order != null) fd.append('sort_order', String(sort_order));
    fd.append('file', file);
    return formFetch(withScope('/api/u-products-image', opts), fd);
  },
  remove: (image_id: string, opts?: ScopeOpts): Promise<void> =>
    jsonFetch<void>(withScope(`/api/u-products-image/${image_id}`, opts), { method: 'DELETE' }),
  // If the thumbnails plan landed, `thumbUrl` already exists. Add opts to it.
  // If not, this entire line stays unchanged from current (no thumbUrl yet).
  thumbUrl: (image_id: string, opts?: ScopeOpts): string =>
    withScope(`/api/u-products-image-thumb/${image_id}`, opts),
};
```

If the sibling thumbnails plan hasn't landed yet, drop the `thumbUrl` field from this update — leave `imagesApi` with just `upload` + `remove`.

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run tests/unit/products-api-client-scope.test.ts
```

Expected: ALL passing.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0. Existing callers (which do NOT pass opts) still work because `opts` is optional.

- [ ] **Step 6: Commit**

```bash
git add src/modules/products/shared/api.ts tests/unit/products-api-client-scope.test.ts
git commit -m "$(cat <<'EOF'
feat(products): products API client accepts optional clientId opts

Every method gains opts?: { clientId?: string }; when set, ?client=<id>
is merged into the URL. Existing call sites work unchanged. Unblocks
admin view of client product catalog.
EOF
)"
```

---

## Task 2: ProductsScope context + workspace provider

**Files:**
- Create: `src/modules/products/shared/scope.tsx`
- Create: `tests/unit/products-scope.test.tsx`

- [ ] **Step 1: Verify @testing-library/react is installed**

```bash
node -e "require.resolve('@testing-library/react'); console.log('ok')" 2>&1 || echo "missing"
```

If output is `ok` → continue. If `missing` → install it now:

```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Then add `environment: 'jsdom'` for tests/unit files. Cleanest path: a per-file pragma. The existing vitest config has `environment: 'node'`. Add this comment at the very top of any RTL-using test file:

```ts
/** @vitest-environment jsdom */
```

Verify with a tiny dry run:

```bash
node -e "console.log(require.resolve('@testing-library/react'))"
```

- [ ] **Step 2: Write failing tests for the scope hook + workspace provider**

Create `tests/unit/products-scope.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useProductsScope, WorkspaceProductsScopeProvider, AdminProductsScopeProvider } from '../../src/modules/products/shared/scope';

// Mock the user-portal auth context.
vi.mock('../../src/modules/user-portal/user-auth-context', () => ({
  useUserAuth: () => ({
    user:        { id: 'u1', display_name: 'U', email: 'u@e.com', level_number: 2, role: { key: 'k', label: 'L', color: '#000' } } as any,
    client:      { id: 'client-W', slug: 'workspace', name: 'W' } as any,
    permissions: { 'products.products.view': true } as any,
    enabledModules: [] as any,
    loading: false,
    refresh: async () => {},
    signOut: async () => {},
  }),
}));

// Mock the admin auth context.
vi.mock('../../src/lib/auth-context', () => ({
  useAuth: () => ({
    admin: { id: 'a1', email: 'admin@e.com' } as any,
    loading: false,
    signOut: async () => {},
    signIn: async () => true,
  }),
}));

function ScopeProbe({ onScope }: { onScope: (s: ReturnType<typeof useProductsScope>) => void }) {
  const s = useProductsScope();
  onScope(s);
  return null;
}

describe('useProductsScope', () => {
  test('throws when used outside a provider', () => {
    expect(() => render(<ScopeProbe onScope={() => {}} />)).toThrow(/scope/i);
  });

  test('WorkspaceProductsScopeProvider yields workspace shape', () => {
    let captured: any;
    render(
      <WorkspaceProductsScopeProvider>
        <ScopeProbe onScope={(s) => { captured = s; }} />
      </WorkspaceProductsScopeProvider>,
    );
    expect(captured).toEqual({
      clientId: 'client-W',
      levelNumber: 2,
      queryParam: undefined,
      mode: 'workspace',
    });
  });

  test('AdminProductsScopeProvider yields admin shape with clientId from URL', () => {
    let captured: any;
    render(
      <MemoryRouter initialEntries={['/clients/abc-123/products']}>
        <Routes>
          <Route
            path="/clients/:clientId/products"
            element={
              <AdminProductsScopeProvider>
                <ScopeProbe onScope={(s) => { captured = s; }} />
              </AdminProductsScopeProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(captured).toEqual({
      clientId: 'abc-123',
      levelNumber: 1,
      queryParam: 'abc-123',
      mode: 'admin',
    });
  });

  test('AdminProductsScopeProvider without :clientId URL param throws', () => {
    const swallow = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(
      <MemoryRouter initialEntries={['/clients/products']}>
        <Routes>
          <Route
            path="/clients/products"
            element={
              <AdminProductsScopeProvider>
                <ScopeProbe onScope={() => {}} />
              </AdminProductsScopeProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    )).toThrow(/clientId/i);
    swallow.mockRestore();
  });
});
```

- [ ] **Step 3: Run tests — expect failure (module missing)**

```bash
npx vitest run tests/unit/products-scope.test.tsx
```

Expected: FAIL with module not found for `scope`.

- [ ] **Step 4: Create the scope module**

Create `src/modules/products/shared/scope.tsx`:

```tsx
// Auth/tenancy scope for the Product Manager UI.
//
// Workspace mode: bucket-user JWT scopes the request; clientId comes from
//   useUserAuth().client. queryParam is undefined — API calls don't need
//   ?client=, the cookie is enough.
//
// Admin mode: admin session bypasses every permission key on the server.
//   clientId comes from the URL /clients/:clientId/.... API calls MUST send
//   ?client=<id> so the server knows which client's data to read.
//
// Components read scope ONLY through useProductsScope(). They do not read
// useUserAuth() / useAuth() directly.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useUserAuth } from '../../user-portal/user-auth-context';
import { useAuth } from '../../../lib/auth-context';
import type { UserPortalPermissionMatrix } from '../../user-portal/api';

export interface ProductsScope {
  clientId: string;
  levelNumber: number | null;
  queryParam: string | undefined;     // appended as ?client=<id> when admin
  mode: 'workspace' | 'admin';
  permissions: UserPortalPermissionMatrix;
}

const Ctx = createContext<ProductsScope | null>(null);

export function useProductsScope(): ProductsScope {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProductsScope used outside a ProductsScopeProvider');
  return v;
}

export function WorkspaceProductsScopeProvider({ children }: { children: ReactNode }) {
  const { user, client, permissions } = useUserAuth();
  const value = useMemo<ProductsScope | null>(() => {
    if (!user || !client) return null;
    return {
      clientId: client.id,
      levelNumber: user.level_number,
      queryParam: undefined,
      mode: 'workspace',
      permissions,
    };
  }, [user, client, permissions]);
  // Don't render children until auth is ready. UserDashboardLayout already
  // guards on loading upstream, so this is a defensive no-op in practice.
  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AdminProductsScopeProvider({ children }: { children: ReactNode }) {
  const { admin } = useAuth();
  const { clientId } = useParams<{ clientId: string }>();
  if (!clientId) throw new Error('AdminProductsScopeProvider requires :clientId URL param');
  const value = useMemo<ProductsScope | null>(() => {
    if (!admin) return null;
    return {
      clientId,
      levelNumber: 1,                       // synthesize L1 owner — bypasses client-side gates
      queryParam: clientId,                 // tells API client to send ?client=
      mode: 'admin',
      permissions: {} as UserPortalPermissionMatrix, // unused at L1 owner; kept to satisfy the type
    };
  }, [admin, clientId]);
  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npx vitest run tests/unit/products-scope.test.tsx
```

Expected: 4 passing.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/products/shared/scope.tsx tests/unit/products-scope.test.tsx
git commit -m "$(cat <<'EOF'
feat(products): ProductsScope context + workspace/admin providers

Centralizes the workspace-vs-admin auth difference into one hook. Pages
read useProductsScope() instead of useUserAuth() directly.

Admin provider synthesizes levelNumber=1 — existing canViewProducts()
gates bypass for L1 owners, matching the server's admin bypass.
EOF
)"
```

---

## Task 3: Migrate workspace pages to consume `useProductsScope`

**Files:**
- Modify: `src/modules/products/workspace/pages/ProductsListPage.tsx`
- Modify: `src/modules/products/workspace/pages/ProductEditPage.tsx`
- Modify: `src/modules/products/workspace/pages/ProductCategoriesPage.tsx`

These pages currently `useUserAuth()` directly for `permissions` and `user.level_number`, and call `productsApi.list(...)` etc. without scope. After this task, the pages are shell-agnostic — they care only about the scope hook.

- [ ] **Step 1: ProductsListPage — swap auth source and thread clientId**

In `src/modules/products/workspace/pages/ProductsListPage.tsx`:

Replace:

```tsx
import { useUserAuth } from '../../../user-portal/user-auth-context';
// ...
const { user, permissions, loading } = useUserAuth();
// ...
if (!canViewProducts(permissions, user.level_number)) {
  // ...
}
const levelNumber = user.level_number;
const editAllowed   = canEditProducts(permissions, levelNumber);
// ...
```

With:

```tsx
import { useProductsScope } from '../../shared/scope';
// ...
const scope = useProductsScope();
const { permissions, levelNumber, queryParam: clientQuery } = scope;
// ...
if (!canViewProducts(permissions, levelNumber)) {
  // ...
}
const editAllowed   = canEditProducts(permissions, levelNumber);
// ...
```

Remove the `loading` read — the providers gate children on auth readiness, so the page itself doesn't need to handle loading.

Every API call in the file gets `{ clientId: clientQuery }` threaded as its last argument. Grep within the file:

```bash
grep -n 'productsApi\.\|categoriesApi\.\|imagesApi\.' src/modules/products/workspace/pages/ProductsListPage.tsx
```

For each hit, append `, { clientId: clientQuery }` (or for arrow callbacks that build a URL via `exportUrl`, pass `{ clientId: clientQuery }` as the third arg).

Examples:

```ts
// Before: productsApi.list(filters)
// After:  productsApi.list(filters, { clientId: clientQuery })

// Before: productsApi.bulk(bulkBody)
// After:  productsApi.bulk(bulkBody, { clientId: clientQuery })

// Before: productsApi.exportUrl(filters, 'csv')
// After:  productsApi.exportUrl(filters, 'csv', { clientId: clientQuery })

// Before: categoriesApi.list()
// After:  categoriesApi.list({ clientId: clientQuery })
```

- [ ] **Step 2: ProductEditPage — same swap**

Same operation on `ProductEditPage.tsx`. The page calls `productsApi.get`, `productsApi.create`, `productsApi.update`, `productsApi.remove`, and probably `imagesApi.upload`/`imagesApi.remove` (via the gallery, which is a child component — see Step 4).

Replace the `useUserAuth()` block with `useProductsScope()` exactly as in Step 1. Thread `{ clientId: clientQuery }` into every API call.

If the page passes `imagesApi.upload/remove` calls down via callbacks to `ProductImageGallery`, that gallery already calls `imagesApi.upload`/`imagesApi.remove` itself — see Step 4.

- [ ] **Step 3: ProductCategoriesPage — same swap**

Same operation. The page calls `categoriesApi.list/create/update/remove`. Thread `{ clientId: clientQuery }` into each.

- [ ] **Step 4: ProductImageGallery — read scope and thread clientId on uploads/removes**

`src/modules/products/workspace/components/ProductImageGallery.tsx` makes its own `imagesApi.upload` and `imagesApi.remove` calls. Open the file and:

- Import: `import { useProductsScope } from '../../shared/scope';`
- Inside the component, near the top: `const { queryParam: clientQuery } = useProductsScope();`
- Wherever `imagesApi.upload(...)` or `imagesApi.remove(...)` is called, append `, { clientId: clientQuery }` as the last arg. The full `imagesApi.upload` signature is `(productId, file, sort_order?, opts?)` — keep `sort_order` as `undefined` if not used.

- [ ] **Step 5: ProductBulkBar / ProductImportModal — check for direct API calls**

Grep for any remaining API call sites that haven't been touched:

```bash
grep -rn 'productsApi\.\|categoriesApi\.\|imagesApi\.' src/modules/products/workspace/
```

For each hit not yet touched, decide:
- If the component receives `clientId` (or the whole scope) via props from a parent page, thread it as a prop and use it.
- If the component is presentational and the parent should be making the call, refactor — move the API call to the parent page and pass results down.
- If the component reads scope directly, add `useProductsScope()` at the top.

For the existing layout, the pages tend to own API calls; components like `ProductBulkBar` get `onAction` callbacks from the page. If `ProductBulkBar` calls `productsApi.bulk` itself, do option (a) — pass `clientId` as a prop, or just call `useProductsScope` inside. Either pattern is acceptable; pick whichever matches the rest of the file.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0. If a missed call site shows a type error, add the `opts` arg there.

- [ ] **Step 7: Run all product unit tests**

```bash
npx vitest run tests/unit/products-
```

Expected: existing product unit tests + the two new scope tests all pass.

- [ ] **Step 8: Commit**

```bash
git add src/modules/products/workspace/
git commit -m "$(cat <<'EOF'
refactor(products): pages consume useProductsScope() instead of useUserAuth

Threads {clientId: scope.queryParam} into every API call so the same
pages work under both workspace and admin shells. No behavior change in
workspace mode (queryParam is undefined; URL unchanged).
EOF
)"
```

---

## Task 4: Wrap workspace product routes in `<WorkspaceProductsScopeProvider>`

**Files:**
- Modify: `src/lib/router.tsx`

This is a no-op at runtime in workspace today (provider yields the same scope as before), but it locks in the contract so the migration in Task 3 is sound.

- [ ] **Step 1: Wrap the workspace product routes**

In `src/lib/router.tsx`, find the workspace route block that lists `products`, `products/new`, `products/:productId/edit`, `products/categories`. Currently:

```tsx
{ path: 'products', element: <ProductsListPage /> },
{ path: 'products/new', element: <ProductEditPage /> },
{ path: 'products/:productId/edit', element: <ProductEditPage /> },
{ path: 'products/categories', element: <ProductCategoriesPage /> },
```

Refactor into a route-group with a layout-route element that mounts the provider:

```tsx
{
  element: (
    <WorkspaceProductsScopeProvider>
      <Outlet />
    </WorkspaceProductsScopeProvider>
  ),
  children: [
    { path: 'products', element: <ProductsListPage /> },
    { path: 'products/new', element: <ProductEditPage /> },
    { path: 'products/:productId/edit', element: <ProductEditPage /> },
    { path: 'products/categories', element: <ProductCategoriesPage /> },
  ],
},
```

Add imports:

```tsx
import { WorkspaceProductsScopeProvider } from '../modules/products/shared/scope';
// `Outlet` is already imported from react-router-dom for the existing layouts; verify.
```

- [ ] **Step 2: Manual click-through in workspace mode if dev server is running**

If the handoff's dev servers are still up at `:8890`, open `/c/<slug>/products` and confirm the list still renders. If they're down, skip — typecheck + tests already validate.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/router.tsx
git commit -m "$(cat <<'EOF'
refactor(router): wrap workspace product routes in scope provider

Locks in the new useProductsScope() contract. Behavior unchanged for
workspace users.
EOF
)"
```

---

## Task 5: Admin route wrappers + admin sidebar entry

**Files:**
- Create: `src/modules/products/admin/AdminProductsListPage.tsx`
- Create: `src/modules/products/admin/AdminProductEditPage.tsx`
- Create: `src/modules/products/admin/AdminProductCategoriesPage.tsx`
- Modify: `src/lib/router.tsx`
- Modify: `src/modules/ams/components/Sidebar.tsx`

- [ ] **Step 1: Create the three admin wrappers**

Create `src/modules/products/admin/AdminProductsListPage.tsx`:

```tsx
import { AdminProductsScopeProvider } from '../shared/scope';
import ProductsListPage from '../workspace/pages/ProductsListPage';

export default function AdminProductsListPage() {
  return (
    <AdminProductsScopeProvider>
      <ProductsListPage />
    </AdminProductsScopeProvider>
  );
}
```

Create `src/modules/products/admin/AdminProductEditPage.tsx`:

```tsx
import { AdminProductsScopeProvider } from '../shared/scope';
import ProductEditPage from '../workspace/pages/ProductEditPage';

export default function AdminProductEditPage() {
  return (
    <AdminProductsScopeProvider>
      <ProductEditPage />
    </AdminProductsScopeProvider>
  );
}
```

Create `src/modules/products/admin/AdminProductCategoriesPage.tsx`:

```tsx
import { AdminProductsScopeProvider } from '../shared/scope';
import ProductCategoriesPage from '../workspace/pages/ProductCategoriesPage';

export default function AdminProductCategoriesPage() {
  return (
    <AdminProductsScopeProvider>
      <ProductCategoriesPage />
    </AdminProductsScopeProvider>
  );
}
```

If `ProductsListPage` / `ProductEditPage` / `ProductCategoriesPage` use named (not default) exports, adjust the import. Verify with:

```bash
grep -n 'export default\|export function' src/modules/products/workspace/pages/Products{List,Edit,Categories}Page.tsx
```

- [ ] **Step 2: Register admin routes in the router**

In `src/lib/router.tsx`, inside the `RequireAdmin` children array, add (after the existing `/clients/:clientId/configure` entry):

```tsx
{ path: '/clients/:clientId/products', element: <AdminProductsListPage /> },
{ path: '/clients/:clientId/products/new', element: <AdminProductEditPage /> },
{ path: '/clients/:clientId/products/:productId/edit', element: <AdminProductEditPage /> },
{ path: '/clients/:clientId/products/categories', element: <AdminProductCategoriesPage /> },
```

Add imports at the top of the file:

```tsx
import AdminProductsListPage from '../modules/products/admin/AdminProductsListPage';
import AdminProductEditPage from '../modules/products/admin/AdminProductEditPage';
import AdminProductCategoriesPage from '../modules/products/admin/AdminProductCategoriesPage';
```

- [ ] **Step 3: Add the sidebar entry**

In `src/modules/ams/components/Sidebar.tsx`, inside the `inClient ? (...) : (...)` ternary's `inClient` branch, after `Dashboard` and before `Audit`:

```tsx
<NavLink to={`/clients/${params.clientId}/products`}>Product Manager</NavLink>
```

Final shape of the inClient branch:

```tsx
<>
  <NavLink to={`/clients/${params.clientId}`} end>Dashboard</NavLink>
  <NavLink to={`/clients/${params.clientId}/products`}>Product Manager</NavLink>
  <NavLink to={`/clients/${params.clientId}/audit`}>Audit</NavLink>
  <NavLink to={`/clients/${params.clientId}/settings`}>Settings</NavLink>
  <NavLink to="/">← back to admin</NavLink>
</>
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 5: Run full unit suite to make sure nothing regressed**

```bash
npx vitest run tests/unit/
```

Expected: ALL passing.

- [ ] **Step 6: Commit**

```bash
git add src/modules/products/admin/ src/lib/router.tsx src/modules/ams/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
feat(products): admin route wrappers + sidebar link

Admin can now reach /clients/:id/products via sidebar nav. Pages reuse
the workspace components via AdminProductsScopeProvider, which threads
?client=<id> through the API client.
EOF
)"
```

---

## Task 6: Integration test — admin session against `u-products` endpoints

**Files:**
- Create: `tests/integration/u-products-admin-view.test.ts`

This regression-guards the backend's already-admin-ready contract — if a future refactor accidentally tightens `requirePermission` or `resolveClientId`, this test catches it before the FE breaks.

- [ ] **Step 1: Write the integration tests**

Create `tests/integration/u-products-admin-view.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

// Reuse the in-memory blob mock pattern from u-products-image.test.ts so
// uploads in this file don't hit real Netlify Blobs.
const sourceStore = new Map<string, ArrayBuffer>();
vi.mock('../../netlify/functions/_shared/products-storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/products-storage')>();
  return {
    ...original,
    productImagesStore: () => ({
      set:    async (key: string, data: ArrayBuffer) => { sourceStore.set(key, data); },
      get:    async (key: string) => sourceStore.get(key) ?? null,
      delete: async (key: string) => { sourceStore.delete(key); },
      getMetadata: async (key: string) => sourceStore.has(key) ? { etag: 'mock', metadata: {} } : null,
    }),
  };
});

import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import userNodesHandler from '../../netlify/functions/user-nodes';
import uLoginHandler from '../../netlify/functions/u-login';
import uProductsHandler from '../../netlify/functions/u-products';
import uProductsDetailHandler from '../../netlify/functions/u-products-detail';
import uProductsImageHandler from '../../netlify/functions/u-products-image';
import { assertLastAudit } from '../helpers/audit';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-admin-view@example.com';
const ADMIN_PASSWORD = 'pm-admin-view-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let adminId: string;
let clientAId: string;
let clientASlug: string;
let clientBId: string;
let buCookieB: string;
const createdClients: string[] = [];

async function adminLogin(): Promise<string> {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const r = await loginHandler(new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

async function provisionClient(label: string): Promise<{ id: string; slug: string; roleId: string }> {
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `${label} ${Date.now()}-${Math.random().toString(36).slice(2,6)}` }),
  }), CTX);
  const cb = (await cr.json()) as { client: { id: string; slug: string } };
  createdClients.push(cb.client.id);
  const rr = await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${cb.client.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
  }), CTX);
  const roleId = ((await rr.json()) as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${cb.client.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ level_number: 1, allowed_role_ids: [roleId] }),
  }), CTX);
  return { id: cb.client.id, slug: cb.client.slug, roleId };
}

async function bootBucketUser(clientId: string, slug: string, roleId: string): Promise<string> {
  const email = `pm-av-${Date.now()}-${Math.random().toString(36).slice(2,6)}@example.com`;
  const password = 'pm-av-pw-123';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'AV User', email, create_login: true, temp_password: password }),
  }), CTX);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${slug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  }), CTX);
  return lr.headers.get('set-cookie')!.split(';')[0]!;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  const a = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'AdminView Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
    RETURNING id
  `) as { id: string }[];
  adminId = a[0]!.id;
});

beforeEach(async () => {
  sourceStore.clear();
  adminCookie = await adminLogin();
  const a = await provisionClient('AV-A');
  clientAId = a.id; clientASlug = a.slug;
  const b = await provisionClient('AV-B');
  clientBId = b.id;
  buCookieB = await bootBucketUser(clientBId, b.slug, b.roleId);
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('u-products admin view', () => {
  test('admin GET /api/u-products?client=A returns only A products', async () => {
    // Seed: admin posts a product to A. Verify list under ?client=A returns it.
    const c = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ type: 'physical', name: 'A-prod', price_cents: 100 }),
    }), CTX);
    expect(c.status).toBe(201);

    const l = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      headers: { cookie: adminCookie },
    }), CTX);
    expect(l.status).toBe(200);
    const body = await l.json() as { items: Array<{ name: string }> };
    expect(body.items.some((i) => i.name === 'A-prod')).toBe(true);
  });

  test('admin without ?client= returns 400 missing_client', async () => {
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
      headers: { cookie: adminCookie },
    }), CTX);
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('missing_client');
  });

  test('admin POST /api/u-products?client=A creates row under A', async () => {
    const r = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ type: 'service', name: 'A-svc', price_cents: 250 }),
    }), CTX);
    expect(r.status).toBe(201);
    const body = await r.json() as { id: string };
    const row = (await sql`SELECT client_id FROM public.products WHERE id = ${body.id}::uuid`) as { client_id: string }[];
    expect(row[0]!.client_id).toBe(clientAId);
  });

  test('admin POST /api/u-products-image?client=A writes to A blob namespace', async () => {
    // Make a product under A first.
    const c = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ type: 'physical', name: 'A-im', price_cents: 100 }),
    }), CTX);
    const prod = (await c.json()) as { id: string };
    // Upload.
    const fd = new FormData();
    fd.append('product_id', prod.id);
    fd.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'a.png');
    const r = await uProductsImageHandler(new Request(`http://localhost/api/u-products-image?client=${clientAId}`, {
      method: 'POST', headers: { cookie: adminCookie }, body: fd,
    }), CTX);
    expect(r.status).toBe(201);
    const body = await r.json() as { blob_key: string };
    expect(body.blob_key.startsWith(`product-images/${clientAId}/`)).toBe(true);
  });

  test('admin PATCH /api/u-products/:id?client=A audits with admin actor', async () => {
    const c = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ type: 'physical', name: 'A-patch', price_cents: 100 }),
    }), CTX);
    const prod = (await c.json()) as { id: string };
    const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${prod.id}?client=${clientAId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'A-patched' }),
    }), CTX);
    expect(r.status).toBe(200);
    await assertLastAudit(sql, {
      op: 'products.updated',
      targetType: 'product',
      targetId: prod.id,
      actorAdminId: adminId,
      actorUserNodeId: null,
      clientId: clientAId,
    });
  });

  test('bucket-user with ?client=<other> returns 403 forbidden_cross_client', async () => {
    // buCookieB belongs to client B. Send ?client=A — backend must reject.
    const r = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      headers: { cookie: buCookieB },
    }), CTX);
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('forbidden_cross_client');
  });
});
```

- [ ] **Step 2: Run tests — expect pass (backend is already admin-ready)**

```bash
npx vitest run tests/integration/u-products-admin-view.test.ts
```

Expected: 6 passing.

If the `assertLastAudit` audit-op label is `'products.updated'` and the actual implementation uses something different (`'product.updated'`, `'products.update'`, etc.), look at the `assertLastAudit` calls in `tests/integration/u-products-list-create.test.ts` or `tests/integration/u-products-detail.test.ts` — match the op there. Do NOT guess.

If `actor_admin_id` / `actor_user_node_id` field naming differs in `assertLastAudit`'s shape, look at the `ExpectedAudit` interface in `tests/helpers/audit.ts` and adjust the keys.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/u-products-admin-view.test.ts
git commit -m "$(cat <<'EOF'
test(products): admin-session integration coverage

Six scenarios: list, missing ?client=, create, image upload, audit
actor, cross-tenant BU rejection. Regression-guards the backend's
already-admin-ready contract.
EOF
)"
```

---

## Task 7: Final verification + manual FE smoke

**Files:**
- Run only — no edits unless something fails.

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: ALL test files pass.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Lint, if a lint script exists**

```bash
grep -q '"lint"' package.json && npm run lint || echo "no lint script — skipping"
```

Expected: 0 or "no lint script" message.

- [ ] **Step 4: Manual FE smoke (if dev servers are running per the handoff)**

In a browser at `http://localhost:8890`:

- Sign in as admin → land at `/`.
- Click into a client → land at `/clients/<id>` (AccessDashboard).
- Sidebar shows: Dashboard, **Product Manager**, Audit, Settings, ← back to admin.
- Click "Product Manager" → land at `/clients/<id>/products`. List should render (empty or populated for that client).
- Create a product → appears in list.
- Open the product → edit page renders. Upload an image. Save. Delete. Re-create.
- Open Categories → CRUD works.
- Network panel: every request shows `?client=<id>`. Audit log (separate admin nav) shows the new entries with admin actor.

If dev servers are down, skip — the integration tests have already validated the contract.

- [ ] **Step 5: Confirm clean working tree**

```bash
git status
```

Expected: clean. Commit any fix-ups first.

- [ ] **Step 6: Print summary of commits**

```bash
git log --oneline -10
```

Expected: 6 new commits (one per task 1–6).

---

## Done criteria

- All 6 implementation commits land on `main`.
- `npm test` passes.
- `npm run typecheck` passes.
- Admin can view + manage any client's product catalog from `/clients/:clientId/products`.
- Workspace behavior unchanged.

## Out of scope (do NOT do)

- Do not `git push` — per `feedback_no_push_without_approval`.
- Do not `gh pr create` — per `feedback_no_deploy_previews`.
- Do not add an AccessDashboard tile — user explicitly deferred it.
- Do not touch backend code (`netlify/functions/*` source — `requirePermission` and `resolveClientId` already handle the admin path).
- Do not add an admin "impersonate workspace user" mechanism. This plan is admin-shell-only.
- Do not run a migration.

## Notes on test environment

The unit tests for the scope hook need `jsdom` because they render React. If the codebase's vitest config sets `environment: 'node'` globally, the per-file pragma `/** @vitest-environment jsdom */` at the top of `tests/unit/products-scope.test.tsx` handles it (see Task 2 Step 1). Don't switch the global environment — other unit tests are happy under node.

## Sibling plan dependency

If the thumbnails plan (`docs/superpowers/plans/2026-06-09-product-image-thumbnails.md`) hasn't landed yet, this plan's `imagesApi.thumbUrl(...)` references in Task 1 are not yet meaningful. Drop the `thumbUrl` test + the `thumbUrl` field update from Task 1 Step 3 — they'll get added when the thumbnails plan runs. Both orderings work; running thumbnails first is recommended for smaller blast radius.
