# Access Levels & Per-Level Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-Level CRUD permission matrix to the AMS, dynamically derived from each Client's enabled Products → Modules → DataBuckets, with admin-enabled Products as the gating layer and a server middleware that enforces the matrix on bucket-user sessions.

**Architecture:** Three sequential phases, each shippable on its own. Phase A introduces Module + Product manifests (code, not DB) and the admin "enable Products per Client" surface. Phase B introduces the `permissions` JSONB column on `client_levels` and the Primary-facing Access Level Dashboard that writes it. Phase C introduces `client_roles.bucket_family`, the `requirePermission` middleware, and the `subtreeOf` helper — leaving per-endpoint retrofit to follow-up work as each Module ships.

**Tech Stack:** TypeScript everywhere. Vite + React 18 + react-router on the front end. Netlify Functions + Neon (Postgres) on the back. Zod for body validation. Vitest for unit + integration tests. Argon2 for hashes (existing). Drag-and-drop via @dnd-kit/core (existing). Builds on [2026-05-27-ams-v3-hierarchy-design.md](../specs/2026-05-27-ams-v3-hierarchy-design.md) and [2026-06-01-access-levels-design.md](../specs/2026-06-01-access-levels-design.md).

---

## File map

**New files (Phase A):**
- `src/modules/registry/types.ts` — DataBucket / Verb / PlatformSurface / PermissionKey / ModuleManifest / ProductManifest types.
- `src/modules/registry/modules.ts` — moduleRegistry + helpers.
- `src/modules/registry/products.ts` — productRegistry + helpers.
- `src/modules/registry/manifests/booking.ts` — Booking Module manifest.
- `src/modules/registry/manifests/payments.ts` — Payments Module manifest.
- `src/modules/registry/products-list/saloon-booking.ts` — Saloon Booking Product manifest.
- `db/migrations/020_client_enabled_products.sql` — new table.
- `netlify/functions/admin-client-products.ts` — GET / PUT enabled Products per Client.
- `src/modules/admin/components/ClientProductsSection.tsx` — admin UI inside a Client detail view.

**New files (Phase B):**
- `db/migrations/021_client_levels_permissions.sql` — JSONB column.
- `netlify/functions/_shared/permission-keys.ts` — key validation against active manifests + DataBuckets + platform surfaces.
- `netlify/functions/client-levels-permissions.ts` — GET / PUT permissions for a Level.
- `src/modules/ams/pages/AccessLevelDashboard.tsx` — Primary's matrix UI.
- `src/modules/ams/components/PermissionMatrixCard.tsx` — one Level's matrix card.

**New files (Phase C):**
- `db/migrations/022_client_roles_bucket_family.sql` — column.
- `netlify/functions/_shared/subtree.ts` — `subtreeOf(sql, root_node_id)`.
- (Permissions middleware lives inside existing `netlify/functions/_shared/permissions.ts` — extended, not replaced.)

**Modified files:**
- `netlify/functions/_shared/permissions.ts` — add `requirePermission` + `getLevelMatrix`.
- `netlify/functions/user-nodes.ts` — query joins `bucket_family` so the API surfaces it (read-only addition).
- `netlify/functions/client-roles.ts` — accept `bucket_family` on POST / PUT (write).
- `src/modules/ams/pages/ConfigureStructure.tsx` — bucket_family dropdown per Role.
- `src/modules/ams/api.ts` — add `ClientRole.bucket_family`, add `getLevelPermissions` / `putLevelPermissions` wrappers, add `adminClientProductsGet/Put` wrappers.
- `src/modules/ams/pages/AccessDashboard.tsx` — add "Access Level Dashboard" link in header.

**New test files:**
- `tests/unit/registry.test.ts` — Module/Product manifest registry shape + helpers.
- `tests/integration/admin-client-products.test.ts` — admin Products endpoints.
- `tests/integration/client-levels-permissions.test.ts` — GET + PUT matrix, validation, full-replace semantics.
- `tests/integration/permissions-middleware.test.ts` — `requirePermission` accept/deny + subtree scoping + Primary bypass + admin bypass.

---

# Phase A — Manifests + Admin Products UI

Goal: Ship the manifest abstraction and let Admins toggle which Products each Client has. No permission enforcement yet; this phase only adds data.

## Task A1: Registry types

**Files:**
- Create: `src/modules/registry/types.ts`

- [ ] **Step 1: Create types file**

```ts
// src/modules/registry/types.ts
//
// Source of truth for the manifest type system used by:
//   - the per-Client Access Level Dashboard (UI generates rows from these),
//   - the requirePermission middleware (server validates keys against these),
//   - the admin "enable Products per Client" page.
//
// PermissionKey is the wire-format string used in the client_levels.permissions
// JSONB and in the requirePermission(key) call: '<module>.<bucket>.<verb>'
// for Module-scoped permissions, or '_platform.<surface>.<verb>' for fixed
// platform surfaces that don't belong to any Module.

export const DATA_BUCKETS = ['business', 'employees', 'customers', 'products'] as const;
export type DataBucket = (typeof DATA_BUCKETS)[number];

export const VERBS = ['view', 'create', 'edit', 'delete'] as const;
export type Verb = (typeof VERBS)[number];

export const PLATFORM_SURFACES = ['users', 'structure', 'settings'] as const;
export type PlatformSurface = (typeof PLATFORM_SURFACES)[number];

export type ModuleKey = string; // narrowed by the registry's keyof

export type PermissionKey =
  | `${ModuleKey}.${DataBucket}.${Verb}`
  | `_platform.${PlatformSurface}.${Verb}`;

export interface ModuleManifest {
  key: ModuleKey;
  label: string;
  data_buckets: ReadonlyArray<DataBucket>;
  verbs: ReadonlyArray<Verb>;
  vendor_side: boolean;
  customer_side: boolean;
}

export type ProductModuleSide = 'vendor' | 'customer' | 'both' | 'none';

export interface ProductManifest {
  key: string;
  label: string;
  modules: ReadonlyArray<{ module: ModuleKey; side: ProductModuleSide }>;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/registry/types.ts
git commit -m "feat(registry): manifest + permission-key types"
```

## Task A2: First Module manifests + registry

**Files:**
- Create: `src/modules/registry/manifests/booking.ts`
- Create: `src/modules/registry/manifests/payments.ts`
- Create: `src/modules/registry/modules.ts`
- Test: `tests/unit/registry.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/registry.test.ts
import { describe, expect, it } from 'vitest';
import {
  moduleRegistry, allModules, getModule,
} from '../../src/modules/registry/modules';
import { DATA_BUCKETS, VERBS } from '../../src/modules/registry/types';

describe('module registry', () => {
  it('contains booking and payments modules', () => {
    expect(getModule('booking')).toBeDefined();
    expect(getModule('payments')).toBeDefined();
  });

  it('every registered Module has a valid manifest shape', () => {
    for (const m of allModules()) {
      expect(typeof m.key).toBe('string');
      expect(typeof m.label).toBe('string');
      expect(Array.isArray(m.data_buckets)).toBe(true);
      for (const b of m.data_buckets) expect(DATA_BUCKETS).toContain(b);
      for (const v of m.verbs) expect(VERBS).toContain(v);
      expect(typeof m.vendor_side).toBe('boolean');
      expect(typeof m.customer_side).toBe('boolean');
    }
  });

  it('module keys are unique', () => {
    const keys = allModules().map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('getModule returns undefined for unknown key', () => {
    expect(getModule('nonexistent-module')).toBeUndefined();
  });

  it('registry is exported as an object keyed by ModuleKey', () => {
    expect(moduleRegistry.booking?.key).toBe('booking');
    expect(moduleRegistry.payments?.key).toBe('payments');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- --run tests/unit/registry.test.ts`
Expected: FAIL (modules.ts does not exist).

- [ ] **Step 3: Write manifests**

```ts
// src/modules/registry/manifests/booking.ts
import type { ModuleManifest } from '../types';

export const bookingManifest: ModuleManifest = {
  key: 'booking',
  label: 'Booking & Calendar',
  data_buckets: ['customers', 'employees'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: true,
};
```

```ts
// src/modules/registry/manifests/payments.ts
import type { ModuleManifest } from '../types';

export const paymentsManifest: ModuleManifest = {
  key: 'payments',
  label: 'Payments',
  data_buckets: ['customers', 'products'],
  verbs: ['view', 'create', 'edit'],  // no 'delete' — payments are immutable once captured
  vendor_side: true,
  customer_side: true,
};
```

- [ ] **Step 4: Write registry**

```ts
// src/modules/registry/modules.ts
//
// Central registry of all Module manifests. Adding a Module = adding one
// manifest file + one line here. The registry shape (Record keyed by module
// key) lets callers do both list-iteration (allModules) and direct lookup
// (getModule / moduleRegistry.foo).

import type { ModuleManifest } from './types';
import { bookingManifest } from './manifests/booking';
import { paymentsManifest } from './manifests/payments';

export const moduleRegistry = {
  booking: bookingManifest,
  payments: paymentsManifest,
} as const satisfies Record<string, ModuleManifest>;

export type RegisteredModuleKey = keyof typeof moduleRegistry;

export function allModules(): ModuleManifest[] {
  return Object.values(moduleRegistry);
}

export function getModule(key: string): ModuleManifest | undefined {
  return (moduleRegistry as Record<string, ModuleManifest>)[key];
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- --run tests/unit/registry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/modules/registry/manifests/booking.ts \
        src/modules/registry/manifests/payments.ts \
        src/modules/registry/modules.ts \
        tests/unit/registry.test.ts
git commit -m "feat(registry): booking + payments module manifests + registry"
```

## Task A3: First Product manifest + Product registry

**Files:**
- Create: `src/modules/registry/products-list/saloon-booking.ts`
- Create: `src/modules/registry/products.ts`
- Modify: `tests/unit/registry.test.ts`

- [ ] **Step 1: Extend the registry test**

Append to `tests/unit/registry.test.ts`:

```ts
import {
  productRegistry, allProducts, getProduct,
  derivePermissionRows,
} from '../../src/modules/registry/products';

describe('product registry', () => {
  it('saloon-booking product exists and references real modules', () => {
    const p = getProduct('saloon-booking');
    expect(p).toBeDefined();
    for (const ref of p!.modules) {
      expect(getModule(ref.module)).toBeDefined();
    }
  });

  it('product keys are unique', () => {
    const keys = allProducts().map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('derivePermissionRows', () => {
  it('returns empty for no enabled products', () => {
    expect(derivePermissionRows([])).toEqual([]);
  });

  it('returns (module, bucket) rows for every enabled product\'s modules', () => {
    const rows = derivePermissionRows(['saloon-booking']);
    // saloon-booking includes Booking (customers + employees) and Payments
    // (customers + products). Login is bucket-less and contributes no rows.
    const keys = rows.map((r) => `${r.module.key}.${r.bucket}`).sort();
    expect(keys).toEqual([
      'booking.customers',
      'booking.employees',
      'payments.customers',
      'payments.products',
    ]);
  });

  it('deduplicates rows when two products use the same module', () => {
    const rows = derivePermissionRows(['saloon-booking', 'saloon-booking']);
    const keys = rows.map((r) => `${r.module.key}.${r.bucket}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm test -- --run tests/unit/registry.test.ts`
Expected: FAIL (products.ts does not exist).

- [ ] **Step 3: Write Product manifest**

```ts
// src/modules/registry/products-list/saloon-booking.ts
import type { ProductManifest } from '../types';

export const saloonBookingProduct: ProductManifest = {
  key: 'saloon-booking',
  label: 'Saloon Booking System',
  modules: [
    { module: 'booking',  side: 'both' },
    { module: 'payments', side: 'both' },
  ],
};
```

- [ ] **Step 4: Write product registry + derive helper**

```ts
// src/modules/registry/products.ts
//
// Product registry + the matrix-row derivation helper used by:
//   - AccessLevelDashboard UI (generates the per-Level row list),
//   - client-levels-permissions endpoint (validates which keys are accepted).

import type { ProductManifest, ModuleManifest, DataBucket } from './types';
import { getModule } from './modules';
import { saloonBookingProduct } from './products-list/saloon-booking';

export const productRegistry = {
  'saloon-booking': saloonBookingProduct,
} as const satisfies Record<string, ProductManifest>;

export function allProducts(): ProductManifest[] {
  return Object.values(productRegistry);
}

export function getProduct(key: string): ProductManifest | undefined {
  return (productRegistry as Record<string, ProductManifest>)[key];
}

export interface PermissionRow {
  module: ModuleManifest;
  bucket: DataBucket;
}

/**
 * Given the set of Product keys a Client has enabled, return the deduplicated
 * list of (Module, DataBucket) rows the Primary should see in the Access
 * Level Dashboard. Order is stable: products in registration order, then
 * modules in product-declaration order, then buckets in manifest-declaration
 * order.
 */
export function derivePermissionRows(enabledProductKeys: readonly string[]): PermissionRow[] {
  const seen = new Set<string>();
  const out: PermissionRow[] = [];
  for (const pKey of enabledProductKeys) {
    const product = getProduct(pKey);
    if (!product) continue;
    for (const ref of product.modules) {
      const module = getModule(ref.module);
      if (!module) continue;
      for (const bucket of module.data_buckets) {
        const key = `${module.key}.${bucket}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ module, bucket });
      }
    }
  }
  return out;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --run tests/unit/registry.test.ts`
Expected: PASS (all original + 5 new).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/modules/registry/products-list/saloon-booking.ts \
        src/modules/registry/products.ts \
        tests/unit/registry.test.ts
git commit -m "feat(registry): products + derivePermissionRows helper"
```

## Task A4: Migration 020 — `client_enabled_products`

**Files:**
- Create: `db/migrations/020_client_enabled_products.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE public.client_enabled_products (
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  product_key      TEXT NOT NULL,
  enabled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_by_admin UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  PRIMARY KEY (client_id, product_key)
);
CREATE INDEX client_enabled_products_client_idx ON public.client_enabled_products (client_id);
-- Tracks which Product manifests are enabled for a given Client.
-- Product manifests themselves live in code; this table is just the join.
```

Note the trailing `;` on the last DDL statement — required by `scripts/migrate.ts`'s splitter (see saved feedback `feedback_migration_splitter` if added; otherwise grep `splitStatements` in `scripts/migrate.ts:31` for the regex).

- [ ] **Step 2: Apply migration to dev**

Run: `npm run migrate`
Expected: `→ applying 020_client_enabled_products (2 statements)` then `✓`.

If you see `(0 statements)`, the splitter swallowed your file because the first chunk starts with a comment line. Move leading comments to AFTER the first statement.

- [ ] **Step 3: Sanity-check the schema**

Run from project root: `node -e "import('@neondatabase/serverless').then(async({neon}) => { const sql=neon(require('fs').readFileSync('.env','utf8').split('\n').find(l=>l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=')); console.log(await sql\`SELECT column_name,data_type FROM information_schema.columns WHERE table_name='client_enabled_products' ORDER BY ordinal_position\`); })"`

Expected output includes `client_id uuid`, `product_key text`, `enabled_at timestamptz`, `enabled_by_admin uuid`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/020_client_enabled_products.sql
git commit -m "feat(db): migration 020 — client_enabled_products table"
```

## Task A5: Admin API endpoint — GET/PUT enabled Products

**Files:**
- Create: `netlify/functions/admin-client-products.ts`
- Test: `tests/integration/admin-client-products.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/admin-client-products.test.ts
vi.mock('../../netlify/functions/_shared/google-verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import adminClientProductsHandler from '../../netlify/functions/admin-client-products';

const ADMIN_EMAIL = 'acp-test@example.com';
const ADMIN_PASSWORD = 'acp-test-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let clientId: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'ACP Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  cookie = lr.headers.get('set-cookie')!.split(';')[0]!;
  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `ACP Test ${Date.now()}` }),
    }), CTX,
  );
  clientId = ((await cr.json()) as { client: { id: string } }).client.id;
  created.push(clientId);
});

afterAll(async () => {
  for (const id of created) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('admin-client-products', () => {
  it('GET returns empty enabled + the full Product catalog', async () => {
    const r = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, { headers: { cookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { enabled_keys: string[]; available: Array<{ key: string; label: string }> };
    expect(body.enabled_keys).toEqual([]);
    expect(body.available.find((p) => p.key === 'saloon-booking')).toBeDefined();
  });

  it('PUT replaces the enabled set', async () => {
    const r1 = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['saloon-booking'] }),
      }), CTX,
    );
    expect(r1.status).toBe(200);

    const r2 = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, { headers: { cookie } }),
      CTX,
    );
    const body = await r2.json() as { enabled_keys: string[] };
    expect(body.enabled_keys).toEqual(['saloon-booking']);
  });

  it('PUT with empty keys clears all enabled products', async () => {
    await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['saloon-booking'] }),
      }), CTX,
    );
    await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: [] }),
      }), CTX,
    );
    const r = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, { headers: { cookie } }),
      CTX,
    );
    const body = await r.json() as { enabled_keys: string[] };
    expect(body.enabled_keys).toEqual([]);
  });

  it('PUT rejects unknown Product keys with 400', async () => {
    const r = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['not-a-real-product'] }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('unknown_product_key');
  });

  it('GET without admin cookie returns 401', async () => {
    const r = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`),
      CTX,
    );
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm test -- --run tests/integration/admin-client-products.test.ts`
Expected: FAIL (handler does not exist).

- [ ] **Step 3: Implement endpoint**

```ts
// netlify/functions/admin-client-products.ts
//
// GET    ?client=<id>  → { enabled_keys: string[], available: ProductManifest[] }
// PUT    ?client=<id>  body { keys: string[] } → replaces the enabled set
//
// Admin-only. PUT validates each key against the productRegistry — unknown
// keys reject the whole request (no partial writes). The replacement is
// transactional: delete-all + insert-many in one statement burst.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { allProducts, getProduct } from '../../src/modules/registry/products';

const PutBody = z.object({ keys: z.array(z.string().min(1).max(80)).max(64) });

export default async (req: Request, _ctx: Context) => {
  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT product_key FROM public.client_enabled_products
      WHERE client_id = ${clientId}::uuid
      ORDER BY product_key
    `) as { product_key: string }[];
    return jsonOk({
      enabled_keys: rows.map((r) => r.product_key),
      available: allProducts().map((p) => ({ key: p.key, label: p.label })),
    });
  }

  if (req.method === 'PUT') {
    const parsed = PutBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    for (const key of parsed.data.keys) {
      if (!getProduct(key)) return jsonError(400, 'unknown_product_key', { key });
    }
    await sql.transaction([
      sql`DELETE FROM public.client_enabled_products WHERE client_id = ${clientId}::uuid`,
      ...parsed.data.keys.map((key) => sql`
        INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
        VALUES (${clientId}::uuid, ${key}, ${actor.admin.id}::uuid)
      `),
    ]);
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --run tests/integration/admin-client-products.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run full suite**

Run: `npm test -- --run`
Expected: 0 regressions.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/admin-client-products.ts tests/integration/admin-client-products.test.ts
git commit -m "feat(admin): /api/admin-client-products GET + PUT"
```

## Task A6: Admin UI — Products section in client detail

**Files:**
- Modify: `src/modules/ams/api.ts` — add API client wrappers.
- Create: `src/modules/admin/components/ClientProductsSection.tsx`
- Modify: a Client-detail page to include the section (find via `grep -rn "client-detail\|ClientDetail\|/clients/:" src/modules/admin`).

- [ ] **Step 1: Add API client wrappers**

Append to `src/modules/ams/api.ts`:

```ts
// ─── Admin: enabled Products per Client ────────────────────────────

export interface ProductAvailable { key: string; label: string }

export interface AdminClientProductsResponse {
  enabled_keys: string[];
  available: ProductAvailable[];
}

export const getAdminClientProducts = (clientId: string) =>
  apiFetch<AdminClientProductsResponse>(`/api/admin-client-products?client=${encodeURIComponent(clientId)}`);

export const putAdminClientProducts = (clientId: string, keys: string[]) =>
  apiFetch<{ ok: true }>(`/api/admin-client-products?client=${encodeURIComponent(clientId)}`, {
    method: 'PUT', body: JSON.stringify({ keys }),
  });
```

- [ ] **Step 2: Write the section component**

```tsx
// src/modules/admin/components/ClientProductsSection.tsx
//
// Shown on the Admin's view of a Client. Lists every Product available in
// the registry; checked = enabled for this Client. PUT replaces the whole
// set, so changes are atomic and clients can't end up in a half-saved
// state if the user closes the browser mid-edit.

import { useEffect, useState } from 'react';
import {
  getAdminClientProducts, putAdminClientProducts,
  type ProductAvailable,
} from '../../ams/api';

interface Props { clientId: string }

export function ClientProductsSection({ clientId }: Props) {
  const [available, setAvailable] = useState<ProductAvailable[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      const r = await getAdminClientProducts(clientId);
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) { setError(`Failed (${r.error.code})`); return; }
      setAvailable(r.data.available);
      setEnabled(new Set(r.data.enabled_keys));
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  function toggle(key: string) {
    const next = new Set(enabled);
    if (next.has(key)) next.delete(key); else next.add(key);
    setEnabled(next);
  }

  async function save() {
    setSaving(true); setError(null);
    const r = await putAdminClientProducts(clientId, Array.from(enabled));
    setSaving(false);
    if (!r.ok) { setError(`Save failed (${r.error.code})`); return; }
  }

  if (loading) return <p className="muted">Loading Products…</p>;

  return (
    <section style={{ marginTop: 24, padding: 16, border: '1px solid var(--border-subtle, #2a2a2a)', borderRadius: 6 }}>
      <h3 style={{ marginTop: 0 }}>Products</h3>
      <p className="muted" style={{ fontSize: 12 }}>
        Toggle which Products this Client has access to. Drives which Modules
        appear in their Access Level Dashboard.
      </p>
      {error && <p className="error">{error}</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {available.map((p) => (
          <li key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <input
              type="checkbox"
              id={`product-${p.key}`}
              checked={enabled.has(p.key)}
              onChange={() => toggle(p.key)}
              disabled={saving}
            />
            <label htmlFor={`product-${p.key}`} style={{ cursor: 'pointer' }}>
              {p.label} <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{p.key}</span>
            </label>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </section>
  );
}
```

- [ ] **Step 3: Mount the component**

Find the Client-detail page: `grep -rn "useParams.*clientId\\|clients/:clientId" src/modules/admin src/modules/ams src/App.tsx`. Pick the admin-side Client-detail page (NOT `AccessDashboard`, which is the per-Client user-tree view). Add at the bottom of its JSX:

```tsx
import { ClientProductsSection } from '../admin/components/ClientProductsSection';
// ...
{clientId && <ClientProductsSection clientId={clientId} />}
```

If there is no Admin Client-detail page yet (the routes go straight from Client list to AccessDashboard), add it to the bottom of `AccessDashboard.tsx` instead, gated by `useAuth().admin` so bucket-users never see it. Note the choice in the commit message so reviewers know which path was taken.

- [ ] **Step 4: Manual smoke**

Dev server is running at `http://localhost:8888`. Open any Client in the Admin UI, scroll to the new "Products" section, toggle Saloon Booking on, click Save, refresh — should persist.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Full suite**

Run: `npm test -- --run`
Expected: 0 regressions.

- [ ] **Step 7: Commit**

```bash
git add src/modules/ams/api.ts src/modules/admin/components/ClientProductsSection.tsx <client-detail-file>
git commit -m "feat(admin): ClientProductsSection UI for enabling Products per Client"
```

---

# Phase B — Permissions JSONB + Access Level Dashboard

Goal: Persist a per-Level permission matrix derived from the Client's enabled Products. Primary configures via the new Access Level Dashboard. No enforcement yet (that's Phase C).

## Task B1: Migration 021 — `client_levels.permissions JSONB`

**Files:**
- Create: `db/migrations/021_client_levels_permissions.sql`

- [ ] **Step 1: Write migration**

```sql
ALTER TABLE public.client_levels
  ADD COLUMN permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Sparse map of '<module>.<bucket>.<verb>' or '_platform.<surface>.<verb>'
-- → true. Missing keys default to false. The matrix is server-validated
-- against the active Module manifests on PUT; see client-levels-permissions.
```

- [ ] **Step 2: Apply migration**

Run: `npm run migrate`
Expected: `→ applying 021_client_levels_permissions (1 statement)` then `✓`.

- [ ] **Step 3: Verify column exists**

Use the same one-liner from Task A4 Step 3, replacing `client_enabled_products` with `client_levels`. Expect a `permissions jsonb` column.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/021_client_levels_permissions.sql
git commit -m "feat(db): migration 021 — client_levels.permissions JSONB"
```

## Task B2: Permission key validator

**Files:**
- Create: `netlify/functions/_shared/permission-keys.ts`
- Test: append to `tests/unit/registry.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tests/unit/registry.test.ts`:

```ts
import {
  isValidPermissionKey,
  splitPermissionKey,
} from '../../netlify/functions/_shared/permission-keys';

describe('permission keys', () => {
  it('accepts platform keys', () => {
    expect(isValidPermissionKey('_platform.users.view', ['saloon-booking'])).toBe(true);
    expect(isValidPermissionKey('_platform.structure.edit', [])).toBe(true);
    expect(isValidPermissionKey('_platform.settings.delete', [])).toBe(true);
  });

  it('rejects platform keys with unknown surface', () => {
    expect(isValidPermissionKey('_platform.bogus.view', [])).toBe(false);
  });

  it('rejects platform keys with unknown verb', () => {
    expect(isValidPermissionKey('_platform.users.fly', [])).toBe(false);
  });

  it('accepts module keys whose module is enabled via enabled Products', () => {
    expect(isValidPermissionKey('booking.customers.view', ['saloon-booking'])).toBe(true);
    expect(isValidPermissionKey('payments.products.edit', ['saloon-booking'])).toBe(true);
  });

  it('rejects module keys whose module is NOT enabled', () => {
    expect(isValidPermissionKey('booking.customers.view', [])).toBe(false);
  });

  it('rejects module keys whose verb is not declared in the manifest', () => {
    // payments manifest omits 'delete'.
    expect(isValidPermissionKey('payments.customers.delete', ['saloon-booking'])).toBe(false);
  });

  it('rejects module keys whose bucket is not declared in the manifest', () => {
    // booking manifest declares customers + employees, not products.
    expect(isValidPermissionKey('booking.products.view', ['saloon-booking'])).toBe(false);
  });

  it('splits a valid module key', () => {
    expect(splitPermissionKey('booking.customers.view')).toEqual({
      scope: 'module', module: 'booking', bucket: 'customers', verb: 'view',
    });
  });

  it('splits a valid platform key', () => {
    expect(splitPermissionKey('_platform.users.edit')).toEqual({
      scope: 'platform', surface: 'users', verb: 'edit',
    });
  });

  it('returns null for malformed keys', () => {
    expect(splitPermissionKey('nope')).toBeNull();
    expect(splitPermissionKey('a.b')).toBeNull();
    expect(splitPermissionKey('a.b.c.d')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm test -- --run tests/unit/registry.test.ts`
Expected: FAIL (permission-keys does not exist).

- [ ] **Step 3: Implement validator**

```ts
// netlify/functions/_shared/permission-keys.ts
//
// Used by:
//   - PUT /api/client-levels-permissions to reject unknown / forbidden keys,
//   - requirePermission middleware to parse the key into (module, bucket, verb)
//     before looking it up in the matrix.

import {
  VERBS, PLATFORM_SURFACES, type Verb, type DataBucket, type PlatformSurface,
} from '../../../src/modules/registry/types';
import { getModule } from '../../../src/modules/registry/modules';
import { getProduct } from '../../../src/modules/registry/products';

export type ParsedPermissionKey =
  | { scope: 'module'; module: string; bucket: DataBucket; verb: Verb }
  | { scope: 'platform'; surface: PlatformSurface; verb: Verb };

export function splitPermissionKey(key: string): ParsedPermissionKey | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  const [head, mid, verb] = parts as [string, string, string];
  if (!(VERBS as readonly string[]).includes(verb)) return null;

  if (head === '_platform') {
    if (!(PLATFORM_SURFACES as readonly string[]).includes(mid)) return null;
    return { scope: 'platform', surface: mid as PlatformSurface, verb: verb as Verb };
  }
  // Module-scoped key. We don't validate module/bucket existence here — that's
  // the caller's job (isValidPermissionKey). split is purely structural.
  return { scope: 'module', module: head, bucket: mid as DataBucket, verb: verb as Verb };
}

/**
 * Returns true if the key is structurally valid AND, for module-scoped keys,
 * the module is enabled by the given Product keys AND the bucket/verb appear
 * in the module's manifest.
 */
export function isValidPermissionKey(key: string, enabledProductKeys: readonly string[]): boolean {
  const parsed = splitPermissionKey(key);
  if (!parsed) return false;
  if (parsed.scope === 'platform') return true; // surface + verb already vetted by split

  const module = getModule(parsed.module);
  if (!module) return false;

  // Module must be brought in by at least one enabled Product.
  const enabled = new Set<string>();
  for (const pKey of enabledProductKeys) {
    const product = getProduct(pKey);
    if (!product) continue;
    for (const ref of product.modules) enabled.add(ref.module);
  }
  if (!enabled.has(module.key)) return false;

  if (!module.data_buckets.includes(parsed.bucket)) return false;
  if (!module.verbs.includes(parsed.verb)) return false;
  return true;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --run tests/unit/registry.test.ts`
Expected: PASS (all original + 10 new).

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npm test -- --run`
Expected: clean + 0 regressions.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/permission-keys.ts tests/unit/registry.test.ts
git commit -m "feat(permissions): permission-key validator + splitter"
```

## Task B3: API — GET/PUT level permissions

**Files:**
- Create: `netlify/functions/client-levels-permissions.ts`
- Test: `tests/integration/client-levels-permissions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/client-levels-permissions.test.ts
vi.mock('../../netlify/functions/_shared/google-verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import clientRolesHandler from '../../netlify/functions/client-roles';
import adminClientProductsHandler from '../../netlify/functions/admin-client-products';
import clientLevelsPermissionsHandler from '../../netlify/functions/client-levels-permissions';

const ADMIN_EMAIL = 'clp-test@example.com';
const ADMIN_PASSWORD = 'clp-test-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let clientId: string;
let l2Id: string;
const created: string[] = [];

async function setupClientWithLevel2(): Promise<{ clientId: string; l2Id: string }> {
  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `CLP Test ${Date.now()}` }),
    }), CTX,
  );
  const cid = ((await cr.json()) as { client: { id: string } }).client.id;
  const rr = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${cid}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'staff', label: 'Staff', color: '#888' }),
    }), CTX,
  );
  const roleId = ((await rr.json()) as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${cid}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ level_number: 1, allowed_role_ids: [roleId] }),
  }), CTX);
  const l2r = await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${cid}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ level_number: 2, allowed_role_ids: [roleId] }),
  }), CTX);
  const l2 = ((await l2r.json()) as { level: { id: string } }).level.id;
  return { clientId: cid, l2Id: l2 };
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'CLP Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  cookie = lr.headers.get('set-cookie')!.split(';')[0]!;
  const setup = await setupClientWithLevel2();
  clientId = setup.clientId;
  l2Id = setup.l2Id;
  created.push(clientId);
});

afterAll(async () => {
  for (const id of created) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('client-levels-permissions', () => {
  it('GET on a fresh L2 returns empty matrix + only platform rows when no Products are enabled', async () => {
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, { headers: { cookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      permissions: Record<string, true>;
      module_rows: Array<{ module_key: string; bucket: string; verbs: string[] }>;
      platform_rows: Array<{ surface: string; verbs: string[] }>;
    };
    expect(body.permissions).toEqual({});
    expect(body.module_rows).toEqual([]);
    expect(body.platform_rows.map((r) => r.surface).sort()).toEqual(['settings', 'structure', 'users']);
  });

  it('GET after enabling saloon-booking returns booking + payments rows', async () => {
    await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['saloon-booking'] }),
      }), CTX,
    );
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, { headers: { cookie } }),
      CTX,
    );
    const body = await r.json() as { module_rows: Array<{ module_key: string; bucket: string }> };
    const keys = body.module_rows.map((r) => `${r.module_key}.${r.bucket}`).sort();
    expect(keys).toEqual(['booking.customers', 'booking.employees', 'payments.customers', 'payments.products']);
  });

  it('PUT replaces the matrix (full replace, not merge)', async () => {
    await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['saloon-booking'] }),
      }), CTX,
    );
    await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { 'booking.customers.view': true, '_platform.users.view': true } }),
      }), CTX,
    );
    await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { '_platform.structure.view': true } }),
      }), CTX,
    );
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, { headers: { cookie } }),
      CTX,
    );
    const body = await r.json() as { permissions: Record<string, true> };
    expect(body.permissions).toEqual({ '_platform.structure.view': true });
  });

  it('PUT rejects keys that reference Modules not enabled by current Products', async () => {
    // No Products enabled — booking.* should be rejected.
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { 'booking.customers.view': true } }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string; details: { key: string } } };
    expect(body.error.code).toBe('invalid_permission_key');
    expect(body.error.details.key).toBe('booking.customers.view');
  });

  it('PUT rejects platform keys with unknown surface', async () => {
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { '_platform.bogus.view': true } }),
      }), CTX,
    );
    expect(r.status).toBe(400);
  });

  it('PUT on L1 (Primary) returns 409 — Primary is implicit all-on', async () => {
    const lr = (await sql`SELECT id FROM public.client_levels WHERE client_id = ${clientId} AND level_number = 1`) as { id: string }[];
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${lr[0]!.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { '_platform.users.view': true } }),
      }), CTX,
    );
    expect(r.status).toBe(409);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('primary_level_immutable');
  });
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm test -- --run tests/integration/client-levels-permissions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement endpoint**

```ts
// netlify/functions/client-levels-permissions.ts
//
// GET ?id=<level_id> → {
//   permissions: Record<PermissionKey, true>,
//   module_rows: Array<{ module_key, label, bucket, verbs: Verb[] }>,
//   platform_rows: Array<{ surface, verbs: Verb[] }>,
// }
// PUT ?id=<level_id> body { permissions: Record<PermissionKey, true> }
//   → replaces the whole matrix; validates every key.
//
// L1 (Primary) is conceptually always all-on and rejects PUT with 409.
// Auth: admin only for now. Phase C migrates this to requirePermission
// once the middleware exists.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { isValidPermissionKey } from './_shared/permission-keys';
import {
  VERBS, PLATFORM_SURFACES, type Verb, type PlatformSurface,
} from '../../src/modules/registry/types';
import { derivePermissionRows } from '../../src/modules/registry/products';

const PutBody = z.object({
  permissions: z.record(z.literal(true)),
});

type LevelRow = { id: string; client_id: string; level_number: number; permissions: Record<string, true> };

export default async (req: Request, _ctx: Context) => {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const levelId = url.searchParams.get('id');
  if (!levelId) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(levelId, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const sql = db();
  const levels = (await sql`
    SELECT id, client_id, level_number, permissions
    FROM public.client_levels WHERE id = ${levelId}::uuid LIMIT 1
  `) as LevelRow[];
  if (levels.length === 0) return jsonError(404, 'level_not_found');
  const level = levels[0]!;

  const enabledRows = (await sql`
    SELECT product_key FROM public.client_enabled_products
    WHERE client_id = ${level.client_id}::uuid
  `) as { product_key: string }[];
  const enabledKeys = enabledRows.map((r) => r.product_key);

  if (req.method === 'GET') {
    const moduleRows = derivePermissionRows(enabledKeys).map((r) => ({
      module_key: r.module.key,
      label: r.module.label,
      bucket: r.bucket,
      verbs: r.module.verbs as readonly Verb[],
    }));
    const platformRows = (PLATFORM_SURFACES as readonly PlatformSurface[]).map((s) => ({
      surface: s,
      verbs: VERBS as readonly Verb[],
    }));
    return jsonOk({
      level_id: level.id,
      level_number: level.level_number,
      permissions: level.permissions,
      module_rows: moduleRows,
      platform_rows: platformRows,
    });
  }

  if (req.method === 'PUT') {
    if (level.level_number === 1) return jsonError(409, 'primary_level_immutable');
    const parsed = PutBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    for (const key of Object.keys(parsed.data.permissions)) {
      if (!isValidPermissionKey(key, enabledKeys)) {
        return jsonError(400, 'invalid_permission_key', { key });
      }
    }
    await sql`
      UPDATE public.client_levels
      SET permissions = ${JSON.stringify(parsed.data.permissions)}::jsonb
      WHERE id = ${levelId}::uuid
    `;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --run tests/integration/client-levels-permissions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npm test -- --run`
Expected: clean + 0 regressions.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/client-levels-permissions.ts tests/integration/client-levels-permissions.test.ts
git commit -m "feat(permissions): /api/client-levels-permissions GET + PUT"
```

## Task B4: Access Level Dashboard UI

**Files:**
- Modify: `src/modules/ams/api.ts` — wrappers.
- Create: `src/modules/ams/components/PermissionMatrixCard.tsx`
- Create: `src/modules/ams/pages/AccessLevelDashboard.tsx`
- Modify: `src/modules/ams/pages/AccessDashboard.tsx` — header link.
- Modify: `src/App.tsx` (or wherever routes live) — new route.

- [ ] **Step 1: Add API client wrappers**

Append to `src/modules/ams/api.ts`:

```ts
// ─── Access Level permissions ──────────────────────────────────────

export interface ModuleRow {
  module_key: string;
  label: string;
  bucket: string;
  verbs: string[];
}

export interface PlatformRow { surface: string; verbs: string[] }

export interface LevelPermissionsResponse {
  level_id: string;
  level_number: number;
  permissions: Record<string, true>;
  module_rows: ModuleRow[];
  platform_rows: PlatformRow[];
}

export const getLevelPermissions = (levelId: string) =>
  apiFetch<LevelPermissionsResponse>(`/api/client-levels-permissions?id=${encodeURIComponent(levelId)}`);

export const putLevelPermissions = (levelId: string, permissions: Record<string, true>) =>
  apiFetch<{ ok: true }>(`/api/client-levels-permissions?id=${encodeURIComponent(levelId)}`, {
    method: 'PUT', body: JSON.stringify({ permissions }),
  });
```

- [ ] **Step 2: Write PermissionMatrixCard component**

```tsx
// src/modules/ams/components/PermissionMatrixCard.tsx
//
// One Level's permission card: Modules grid (auto-generated from the
// active Products' Modules × their DataBuckets) plus a fixed Platform
// grid. Save replaces the entire JSONB matrix server-side.

import { useState } from 'react';
import {
  putLevelPermissions,
  type LevelPermissionsResponse, type ModuleRow, type PlatformRow,
} from '../api';

interface Props {
  data: LevelPermissionsResponse;
  levelLabel: string;
  onSaved: () => void;
}

export function PermissionMatrixCard({ data, levelLabel, onSaved }: Props) {
  const [perms, setPerms] = useState<Record<string, true>>(data.permissions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function isOn(key: string) { return Boolean(perms[key]); }

  function toggle(key: string) {
    const next = { ...perms };
    if (next[key]) delete next[key]; else next[key] = true;
    setPerms(next);
  }

  async function save() {
    setSaving(true); setError(null);
    const r = await putLevelPermissions(data.level_id, perms);
    setSaving(false);
    if (!r.ok) {
      setError(r.error.code === 'invalid_permission_key'
        ? `Invalid key: ${(r.error.details as { key: string }).key}`
        : `Save failed (${r.error.code})`);
      return;
    }
    onSaved();
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{levelLabel}</h3>
        <span className="muted" style={{ fontSize: 12 }}>Level {data.level_number}</span>
      </header>

      {data.module_rows.length === 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          No Modules enabled yet — toggle Products on the Admin page first.
        </p>
      )}

      {data.module_rows.length > 0 && (
        <table style={{ width: '100%', fontSize: 13, marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Module × Data</th>
              <th>View</th><th>Create</th><th>Edit</th><th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {data.module_rows.map((row: ModuleRow) => (
              <tr key={`${row.module_key}.${row.bucket}`}>
                <td>{row.label} <span className="muted">— {row.bucket}</span></td>
                {(['view', 'create', 'edit', 'delete'] as const).map((v) => {
                  const supported = row.verbs.includes(v);
                  const key = `${row.module_key}.${row.bucket}.${v}`;
                  return (
                    <td key={v} style={{ textAlign: 'center' }}>
                      {supported ? (
                        <input type="checkbox" checked={isOn(key)} onChange={() => toggle(key)} disabled={saving} />
                      ) : <span className="muted">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 style={{ marginTop: 8, marginBottom: 6, fontSize: 13 }}>Platform</h4>
      <table style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Surface</th>
            <th>View</th><th>Create</th><th>Edit</th><th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {data.platform_rows.map((row: PlatformRow) => (
            <tr key={row.surface}>
              <td>{row.surface}</td>
              {(['view', 'create', 'edit', 'delete'] as const).map((v) => {
                const key = `_platform.${row.surface}.${v}`;
                return (
                  <td key={v} style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={isOn(key)} onChange={() => toggle(key)} disabled={saving} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write the AccessLevelDashboard page**

```tsx
// src/modules/ams/pages/AccessLevelDashboard.tsx
//
// Primary's view: a card per Level (≥ L2). L1 (Primary) is shown as a
// read-only "Full access" banner. Default labels Primary/Secondary/...
// are shown when the Client hasn't set a custom label.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClientStructureProvider, useClientStructure } from '../components/ClientStructureContext';
import { getLevelPermissions, type LevelPermissionsResponse } from '../api';
import { PermissionMatrixCard } from '../components/PermissionMatrixCard';

const DEFAULT_LABELS = ['Primary', 'Secondary', 'Tertiary', 'Quaternary', 'Quinary', 'Senary', 'Septenary'];

export default function AccessLevelDashboard() {
  const { clientId } = useParams<{ clientId: string }>();
  if (!clientId) return <p className="error">Invalid URL.</p>;
  return (
    <ClientStructureProvider clientId={clientId}>
      <Inner clientId={clientId} />
    </ClientStructureProvider>
  );
}

function Inner({ clientId }: { clientId: string }) {
  const { structure, loading: structLoading } = useClientStructure();
  const [perLevel, setPerLevel] = useState<Record<string, LevelPermissionsResponse>>({});
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!structure) return;
    setLoading(true);
    const out: Record<string, LevelPermissionsResponse> = {};
    for (const lvl of structure.levels) {
      const r = await getLevelPermissions(lvl.id);
      if (r.ok) out[lvl.id] = r.data;
    }
    setPerLevel(out);
    setLoading(false);
  }

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [structure]);

  if (structLoading || loading) return <p className="muted">Loading…</p>;
  if (!structure) return null;

  return (
    <section>
      <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Access Level Dashboard</h1>
        <Link to={`/clients/${clientId}`} className="btn btn-secondary">← Back</Link>
      </header>
      <p className="muted" style={{ marginBottom: 16 }}>
        Configure what each Level can do. Primary (Level 1) always has full access.
      </p>

      {structure.levels.map((lvl) => {
        const label = lvl.label ?? DEFAULT_LABELS[lvl.level_number - 1] ?? `Level ${lvl.level_number}`;
        if (lvl.level_number === 1) {
          return (
            <div key={lvl.id} className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>{label} <span className="muted" style={{ fontSize: 12 }}>Level 1 — Full access</span></h3>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                The Primary level always has every permission. To delegate, configure the levels below.
              </p>
            </div>
          );
        }
        const data = perLevel[lvl.id];
        if (!data) return null;
        return (
          <PermissionMatrixCard
            key={lvl.id}
            data={data}
            levelLabel={label}
            onSaved={refresh}
          />
        );
      })}
    </section>
  );
}
```

- [ ] **Step 4: Add route**

Find the route table (`grep -rn "Route\|createBrowserRouter" src/App.tsx src/main.tsx src/routes`). Add:

```tsx
import AccessLevelDashboard from './modules/ams/pages/AccessLevelDashboard';
// ...
<Route path="/clients/:clientId/access-levels" element={<AccessLevelDashboard />} />
```

- [ ] **Step 5: Add header link on AccessDashboard**

In `src/modules/ams/pages/AccessDashboard.tsx`, the header section already has Configure + Add user buttons. Add a third link before Configure:

```tsx
<Link to={`/clients/${clientId}/access-levels`} className="btn btn-secondary">Access levels</Link>
```

- [ ] **Step 6: Manual smoke**

On the dev server: open a client, click "Access levels", confirm Primary card is read-only, Secondary card renders with the Platform grid (and Modules grid if a Product was enabled in Phase A). Toggle a checkbox, Save, refresh — should persist.

- [ ] **Step 7: Typecheck + full suite**

Run: `npm run typecheck && npm test -- --run`

- [ ] **Step 8: Commit**

```bash
git add src/modules/ams/api.ts \
        src/modules/ams/components/PermissionMatrixCard.tsx \
        src/modules/ams/pages/AccessLevelDashboard.tsx \
        src/modules/ams/pages/AccessDashboard.tsx \
        src/App.tsx
git commit -m "feat(permissions): Access Level Dashboard UI"
```

---

# Phase C — `bucket_family` + middleware

Goal: Land the Role↔DataBucket mapping and the server-side `requirePermission` middleware. Stop short of per-endpoint retrofit — that happens incrementally per Module in follow-up work.

## Task C1: Migration 022 — `client_roles.bucket_family`

**Files:**
- Create: `db/migrations/022_client_roles_bucket_family.sql`

- [ ] **Step 1: Write migration**

```sql
ALTER TABLE public.client_roles
  ADD COLUMN bucket_family TEXT
  CHECK (bucket_family IS NULL OR bucket_family IN ('business', 'employees', 'customers', 'products'));
-- Optional mapping from a Client's custom Role to an abstract DataBucket.
-- NULL means "treat as employees" — sensible default for staff-shaped roles.
```

- [ ] **Step 2: Apply migration**

Run: `npm run migrate`
Expected: `✓ 022_client_roles_bucket_family`.

- [ ] **Step 3: Verify constraint**

Use the same one-liner from Task A4 Step 3 against `client_roles`. Expect `bucket_family text`.

Sanity-test the CHECK constraint:
```bash
node -e "/* same env loader */ const sql = neon(URL); await sql\`INSERT INTO client_roles (id, client_id, key, label, bucket_family) VALUES (gen_random_uuid(), gen_random_uuid(), 'k', 'l', 'invalid')\`"
```
Expected: error `new row violates check constraint`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/022_client_roles_bucket_family.sql
git commit -m "feat(db): migration 022 — client_roles.bucket_family"
```

## Task C2: Surface `bucket_family` through API + UI

**Files:**
- Modify: `netlify/functions/client-roles.ts` — accept on POST/PUT.
- Modify: `netlify/functions/user-nodes.ts` and any other join — add `bucket_family` to SELECT for downstream use.
- Modify: `src/modules/ams/api.ts` — extend `ClientRole`.
- Modify: `src/modules/ams/pages/ConfigureStructure.tsx` — dropdown per Role.
- Test: append to existing role-CRUD test if present; otherwise add to `tests/integration/user-node-auth.test.ts`.

- [ ] **Step 1: Find the role-CRUD endpoint**

Run: `grep -n "POST\\|PUT\\|bucket_family\\|export default" netlify/functions/client-roles.ts | head -20`

Note the existing INSERT and UPDATE column lists so the new column is added in the right place.

- [ ] **Step 2: Write failing test**

Append to `tests/integration/user-node-auth.test.ts`:

```ts
test('client-roles POST accepts and persists bucket_family', async () => {
  const r = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'patient', label: 'Patient', color: '#a55', bucket_family: 'customers' }),
    }), CTX,
  );
  expect(r.status).toBe(201);
  const body = await r.json() as { role: { id: string; bucket_family: string | null } };
  expect(body.role.bucket_family).toBe('customers');
});

test('client-roles POST rejects invalid bucket_family with 400', async () => {
  const r = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'p', label: 'P', color: '#aaa', bucket_family: 'bogus' }),
    }), CTX,
  );
  expect(r.status).toBe(400);
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npm test -- --run tests/integration/user-node-auth.test.ts -t bucket_family`
Expected: FAIL.

- [ ] **Step 4: Extend the role-CRUD endpoint**

In `netlify/functions/client-roles.ts`, locate the POST body schema (likely a Zod object). Add:

```ts
bucket_family: z.enum(['business', 'employees', 'customers', 'products']).optional(),
```

Add `bucket_family` to the INSERT column list and value list. Add it to the SELECT used by GET. Same for PUT if present.

If the endpoint returns a `role` object, ensure `bucket_family` is included in the SELECT that builds the response.

- [ ] **Step 5: Add to the TS type**

In `src/modules/ams/api.ts`, find `interface ClientRole`. Add:

```ts
bucket_family?: 'business' | 'employees' | 'customers' | 'products' | null;
```

Update any create/patch helpers to accept it.

- [ ] **Step 6: Add to the Configure UI**

In `src/modules/ams/pages/ConfigureStructure.tsx`, find the Role create/edit form. Add a dropdown:

```tsx
<label>Bucket family
  <select
    value={bucketFamily ?? ''}
    onChange={(e) => setBucketFamily(e.target.value === '' ? null : e.target.value as 'business' | 'employees' | 'customers' | 'products')}
  >
    <option value="">— (employees, default)</option>
    <option value="employees">Employees</option>
    <option value="customers">Customers</option>
    <option value="products">Products</option>
    <option value="business">Business</option>
  </select>
</label>
```

Hook `bucketFamily` state into the existing `useState` block + into the create/patch payload.

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test -- --run && npm run typecheck`
Expected: all pass, clean.

- [ ] **Step 8: Commit**

```bash
git add netlify/functions/client-roles.ts \
        src/modules/ams/api.ts \
        src/modules/ams/pages/ConfigureStructure.tsx \
        tests/integration/user-node-auth.test.ts
git commit -m "feat(roles): bucket_family column wired through API + Configure UI"
```

## Task C3: `subtreeOf` helper

**Files:**
- Create: `netlify/functions/_shared/subtree.ts`
- Test: `tests/integration/permissions-middleware.test.ts` (started here, expanded in C4).

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/permissions-middleware.test.ts
vi.mock('../../netlify/functions/_shared/google-verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import userNodesHandler from '../../netlify/functions/user-nodes';
import { subtreeOf } from '../../netlify/functions/_shared/subtree';

const ADMIN_EMAIL = 'pmw-test@example.com';
const ADMIN_PASSWORD = 'pmw-test-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let testClientId: string;
let roleId: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'PMW Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  cookie = lr.headers.get('set-cookie')!.split(';')[0]!;
  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `PMW Test ${Date.now()}` }),
    }), CTX,
  );
  testClientId = ((await cr.json()) as { client: { id: string } }).client.id;
  created.push(testClientId);
  const rr = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'staff', label: 'Staff', color: '#888' }),
    }), CTX,
  );
  roleId = ((await rr.json()) as { role: { id: string } }).role.id;
  for (const lvl of [1, 2, 3]) {
    await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: lvl, allowed_role_ids: [roleId] }),
    }), CTX);
  }
});

afterAll(async () => {
  for (const id of created) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

async function createNode(displayName: string, levelNumber: number, parentId: string | null): Promise<string> {
  const r = await userNodesHandler(
    new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        role_id: roleId, level_number: levelNumber, parent_id: parentId,
        display_name: displayName,
      }),
    }), CTX,
  );
  return ((await r.json()) as { node: { id: string } }).node.id;
}

describe('subtreeOf', () => {
  it('returns just the root for a leaf node', async () => {
    const l1 = await createNode('A', 1, null);
    const ids = await subtreeOf(sql, l1);
    expect(ids).toEqual([l1]);
  });

  it('returns root + all descendants for a multi-level tree', async () => {
    const l1 = await createNode('A', 1, null);
    const l2a = await createNode('A.1', 2, l1);
    const l2b = await createNode('A.2', 2, l1);
    const l3 = await createNode('A.1.1', 3, l2a);
    const ids = (await subtreeOf(sql, l1)).sort();
    expect(ids).toEqual([l1, l2a, l2b, l3].sort());
  });

  it('does not cross siblings', async () => {
    const l1a = await createNode('A', 1, null);
    const l1b = await createNode('B', 1, null);
    const l2b = await createNode('B.1', 2, l1b);
    const ids = await subtreeOf(sql, l1a);
    expect(ids).not.toContain(l1b);
    expect(ids).not.toContain(l2b);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- --run tests/integration/permissions-middleware.test.ts`
Expected: FAIL (subtree.ts does not exist).

- [ ] **Step 3: Implement subtreeOf**

```ts
// netlify/functions/_shared/subtree.ts
//
// Returns the user_node ids in the subtree rooted at `rootId`, inclusive.
// Implemented as a recursive CTE — single round-trip regardless of depth.
// Used by every endpoint that needs subtree-scoped filtering for the
// 'customers' or 'employees' Data Buckets.

import type { NeonQueryFunction } from '@neondatabase/serverless';

type SQL = NeonQueryFunction<false, false>;

export async function subtreeOf(sql: SQL, rootId: string): Promise<string[]> {
  const rows = (await sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM public.user_nodes WHERE id = ${rootId}::uuid
      UNION ALL
      SELECT n.id FROM public.user_nodes n
      JOIN descendants d ON n.parent_id = d.id
    )
    SELECT id FROM descendants
  `) as { id: string }[];
  return rows.map((r) => r.id);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --run tests/integration/permissions-middleware.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/subtree.ts tests/integration/permissions-middleware.test.ts
git commit -m "feat(permissions): subtreeOf helper via recursive CTE"
```

## Task C4: `requirePermission` middleware

**Files:**
- Modify: `netlify/functions/_shared/permissions.ts` — add `requirePermission` + `getLevelMatrix`.
- Test: append to `tests/integration/permissions-middleware.test.ts`.

- [ ] **Step 1: Read the existing permissions module**

Run: `cat netlify/functions/_shared/permissions.ts | head -60`

Note the existing `requireAdmin`, the session-lookup pattern, and the `UnauthorizedError` class. The new code reuses the bucket-user session lookup that's already there.

- [ ] **Step 2: Write failing tests**

Append to `tests/integration/permissions-middleware.test.ts`:

```ts
import {
  requirePermission, ForbiddenError, UnauthorizedError,
} from '../../netlify/functions/_shared/permissions';
import userNodesHandler2 from '../../netlify/functions/user-nodes';
import uLoginHandler from '../../netlify/functions/u-login';

async function createUserWithLogin(displayName: string, levelNumber: number, parentId: string | null, email: string, password: string): Promise<{ nodeId: string }> {
  const r = await userNodesHandler2(
    new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        role_id: roleId, level_number: levelNumber, parent_id: parentId,
        display_name: displayName, email,
        create_login: true, temp_password: password,
      }),
    }), CTX,
  );
  return { nodeId: ((await r.json()) as { node: { id: string } }).node.id };
}

async function buCookieFor(email: string, password: string): Promise<string> {
  const r = await uLoginHandler(
    new Request(`http://localhost/api/u-login?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }), CTX,
  );
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

async function setL2Permissions(perms: Record<string, true>) {
  const l2 = (await sql`SELECT id FROM public.client_levels WHERE client_id = ${testClientId} AND level_number = 2`) as { id: string }[];
  await sql`UPDATE public.client_levels SET permissions = ${JSON.stringify(perms)}::jsonb WHERE id = ${l2[0]!.id}`;
}

describe('requirePermission', () => {
  it('allows the call when the matrix has the key', async () => {
    await createUserWithLogin('SecondaryA', 1, null, `sec-a-${Date.now()}@example.com`, 'secret-1234');
    const email = `sec-b-${Date.now()}@example.com`;
    await createUserWithLogin('SecondaryB', 2, null, email, 'secret-1234');
    const buCookie = await buCookieFor(email, 'secret-1234');
    await setL2Permissions({ '_platform.users.view': true });
    const req = new Request('http://localhost/test', { headers: { cookie: buCookie } });
    const session = await requirePermission(req, '_platform.users.view');
    expect(session.kind).toBe('bucket_user');
  });

  it('throws ForbiddenError when the matrix does NOT have the key', async () => {
    const email = `sec-c-${Date.now()}@example.com`;
    await createUserWithLogin('SecondaryC', 2, null, email, 'secret-1234');
    const buCookie = await buCookieFor(email, 'secret-1234');
    await setL2Permissions({}); // empty matrix
    const req = new Request('http://localhost/test', { headers: { cookie: buCookie } });
    await expect(requirePermission(req, '_platform.users.view')).rejects.toThrow(ForbiddenError);
  });

  it('Primary (L1) bypasses the matrix check', async () => {
    const email = `pri-${Date.now()}@example.com`;
    await createUserWithLogin('Primary1', 1, null, email, 'secret-1234');
    const buCookie = await buCookieFor(email, 'secret-1234');
    const req = new Request('http://localhost/test', { headers: { cookie: buCookie } });
    const session = await requirePermission(req, '_platform.structure.delete');
    expect(session.kind).toBe('bucket_user');
  });

  it('admin session bypasses the matrix check', async () => {
    const req = new Request('http://localhost/test', { headers: { cookie } });
    const session = await requirePermission(req, '_platform.users.delete');
    expect(session.kind).toBe('admin');
  });

  it('no session → UnauthorizedError', async () => {
    const req = new Request('http://localhost/test');
    await expect(requirePermission(req, '_platform.users.view')).rejects.toThrow(UnauthorizedError);
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `npm test -- --run tests/integration/permissions-middleware.test.ts -t requirePermission`
Expected: FAIL (requirePermission not exported).

- [ ] **Step 4: Implement middleware**

Open `netlify/functions/_shared/permissions.ts` and add:

```ts
import { db } from './db';
import { getBucketUserSession } from './session'; // adjust import if the actual export name differs

export class ForbiddenError extends Error {
  constructor(public key: string) { super(`forbidden: ${key}`); }
}

/**
 * Bucket-user session payload as already used by /api/u-me etc.
 * Adjust field names to match the actual session shape in this codebase.
 */
interface BucketUserSession {
  kind: 'bucket_user';
  user_node_id: string;
  client_id: string;
  level_number: number;
}

interface AdminSession {
  kind: 'admin';
  admin: { id: string; email: string };
}

export type AnySession = AdminSession | BucketUserSession;

async function getAnySession(req: Request): Promise<AnySession> {
  // Try admin first (admin cookie path). If absent, fall back to bucket-user.
  try {
    const a = await requireAdmin(req);
    return { kind: 'admin', admin: { id: a.admin.id, email: a.admin.email } };
  } catch { /* fall through */ }
  const bu = await getBucketUserSession(req); // existing helper from this file or session.ts
  if (!bu) throw new UnauthorizedError('no_session');
  return {
    kind: 'bucket_user',
    user_node_id: bu.user_node_id,
    client_id: bu.client_id,
    level_number: bu.level_number,
  };
}

async function getLevelMatrix(clientId: string, levelNumber: number): Promise<Record<string, true>> {
  const sql = db();
  const rows = (await sql`
    SELECT permissions FROM public.client_levels
    WHERE client_id = ${clientId}::uuid AND level_number = ${levelNumber}
    LIMIT 1
  `) as { permissions: Record<string, true> }[];
  return rows[0]?.permissions ?? {};
}

/**
 * Authorize a request for a specific PermissionKey.
 * - Admin sessions: always allowed.
 * - Bucket-user at level_number = 1 (Primary): always allowed.
 * - Bucket-user at level_number ≥ 2: matrix[key] must be true.
 *
 * Throws UnauthorizedError on no session, ForbiddenError on missing permission.
 * Returns the session on success so the caller can use it directly.
 */
export async function requirePermission(req: Request, key: string): Promise<AnySession> {
  const session = await getAnySession(req);
  if (session.kind === 'admin') return session;
  if (session.level_number === 1) return session;
  const matrix = await getLevelMatrix(session.client_id, session.level_number);
  if (!matrix[key]) throw new ForbiddenError(key);
  return session;
}
```

If the imports above don't match the actual exports in the codebase, search for the bucket-user session helper:

```bash
grep -rn "bu_session\|getBucketUserSession\|requireBucketUser" netlify/functions/_shared/
```

…and adjust the import + the `bu.user_node_id` / `bu.client_id` / `bu.level_number` field accesses to whatever the existing session payload exposes. If `level_number` isn't on the session yet, look it up via SQL alongside `getLevelMatrix`.

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- --run tests/integration/permissions-middleware.test.ts`
Expected: PASS (8 tests total: 3 subtree + 5 requirePermission).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm run typecheck && npm test -- --run`
Expected: clean + 0 regressions.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/_shared/permissions.ts tests/integration/permissions-middleware.test.ts
git commit -m "feat(permissions): requirePermission middleware + getLevelMatrix"
```

## Task C5: Documentation + plan close-out

**Files:**
- Modify: `README.md` or wherever the auth model is documented — add a short "Access levels" section.
- Modify: `docs/superpowers/specs/2026-06-01-access-levels-design.md` — flip status from `Draft` to `Implemented (Phase A–C)`.

- [ ] **Step 1: Update spec status**

In the spec frontmatter, change:
```
**Status:** Draft for review
```
to:
```
**Status:** Implemented (Phases A–C). Endpoint retrofit deferred per-Module.
```

- [ ] **Step 2: Add a short doc note**

In the repo's top-level README (if absent, create `docs/access-levels.md`), add a section pointing at the spec and the plan, plus a one-paragraph summary:

> Per-Level CRUD permissions over (Module, DataBucket) and (_platform, surface), stored as JSONB on `client_levels.permissions`. Primary (L1) is implicit all-on. Admin configures Products per Client; the Client's Primary configures permissions per level. Server enforcement via `requirePermission(req, key)` in `netlify/functions/_shared/permissions.ts`. Endpoint retrofit is gradual — each Module's endpoints adopt the middleware as that Module is implemented.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-01-access-levels-design.md docs/access-levels.md README.md
git commit -m "docs(permissions): flip spec status + add access-levels.md"
```

---

## Spec coverage self-review

After writing the complete plan, here's the checklist against the spec.

| Spec § | Requirement | Implemented in |
| ------ | ----------- | -------------- |
| §3 layer 1 | Admin → Client Products | Tasks A4–A6 |
| §3 layer 2 | Product → Modules | Tasks A2–A3 |
| §3 layer 3 | Client → Level matrix | Tasks B1, B3, B4 |
| §4.1 | Module manifest | Task A2 |
| §4.2 | Product manifest | Task A3 |
| §4.3 | DataBucket enum | Task A1 |
| §4.4 | `client_enabled_products` table | Task A4 |
| §4.5 | `permissions` JSONB | Task B1 |
| §4.6 | `bucket_family` column | Task C1, C2 |
| §4.7 | Platform surfaces | Task A1 (types) + B3 (GET returns them) + B4 (UI renders them) |
| §5.1 | Admin Products UI | Task A6 |
| §5.2 | Access Level Dashboard | Task B4 |
| §5.3 | PUT replace + validation | Task B3 |
| §6.1 | PermissionKey type | Task A1 |
| §6.2 | `requirePermission` middleware | Task C4 |
| §6.3 | Scope rules | Task C3 (`subtreeOf`) + C4 (matrix lookup); per-endpoint enforcement deferred |
| §6.4 | Endpoint adoption strategy | **Deferred** — out of scope of this plan per the spec ("retrofit happens Module-by-Module"). Follow-up plans per Module. |
| §7 | Customer side | Out of scope — orthogonal. |
| §8 | AMS preservation | All migrations are additive; existing tables/columns untouched. |
| §9 | Migrations summary | Tasks A4, B1, C1 |
| §10 | Testing | Each task has explicit test steps. |

No gaps for the in-scope work. §6.4 (per-endpoint retrofit) is explicitly out of plan-scope by spec.

## Placeholder scan

Grepped for "TBD", "TODO", "fill in", "similar to" — none found. The Task A6 "find the Client-detail page" step provides a fallback when the page doesn't exist yet (mount on `AccessDashboard` gated by admin auth), so it's not a placeholder — it's a documented branch.

## Type consistency check

- `ModuleManifest`, `ProductManifest`, `PermissionKey`, `DataBucket`, `Verb`, `PlatformSurface` defined in Task A1; used consistently in A2, A3, B2, B3, B4, C4.
- `subtreeOf(sql, rootId)` signature defined in C3; not yet consumed by any endpoint in this plan (deferred to per-Module retrofit) so no consistency check applies downstream.
- `requirePermission(req, key)` signature defined in C4; matches the spec's §6.2 exactly.
- API response shape `LevelPermissionsResponse` defined in B4; matches the endpoint's JSON shape in B3.

No drift.

---

## Plan complete and saved to `docs/superpowers/plans/2026-06-01-access-levels.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
