# Manufacturing Module (058) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Manufacturing v1 — BOMs + production orders whose completion consumes component stock and produces output stock through the existing Inventory ledger.

**Architecture:** Three new tables (migration 058) over Inventory's `inventory_stock` + `stock_movements`. Five flat Netlify functions (1 authz helper + 4 routes) mirroring the Inventory/Finance pattern. A `src/modules/manufacturing/` frontend mirroring Inventory. A new `manufacturing` Product/Module in the registry. Seed + integration tests.

**Tech Stack:** Neon Postgres, Netlify Functions v2 (Web `Request`/`Response`), React 18 + Vite + react-router, Vitest (integration tests against the shared dev DB), `@neondatabase/serverless` (`sql` tagged template + `sql.transaction([...])`).

## Global Constraints

- **Worktree:** `ExSol-Manufacturing-WT`, branch `feat/manufacturing-iso`. NEVER push, merge to main, or touch prod. Verify `git branch --show-current` == `feat/manufacturing-iso` before the first commit.
- **Migration number is exactly `058`** (reserved). One SQL statement per line; comments on their own line, never after a `;` (Iron Rule 1 + migrate-splitter).
- **Permission keys are bucket×verb ONLY:** `manufacturing.products.{view,create,edit,delete}` (Iron Rule 3). No action-namespaced keys.
- **Authz = enable-gate THEN `level_number === 1` Owner bypass** — in `_manufacturing-authz.ts` AND Sidebar AND RouteMount (Iron Rule 2).
- **A ModuleManifest needs a ProductManifest** referencing it or the module is invisible and keys never validate (Iron Rule 4).
- **Netlify functions are flat top-level `.ts` files.** `/api/foo/:id` routes by name; two functions sharing `config.path` must both set `config.method` (Iron Rule 5). Use hyphenated `-detail/:id` segments (Booking/Finance convention).
- **Tests share one persistent dev DB (no teardown):** randomize unique-constrained literals. No Blob usage here → no `getStore()` mock needed.
- **Stage commits by path** — never `git add -A` in this worktree (node_modules symlink + origin/main drift).
- **Done = `npm run typecheck` AND the FULL vitest suite, both green.**

## File Structure

**Create:**
- `db/migrations/058_manufacturing.sql`
- `netlify/functions/_manufacturing-authz.ts`
- `netlify/functions/manufacturing-boms.ts` — `/api/manufacturing/boms` `[GET,POST]`
- `netlify/functions/manufacturing-bom-detail.ts` — `/api/manufacturing/bom-detail/:id` `[GET,PUT,DELETE]`
- `netlify/functions/manufacturing-orders.ts` — `/api/manufacturing/orders` `[GET,POST]`
- `netlify/functions/manufacturing-order-advance.ts` — `/api/manufacturing/order-advance/:id` `[POST]`
- `src/modules/registry/manifests/manufacturing.ts`
- `src/modules/registry/products-list/manufacturing.ts`
- `src/modules/manufacturing/shared/{types,api,permissions}.ts`
- `src/modules/manufacturing/manufacturing.css`
- `src/modules/manufacturing/ManufacturingRouteMounts.tsx`
- `src/modules/manufacturing/workspace/pages/ManufacturingPage.tsx`
- `src/modules/manufacturing/workspace/components/{BomBuilderModal,CreateOrderModal}.tsx`
- `scripts/seed-manufacturing.ts`
- `tests/manufacturing/{_helpers,authz,boms,orders,advance}.test.ts` (+ `_helpers.ts` is not a test)
- `tests/unit/manufacturing-registry.test.ts`
- `tests/unit/manufacturing-permissions.test.ts`

**Modify:**
- `src/modules/registry/modules.ts` — register `manufacturingManifest`
- `src/modules/registry/products.ts` — register `manufacturingProduct`
- `src/lib/router.tsx` — import + mount `ManufacturingMount`
- `src/modules/user-portal/layout/Sidebar.tsx` — Manufacturing nav entry
- `package.json` — `seed:manufacturing` script

---

### Task 1: Migration 058 — schema

**Files:**
- Create: `db/migrations/058_manufacturing.sql`

**Interfaces:**
- Produces: tables `boms`, `bom_components`, `production_orders`; enum `production_order_status`. Reuses `inventory_stock`, `stock_movements` (type `'production'` already in `stock_movement_type`).

- [ ] **Step 1: Write the migration** (one statement per line; comments on their own line)

```sql
-- Migration 058: Manufacturing module — BOMs + production orders.
-- boms declares an output product assembled from N component products.
-- production_orders run a bom `qty` times; completing one consumes component
-- stock and produces output stock via the existing stock_movements ledger
-- (type='production', already in the stock_movement_type enum from mig 053).
-- Additive + idempotent (tables/indexes guarded). One statement per line;
-- comments on their own line (Iron Rule 1).
-- See docs/superpowers/specs/2026-07-06-manufacturing-module-design.md.

create type production_order_status as enum ('planned', 'in_progress', 'done', 'cancelled');

create table if not exists public.boms (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id)  on delete cascade,
  output_product_id uuid not null references public.products(id) on delete cascade,
  name              text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists boms_client_idx
  on public.boms (client_id);

create table if not exists public.bom_components (
  id                   uuid primary key default gen_random_uuid(),
  bom_id               uuid not null references public.boms(id)     on delete cascade,
  component_product_id uuid not null references public.products(id) on delete cascade,
  qty                  int  not null,
  constraint bom_components_qty_pos      check (qty > 0),
  constraint bom_components_bom_prod_uniq unique (bom_id, component_product_id)
);

create table if not exists public.production_orders (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  bom_id       uuid not null references public.boms(id)    on delete restrict,
  qty          int  not null,
  status       production_order_status not null default 'planned',
  created_by   uuid references public.user_nodes(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  constraint production_orders_qty_pos check (qty > 0)
);

create index if not exists production_orders_client_idx
  on public.production_orders (client_id, created_at desc);

create trigger boms_updated_at
  before update on public.boms
  for each row execute function public.set_updated_at();

create trigger production_orders_updated_at
  before update on public.production_orders
  for each row execute function public.set_updated_at();
```

- [ ] **Step 2: Apply against the dev DB**

Run: `npm run migrate`
Expected: output lists `058_manufacturing.sql` applied (no error). If `set_updated_at` is missing it would error — it exists (used by `inventory_stock` in 053).

- [ ] **Step 3: Verify tables exist**

Run: `npm run migrate` again
Expected: `058` reported as already applied / no pending — confirms idempotent tracking.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/058_manufacturing.sql
git commit -m "feat(manufacturing): migration 058 — boms + production_orders (Manufacturing v1)"
```

---

### Task 2: Registry — module + product manifests

**Files:**
- Create: `src/modules/registry/manifests/manufacturing.ts`
- Create: `src/modules/registry/products-list/manufacturing.ts`
- Modify: `src/modules/registry/modules.ts`
- Modify: `src/modules/registry/products.ts`
- Test: `tests/unit/manufacturing-registry.test.ts`

**Interfaces:**
- Produces: `manufacturingManifest` (key `manufacturing`, buckets `['products']`), `manufacturingProduct` (key `manufacturing`, requires `['products','inventory']`). Enables `getModule('manufacturing')`, `getProduct('manufacturing')`, and validates `manufacturing.products.*` keys.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/manufacturing-registry.test.ts
import { describe, it, expect } from 'vitest';
import { getModule } from '../../src/modules/registry/modules';
import { getProduct, derivePermissionRows } from '../../src/modules/registry/products';

describe('manufacturing registry', () => {
  it('registers the manufacturing module with the products bucket', () => {
    const m = getModule('manufacturing');
    expect(m).toBeDefined();
    expect(m!.data_buckets).toEqual(['products']);
    expect(m!.vendor_side).toBe(true);
  });

  it('registers the manufacturing product requiring products + inventory', () => {
    const p = getProduct('manufacturing');
    expect(p).toBeDefined();
    expect(p!.modules.map((r) => r.module)).toContain('manufacturing');
    expect(p!.requires).toEqual(['products', 'inventory']);
  });

  it('derives a manufacturing.products permission row when enabled', () => {
    const rows = derivePermissionRows(['manufacturing']);
    const found = rows.find((r) => r.module.key === 'manufacturing' && r.bucket === 'products');
    expect(found).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/manufacturing-registry.test.ts`
Expected: FAIL — `getModule('manufacturing')` returns undefined.

- [ ] **Step 3: Write the manifests**

```ts
// src/modules/registry/manifests/manufacturing.ts
import type { ModuleManifest } from '../types';

// Manufacturing — vendor-side BOM + production over the product catalog. Uses
// the 'products' data bucket, so keys are manufacturing.products.{view,create,
// edit,delete}. Toggle per client via the `manufacturing` Product.
export const manufacturingManifest: ModuleManifest = {
  key: 'manufacturing',
  label: 'Manufacturing',
  data_buckets: ['products'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
};
```

```ts
// src/modules/registry/products-list/manufacturing.ts
import type { ProductManifest } from '../types';

// Manufacturing Product — brings in the Manufacturing module (vendor side).
// Requires `products` (BOMs reference catalog products) and `inventory`
// (completion moves stock through the inventory ledger). Without this
// ProductManifest the module is invisible and keys never validate (Iron Rule 4).
export const manufacturingProduct: ProductManifest = {
  key: 'manufacturing',
  label: 'Manufacturing',
  modules: [{ module: 'manufacturing', side: 'vendor' }],
  requires: ['products', 'inventory'],
};
```

- [ ] **Step 4: Register both** (edit `modules.ts` and `products.ts`)

In `src/modules/registry/modules.ts`, add the import after the `finance` import and the entry after `finance`:
```ts
import { manufacturingManifest } from './manifests/manufacturing';
```
```ts
  finance: financeManifest,
  manufacturing: manufacturingManifest,
```

In `src/modules/registry/products.ts`, add the import after the `financeProduct` import and the entry after `finance`:
```ts
import { manufacturingProduct } from './products-list/manufacturing';
```
```ts
  'finance': financeProduct,
  'manufacturing': manufacturingProduct,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/manufacturing-registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/registry/manifests/manufacturing.ts src/modules/registry/products-list/manufacturing.ts src/modules/registry/modules.ts src/modules/registry/products.ts tests/unit/manufacturing-registry.test.ts
git commit -m "feat(manufacturing): register manufacturing module + product manifests"
```

---

### Task 3: Authz helper + tests

**Files:**
- Create: `netlify/functions/_manufacturing-authz.ts`
- Create: `tests/manufacturing/_helpers.ts`
- Test: `tests/manufacturing/authz.test.ts`

**Interfaces:**
- Consumes: `requireBucketUser`, `UnauthorizedError` from `_shared/permissions`; `db` from `_shared/db`; `getProduct` from registry; `jsonError` from `_shared/http`.
- Produces: `requireManufacturing(req, required): Promise<{ok:true; ctx:{userNodeId,clientId,perms}} | {ok:false; res:Response}>` and `ALL_MANUFACTURING_PERMS`. Helper `seedManufacturingClient()` → `PosTestCtx` with products+pos+inventory+manufacturing enabled.

- [ ] **Step 1: Write the authz helper** (copy `_inventory-authz.ts`, swap module/keys)

```ts
// netlify/functions/_manufacturing-authz.ts
// Manufacturing authorization. Mirrors _inventory-authz.requireInventory.
// Two layers, in order (Iron Rule 2):
//   1. Enable-gate — the manufacturing MODULE must be reachable from an enabled
//      product for this Client (412 manufacturing_module_not_enabled otherwise).
//   2. Permission — the caller holds the explicit manufacturing.products.<verb>
//      key, EXCEPT L1 (Owner), who is treated all-on (full set in ctx.perms).
import { jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { db } from './_shared/db';
import { getProduct } from '../../src/modules/registry/products';

export interface ManufacturingAuthCtx {
  userNodeId: string;
  clientId: string;
  perms: ReadonlySet<string>;
}

export const ALL_MANUFACTURING_PERMS = [
  'manufacturing.products.view', 'manufacturing.products.create',
  'manufacturing.products.edit', 'manufacturing.products.delete',
] as const;

export async function requireManufacturing(
  req: Request,
  required: readonly string[],
): Promise<{ ok: true; ctx: ManufacturingAuthCtx } | { ok: false; res: Response }> {
  let credential: { user_node_id: string };
  let claims: { client_id: string };
  try {
    const r = await requireBucketUser(req);
    credential = r.credential;
    claims = r.claims;
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, res: jsonError(401, 'unauthorized') };
    throw e;
  }

  const sql = db();
  const permRows = (await sql`
    SELECT un.level_number, cl.permissions
    FROM public.user_nodes un
    LEFT JOIN public.client_levels cl
      ON cl.client_id = un.client_id AND cl.level_number = un.level_number
    WHERE un.id = ${credential.user_node_id}::uuid
    LIMIT 1
  `) as Array<{ level_number: number | null; permissions: Record<string, boolean> | null }>;
  const levelNumber = permRows[0]?.level_number ?? 1;
  const perms = new Set(
    Object.entries(permRows[0]?.permissions ?? {}).filter(([, v]) => v === true).map(([k]) => k),
  );

  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products WHERE client_id = ${claims.client_id}::uuid
  `) as Array<{ product_key: string }>;
  const modules = new Set<string>();
  for (const e of enabled) {
    const product = getProduct(e.product_key);
    if (product) for (const ref of product.modules) modules.add(ref.module);
  }
  if (!modules.has('manufacturing')) {
    return { ok: false, res: jsonError(412, 'manufacturing_module_not_enabled') };
  }

  if (levelNumber === 1) {
    return {
      ok: true,
      ctx: {
        userNodeId: credential.user_node_id,
        clientId: claims.client_id,
        perms: new Set(ALL_MANUFACTURING_PERMS),
      },
    };
  }

  for (const r of required) {
    if (!perms.has(r)) return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
  }
  return { ok: true, ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms } };
}
```

- [ ] **Step 2: Write the test helpers**

```ts
// tests/manufacturing/_helpers.ts
// Manufacturing test helpers — built on the POS + inventory helpers. Each seed
// mints a fresh Client + L1 Owner and enables products+pos+inventory, then adds
// the 'manufacturing' Product. No teardown (shared dev DB) — randomize literals.
import { neon } from '@neondatabase/serverless';
import { seedClientWithProductsEnabled, type PosTestCtx } from '../pos/_helpers';
import { enableInventory, seedStock } from '../inventory/_helpers';

const sql = neon(process.env.DATABASE_URL!);

export async function enableManufacturing(ctx: PosTestCtx): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'manufacturing', ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

// Fresh client with products+pos+inventory+manufacturing enabled, L1 Owner session.
export async function seedManufacturingClient(): Promise<PosTestCtx> {
  const ctx = await seedClientWithProductsEnabled();
  await enableInventory(ctx);
  await enableManufacturing(ctx);
  return ctx;
}

export { seedStock };

// Insert a BOM + its components directly (bypassing the API), returns bom id.
export async function seedBom(
  ctx: PosTestCtx,
  outputProductId: string,
  components: ReadonlyArray<{ productId: string; qty: number }>,
  name = `BOM-${Math.random().toString(36).slice(2, 8)}`,
): Promise<string> {
  const bomRows = (await sql`
    INSERT INTO public.boms (client_id, output_product_id, name)
    VALUES (${ctx.clientId}, ${outputProductId}, ${name})
    RETURNING id
  `) as Array<{ id: string }>;
  const bomId = bomRows[0]!.id;
  for (const c of components) {
    await sql`
      INSERT INTO public.bom_components (bom_id, component_product_id, qty)
      VALUES (${bomId}, ${c.productId}, ${c.qty})
    `;
  }
  return bomId;
}

export async function seedOrder(
  ctx: PosTestCtx,
  bomId: string,
  qty: number,
  status = 'planned',
): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.production_orders (client_id, bom_id, qty, status)
    VALUES (${ctx.clientId}, ${bomId}, ${qty}, ${status}::production_order_status)
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

export async function readOrderStatus(id: string): Promise<string | null> {
  const rows = (await sql`SELECT status FROM public.production_orders WHERE id = ${id} LIMIT 1`) as Array<{ status: string }>;
  return rows[0]?.status ?? null;
}
```

- [ ] **Step 3: Write the failing authz test**

```ts
// tests/manufacturing/authz.test.ts
import { describe, it, expect } from 'vitest';
import bomsHandler from '../../netlify/functions/manufacturing-boms';
import { seedClientWithProductsEnabled, seedSubordinateUser, makeBucketUserRequest } from '../pos/_helpers';
import { seedManufacturingClient } from './_helpers';

const listBoms = (ctx: Awaited<ReturnType<typeof seedManufacturingClient>>) =>
  bomsHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/boms'));

describe('manufacturing authz', () => {
  it('412 when the manufacturing module is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled(); // products+pos only
    const res = await bomsHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/boms'));
    expect(res.status).toBe(412);
    expect((await res.json()).error.code).toBe('manufacturing_module_not_enabled');
  });

  it('200 for an L1 Owner (all-on bypass) when enabled', async () => {
    const ctx = await seedManufacturingClient();
    const res = await listBoms(ctx);
    expect(res.status).toBe(200);
  });

  it('403 for an L2 user lacking manufacturing.products.view', async () => {
    const base = await seedManufacturingClient();
    const sub = await seedSubordinateUser(base, 2, []); // no keys
    const res = await bomsHandler(makeBucketUserRequest(sub, 'GET', '/api/manufacturing/boms'));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/manufacturing/authz.test.ts`
Expected: FAIL — `manufacturing-boms` module not found (built in Task 4). This proves the harness wiring; proceed to Task 4 which makes it pass.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_manufacturing-authz.ts tests/manufacturing/_helpers.ts tests/manufacturing/authz.test.ts
git commit -m "feat(manufacturing): authz helper + test harness (enable-gate + L1 bypass)"
```

---

### Task 4: BOM endpoints (list/create + detail get/put/delete)

**Files:**
- Create: `netlify/functions/manufacturing-boms.ts`
- Create: `netlify/functions/manufacturing-bom-detail.ts`
- Test: `tests/manufacturing/boms.test.ts`

**Interfaces:**
- Consumes: `requireManufacturing`, `ALL_MANUFACTURING_PERMS`; `db`; `jsonOk`, `jsonError`; test helpers from Task 3 + `seedProducts` from `../pos/_helpers`.
- Produces wire shapes:
  - GET `/api/manufacturing/boms` → `{ items: Array<{id,name,output_product_id,output_product_name,component_count,created_at}> }`
  - POST `/api/manufacturing/boms` body `{ name, output_product_id, components:[{product_id,qty}] }` → `201 { id }`
  - GET `/api/manufacturing/bom-detail/:id` → `{ id,name,output_product_id,output_product_name, components:[{component_product_id,name,qty}] }`
  - PUT `/api/manufacturing/bom-detail/:id` body `{ name?, components:[{product_id,qty}] }` → `200 { id }`
  - DELETE `/api/manufacturing/bom-detail/:id` → `200 { id, deleted:true }` or `409 bom_in_use`

- [ ] **Step 1: Write `manufacturing-boms.ts`**

```ts
// GET list + POST create for BOMs. Every query scoped by client_id.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/boms', method: ['GET', 'POST'] };

interface CreateBody { name?: unknown; output_product_id?: unknown; components?: unknown; }
interface CompInput { product_id: string; qty: number; }

function parseComponents(raw: unknown): CompInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CompInput[] = [];
  for (const c of raw) {
    const pid = typeof (c as any)?.product_id === 'string' ? (c as any).product_id.trim() : '';
    const qty = typeof (c as any)?.qty === 'number' ? Math.trunc((c as any).qty) : NaN;
    if (!pid || !Number.isFinite(qty) || qty <= 0) return null;
    out.push({ product_id: pid, qty });
  }
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const items = (await sql`
      SELECT b.id, b.name, b.output_product_id, p.name AS output_product_name,
             b.created_at,
             (SELECT COUNT(*)::int FROM public.bom_components bc WHERE bc.bom_id = b.id) AS component_count
      FROM public.boms b
      JOIN public.products p ON p.id = b.output_product_id
      WHERE b.client_id = ${a.ctx.clientId}::uuid
      ORDER BY b.created_at DESC
    `) as unknown[];
    return jsonOk({ items });
  }

  if (req.method === 'POST') {
    const a = await requireManufacturing(req, ['manufacturing.products.create']);
    if (!a.ok) return a.res;
    let body: CreateBody;
    try { body = (await req.json()) as CreateBody; } catch { return jsonError(400, 'invalid_json'); }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const outputId = typeof body.output_product_id === 'string' ? body.output_product_id.trim() : '';
    const comps = parseComponents(body.components);
    if (!name) return jsonError(400, 'name_required');
    if (!outputId) return jsonError(400, 'output_product_id_required');
    if (!comps) return jsonError(400, 'components_required');

    const sql = db();
    // All referenced products (output + components) must belong to this client.
    const ids = [outputId, ...comps.map((c) => c.product_id)];
    const owned = (await sql`
      SELECT id FROM public.products
      WHERE client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL AND id = ANY(${ids}::uuid[])
    `) as Array<{ id: string }>;
    const ownedSet = new Set(owned.map((r) => r.id));
    if (!ownedSet.has(outputId)) return jsonError(404, 'output_product_not_found');
    for (const c of comps) if (!ownedSet.has(c.product_id)) return jsonError(404, 'component_product_not_found');

    const bomRows = (await sql`
      INSERT INTO public.boms (client_id, output_product_id, name)
      VALUES (${a.ctx.clientId}::uuid, ${outputId}::uuid, ${name})
      RETURNING id
    `) as Array<{ id: string }>;
    const bomId = bomRows[0]!.id;
    try {
      await sql.transaction(
        comps.map((c) => sql`
          INSERT INTO public.bom_components (bom_id, component_product_id, qty)
          VALUES (${bomId}::uuid, ${c.product_id}::uuid, ${c.qty}::int)
        `),
      );
    } catch (e: any) {
      if (e?.code === '23505') return jsonError(400, 'duplicate_component');
      throw e;
    }
    return jsonOk({ id: bomId }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
```

- [ ] **Step 2: Write `manufacturing-bom-detail.ts`**

```ts
// GET / PUT / DELETE a single BOM. Scoped by client_id (cross-tenant → 404).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/bom-detail/:id', method: ['GET', 'PUT', 'DELETE'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

interface CompInput { product_id: string; qty: number; }
function parseComponents(raw: unknown): CompInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CompInput[] = [];
  for (const c of raw) {
    const pid = typeof (c as any)?.product_id === 'string' ? (c as any).product_id.trim() : '';
    const qty = typeof (c as any)?.qty === 'number' ? Math.trunc((c as any).qty) : NaN;
    if (!pid || !Number.isFinite(qty) || qty <= 0) return null;
    out.push({ product_id: pid, qty });
  }
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const head = (await sql`
      SELECT b.id, b.name, b.output_product_id, p.name AS output_product_name
      FROM public.boms b JOIN public.products p ON p.id = b.output_product_id
      WHERE b.id = ${id}::uuid AND b.client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as any[];
    if (!head[0]) return jsonError(404, 'not_found');
    const components = (await sql`
      SELECT bc.component_product_id, p.name, bc.qty
      FROM public.bom_components bc JOIN public.products p ON p.id = bc.component_product_id
      WHERE bc.bom_id = ${id}::uuid
      ORDER BY p.name ASC
    `) as unknown[];
    return jsonOk({ ...head[0], components });
  }

  if (req.method === 'PUT') {
    const a = await requireManufacturing(req, ['manufacturing.products.edit']);
    if (!a.ok) return a.res;
    let body: { name?: unknown; components?: unknown };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const comps = parseComponents(body.components);
    if (!comps) return jsonError(400, 'components_required');
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;

    const sql = db();
    const owned = (await sql`
      SELECT id FROM public.boms WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as any[];
    if (!owned[0]) return jsonError(404, 'not_found');

    const ids = comps.map((c) => c.product_id);
    const ownedProd = (await sql`
      SELECT id FROM public.products
      WHERE client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL AND id = ANY(${ids}::uuid[])
    `) as Array<{ id: string }>;
    const ownedSet = new Set(ownedProd.map((r) => r.id));
    for (const c of comps) if (!ownedSet.has(c.product_id)) return jsonError(404, 'component_product_not_found');

    try {
      await sql.transaction([
        sql`DELETE FROM public.bom_components WHERE bom_id = ${id}::uuid`,
        ...comps.map((c) => sql`
          INSERT INTO public.bom_components (bom_id, component_product_id, qty)
          VALUES (${id}::uuid, ${c.product_id}::uuid, ${c.qty}::int)
        `),
        sql`UPDATE public.boms SET name = COALESCE(${name ?? null}, name), updated_at = now() WHERE id = ${id}::uuid`,
      ]);
    } catch (e: any) {
      if (e?.code === '23505') return jsonError(400, 'duplicate_component');
      throw e;
    }
    return jsonOk({ id });
  }

  // DELETE — blocked if any production order references the BOM (FK RESTRICT).
  const a = await requireManufacturing(req, ['manufacturing.products.delete']);
  if (!a.ok) return a.res;
  const sql = db();
  const inUse = (await sql`
    SELECT 1 FROM public.production_orders
    WHERE bom_id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as unknown[];
  if (inUse.length > 0) return jsonError(409, 'bom_in_use');
  const rows = (await sql`
    DELETE FROM public.boms WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid RETURNING id
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  return jsonOk({ id: rows[0].id, deleted: true });
}
```

- [ ] **Step 3: Write the failing test**

```ts
// tests/manufacturing/boms.test.ts
import { describe, it, expect } from 'vitest';
import bomsHandler from '../../netlify/functions/manufacturing-boms';
import bomDetailHandler from '../../netlify/functions/manufacturing-bom-detail';
import { seedProducts, seedClientWithProductsEnabled, makeBucketUserRequest } from '../pos/_helpers';
import { seedManufacturingClient } from './_helpers';

const create = (ctx: any, body: unknown) =>
  bomsHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/boms', body));
const list = (ctx: any) => bomsHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/boms'));
const detail = (ctx: any, id: string) =>
  bomDetailHandler(makeBucketUserRequest(ctx, 'GET', `/api/manufacturing/bom-detail/${id}`));
const del = (ctx: any, id: string) =>
  bomDetailHandler(makeBucketUserRequest(ctx, 'DELETE', `/api/manufacturing/bom-detail/${id}`));

describe('manufacturing BOMs', () => {
  it('creates a BOM with components and lists it', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1, c2] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }, { name: 'Comb' }]);
    const res = await create(ctx, {
      name: `Kit BOM ${Math.random().toString(36).slice(2, 7)}`,
      output_product_id: out,
      components: [{ product_id: c1, qty: 2 }, { product_id: c2, qty: 1 }],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const listed = await (await list(ctx)).json();
    const row = listed.items.find((i: any) => i.id === id);
    expect(row.component_count).toBe(2);
    expect(row.output_product_name).toBe('Kit');

    const d = await (await detail(ctx, id)).json();
    expect(d.components).toHaveLength(2);
  });

  it('400 components_required when empty', async () => {
    const ctx = await seedManufacturingClient();
    const [out] = await seedProducts(ctx.clientId, [{ name: 'Kit' }]);
    const res = await create(ctx, { name: 'x', output_product_id: out, components: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('components_required');
  });

  it('404 when a component belongs to another client', async () => {
    const ctx = await seedManufacturingClient();
    const [out] = await seedProducts(ctx.clientId, [{ name: 'Kit' }]);
    const other = await seedClientWithProductsEnabled();
    const [foreign] = await seedProducts(other.clientId, [{ name: 'Foreign' }]);
    const res = await create(ctx, { name: 'x', output_product_id: out, components: [{ product_id: foreign, qty: 1 }] });
    expect(res.status).toBe(404);
  });

  it('deletes an unused BOM', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]);
    const { id } = await (await create(ctx, { name: 'y', output_product_id: out, components: [{ product_id: c1, qty: 1 }] })).json();
    const res = await del(ctx, id);
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass** (this also flips Task 3's authz test green)

Run: `npx vitest run tests/manufacturing/boms.test.ts tests/manufacturing/authz.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/manufacturing-boms.ts netlify/functions/manufacturing-bom-detail.ts tests/manufacturing/boms.test.ts
git commit -m "feat(manufacturing): BOM list/create/detail/edit/delete endpoints"
```

---

### Task 5: Production-order endpoints (list/create)

**Files:**
- Create: `netlify/functions/manufacturing-orders.ts`
- Test: `tests/manufacturing/orders.test.ts`

**Interfaces:**
- Produces:
  - GET `/api/manufacturing/orders` → `{ items: Array<{id,bom_id,bom_name,output_product_id,output_product_name,qty,status,created_at,completed_at}> }`
  - POST `/api/manufacturing/orders` body `{ bom_id, qty }` → `201 { id, status:'planned' }`

- [ ] **Step 1: Write `manufacturing-orders.ts`**

```ts
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/orders', method: ['GET', 'POST'] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const items = (await sql`
      SELECT po.id, po.bom_id, b.name AS bom_name, b.output_product_id,
             p.name AS output_product_name, po.qty, po.status,
             po.created_at, po.completed_at
      FROM public.production_orders po
      JOIN public.boms b ON b.id = po.bom_id
      JOIN public.products p ON p.id = b.output_product_id
      WHERE po.client_id = ${a.ctx.clientId}::uuid
      ORDER BY po.created_at DESC
    `) as unknown[];
    return jsonOk({ items });
  }

  if (req.method === 'POST') {
    const a = await requireManufacturing(req, ['manufacturing.products.create']);
    if (!a.ok) return a.res;
    let body: { bom_id?: unknown; qty?: unknown };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const bomId = typeof body.bom_id === 'string' ? body.bom_id.trim() : '';
    const qty = typeof body.qty === 'number' ? Math.trunc(body.qty) : NaN;
    if (!bomId) return jsonError(400, 'bom_id_required');
    if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'qty_required');

    const sql = db();
    const owned = (await sql`
      SELECT id FROM public.boms WHERE id = ${bomId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as any[];
    if (!owned[0]) return jsonError(404, 'bom_not_found');

    const rows = (await sql`
      INSERT INTO public.production_orders (client_id, bom_id, qty, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${bomId}::uuid, ${qty}::int, ${a.ctx.userNodeId}::uuid)
      RETURNING id, status
    `) as Array<{ id: string; status: string }>;
    return jsonOk({ id: rows[0]!.id, status: rows[0]!.status }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/manufacturing/orders.test.ts
import { describe, it, expect } from 'vitest';
import ordersHandler from '../../netlify/functions/manufacturing-orders';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';
import { seedManufacturingClient, seedBom } from './_helpers';

const createOrder = (ctx: any, body: unknown) =>
  ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/orders', body));
const listOrders = (ctx: any) => ordersHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/orders'));

describe('manufacturing production orders', () => {
  it('creates a planned order and lists it', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]);
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 2 }]);
    const res = await createOrder(ctx, { bom_id: bomId, qty: 3 });
    expect(res.status).toBe(201);
    const { id, status } = await res.json();
    expect(status).toBe('planned');
    const listed = await (await listOrders(ctx)).json();
    const row = listed.items.find((i: any) => i.id === id);
    expect(row.qty).toBe(3);
    expect(row.output_product_name).toBe('Kit');
  });

  it('400 qty_required for non-positive qty', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]);
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 1 }]);
    const res = await createOrder(ctx, { bom_id: bomId, qty: 0 });
    expect(res.status).toBe(400);
  });

  it('404 bom_not_found for a foreign bom', async () => {
    const ctx = await seedManufacturingClient();
    const res = await createOrder(ctx, { bom_id: '00000000-0000-0000-0000-000000000000', qty: 1 });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/manufacturing/orders.test.ts`
Expected: PASS (3).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/manufacturing-orders.ts tests/manufacturing/orders.test.ts
git commit -m "feat(manufacturing): production-order list/create endpoints"
```

---

### Task 6: Order advance — FSM + consume/produce transaction (the crux)

**Files:**
- Create: `netlify/functions/manufacturing-order-advance.ts`
- Test: `tests/manufacturing/advance.test.ts`

**Interfaces:**
- Consumes: `requireManufacturing`; `db`; test helpers + `seedStock`, `readStock`, `readMovements` (from `../inventory/_helpers`).
- Produces: POST `/api/manufacturing/order-advance/:id` body `{ to: 'in_progress'|'done'|'cancelled' }` → `200 { id, status }`; `409 illegal_transition`; `409 insufficient_stock { shortfalls:[{product_id,name,need,have}] }`.

- [ ] **Step 1: Write `manufacturing-order-advance.ts`**

```ts
// POST /api/manufacturing/order-advance/:id — drive the production-order FSM.
// planned→in_progress→done, planned/in_progress→cancelled; done/cancelled terminal.
// Completing (→done) consumes component stock and produces output stock in one
// transaction, recording type='production' movements. Insufficient component
// stock is rejected (409) with a shortfall list — nothing is written and the
// order stays in_progress. The inventory_stock qty_on_hand>=0 CHECK is the
// concurrency backstop (23514 → 409).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/order-advance/:id', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

const LEGAL: Record<string, string[]> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const a = await requireManufacturing(req, ['manufacturing.products.edit']);
  if (!a.ok) return a.res;

  let body: { to?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
  const to = typeof body.to === 'string' ? body.to : '';
  if (!['in_progress', 'done', 'cancelled'].includes(to)) return jsonError(400, 'invalid_to');

  const sql = db();
  const orderRows = (await sql`
    SELECT po.id, po.status, po.qty, po.bom_id, b.output_product_id
    FROM public.production_orders po
    JOIN public.boms b ON b.id = po.bom_id
    WHERE po.id = ${id}::uuid AND po.client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string; qty: number; bom_id: string; output_product_id: string }>;
  if (!orderRows[0]) return jsonError(404, 'not_found');
  const order = orderRows[0];

  if (!(LEGAL[order.status] ?? []).includes(to)) {
    return jsonError(409, 'illegal_transition', { from: order.status, to });
  }

  // Non-completing transitions: status flip only.
  if (to !== 'done') {
    await sql`
      UPDATE public.production_orders SET status = ${to}::production_order_status, updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    `;
    return jsonOk({ id, status: to });
  }

  // Completing: gather component requirements and current stock.
  const comps = (await sql`
    SELECT bc.component_product_id, bc.qty, p.name
    FROM public.bom_components bc
    JOIN public.products p ON p.id = bc.component_product_id
    WHERE bc.bom_id = ${order.bom_id}::uuid
  `) as Array<{ component_product_id: string; qty: number; name: string }>;
  const need = comps.map((c) => ({ product_id: c.component_product_id, name: c.name, need: c.qty * order.qty }));
  const productIds = need.map((n) => n.product_id);

  const stockRows = (await sql`
    SELECT product_id, qty_on_hand FROM public.inventory_stock
    WHERE client_id = ${a.ctx.clientId}::uuid AND product_id = ANY(${productIds}::uuid[])
  `) as Array<{ product_id: string; qty_on_hand: number }>;
  const stockMap = new Map(stockRows.map((r) => [r.product_id, r.qty_on_hand]));

  const shortfalls = need
    .filter((n) => (stockMap.get(n.product_id) ?? 0) < n.need)
    .map((n) => ({ product_id: n.product_id, name: n.name, need: n.need, have: stockMap.get(n.product_id) ?? 0 }));
  if (shortfalls.length > 0) return jsonError(409, 'insufficient_stock', { shortfalls });

  // Atomic consume + produce + complete. No GREATEST clamp — the qty>=0 CHECK
  // aborts the txn if a concurrent op drained stock (23514 → 409).
  const queries = [];
  for (const n of need) {
    queries.push(sql`
      UPDATE public.inventory_stock SET qty_on_hand = qty_on_hand - ${n.need}::int, updated_at = now()
      WHERE client_id = ${a.ctx.clientId}::uuid AND product_id = ${n.product_id}::uuid
    `);
    queries.push(sql`
      INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${n.product_id}::uuid, ${-n.need}::int, 'production', ${order.id}, ${a.ctx.userNodeId}::uuid)
    `);
  }
  queries.push(sql`
    INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand)
    VALUES (${a.ctx.clientId}::uuid, ${order.output_product_id}::uuid, ${order.qty}::int)
    ON CONFLICT (client_id, product_id)
    DO UPDATE SET qty_on_hand = public.inventory_stock.qty_on_hand + ${order.qty}::int, updated_at = now()
  `);
  queries.push(sql`
    INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
    VALUES (${a.ctx.clientId}::uuid, ${order.output_product_id}::uuid, ${order.qty}::int, 'production', ${order.id}, ${a.ctx.userNodeId}::uuid)
  `);
  queries.push(sql`
    UPDATE public.production_orders SET status = 'done', completed_at = now(), updated_at = now()
    WHERE id = ${order.id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `);

  try {
    await sql.transaction(queries);
  } catch (e: any) {
    if (e?.code === '23514') return jsonError(409, 'insufficient_stock', { shortfalls: [] });
    throw e;
  }
  return jsonOk({ id, status: 'done' });
}
```

- [ ] **Step 2: Write the failing test (the golden flow + edges)**

```ts
// tests/manufacturing/advance.test.ts
import { describe, it, expect } from 'vitest';
import advanceHandler from '../../netlify/functions/manufacturing-order-advance';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';
import { seedManufacturingClient, seedBom, seedOrder, readOrderStatus } from './_helpers';
import { seedStock, readStock, readMovements } from '../inventory/_helpers';

const advance = (ctx: any, id: string, to: string) =>
  advanceHandler(makeBucketUserRequest(ctx, 'POST', `/api/manufacturing/order-advance/${id}`, { to }));

describe('manufacturing order advance', () => {
  it('golden: planned→in_progress→done consumes components and produces output', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1, c2] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }, { name: 'Comb' }]);
    await seedStock(ctx, c1, 100);
    await seedStock(ctx, c2, 100);
    await seedStock(ctx, out, 0);
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 2 }, { productId: c2, qty: 1 }]);
    const orderId = await seedOrder(ctx, bomId, 5); // needs 10 c1, 5 c2

    expect((await advance(ctx, orderId, 'in_progress')).status).toBe(200);
    const done = await advance(ctx, orderId, 'done');
    expect(done.status).toBe(200);

    expect((await readStock(ctx, c1))?.qty_on_hand).toBe(90);
    expect((await readStock(ctx, c2))?.qty_on_hand).toBe(95);
    expect((await readStock(ctx, out))?.qty_on_hand).toBe(5);
    expect(await readOrderStatus(orderId)).toBe('done');

    const outMoves = await readMovements(ctx, out);
    expect(outMoves.some((m) => m.type === 'production' && m.qty_delta === 5)).toBe(true);
    const c1Moves = await readMovements(ctx, c1);
    expect(c1Moves.some((m) => m.type === 'production' && m.qty_delta === -10)).toBe(true);
  });

  it('insufficient stock → 409, nothing written, order stays in_progress', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]);
    await seedStock(ctx, c1, 3); // need 2*5 = 10
    await seedStock(ctx, out, 0);
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 2 }]);
    const orderId = await seedOrder(ctx, bomId, 5, 'in_progress');

    const res = await advance(ctx, orderId, 'done');
    expect(res.status).toBe(409);
    const b = await res.json();
    expect(b.error.code).toBe('insufficient_stock');
    expect(b.error.details.shortfalls[0]).toMatchObject({ product_id: c1, need: 10, have: 3 });
    expect((await readStock(ctx, c1))?.qty_on_hand).toBe(3); // untouched
    expect((await readStock(ctx, out))?.qty_on_hand).toBe(0); // untouched
    expect(await readOrderStatus(orderId)).toBe('in_progress');
  });

  it('409 illegal_transition for planned→done', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]);
    await seedStock(ctx, c1, 100);
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 1 }]);
    const orderId = await seedOrder(ctx, bomId, 1, 'planned');
    const res = await advance(ctx, orderId, 'done');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('illegal_transition');
  });

  it('cancels a planned order', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]);
    const bomId = await seedBom(ctx, out, [{ productId: c1, qty: 1 }]);
    const orderId = await seedOrder(ctx, bomId, 1, 'planned');
    expect((await advance(ctx, orderId, 'cancelled')).status).toBe(200);
    expect(await readOrderStatus(orderId)).toBe('cancelled');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/manufacturing/advance.test.ts`
Expected: PASS (4).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/manufacturing-order-advance.ts tests/manufacturing/advance.test.ts
git commit -m "feat(manufacturing): order-advance FSM + consume/produce transaction"
```

---

### Task 7: Frontend — module dir + route + sidebar

**Files:**
- Create: `src/modules/manufacturing/shared/types.ts`
- Create: `src/modules/manufacturing/shared/api.ts`
- Create: `src/modules/manufacturing/shared/permissions.ts`
- Create: `src/modules/manufacturing/manufacturing.css`
- Create: `src/modules/manufacturing/ManufacturingRouteMounts.tsx`
- Create: `src/modules/manufacturing/workspace/pages/ManufacturingPage.tsx`
- Create: `src/modules/manufacturing/workspace/components/BomBuilderModal.tsx`
- Create: `src/modules/manufacturing/workspace/components/CreateOrderModal.tsx`
- Modify: `src/lib/router.tsx`
- Modify: `src/modules/user-portal/layout/Sidebar.tsx`
- Test: `tests/unit/manufacturing-permissions.test.ts`

**Interfaces:**
- Consumes: `useUserAuth` from `../user-portal/user-auth-context`; `UserPortalPermissionMatrix` from `../../user-portal/api`; product-list endpoint `/api/products` (existing) for product pickers — reuse the pattern already used by an existing modal if present, else fetch `/api/inventory/list` for product names. NOTE: use `manufacturingApi.products()` defined below which calls `/api/inventory/list` (returns `{items:[{product_id,name}]}`) to populate selects — inventory is a required dependency so it is always enabled.
- Produces: `ManufacturingMount` (default route element), `manufacturingApi`, permission helpers.

- [ ] **Step 1: Write `shared/types.ts`**

```ts
export type ProductionStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';

export interface BomListItem {
  id: string;
  name: string;
  output_product_id: string;
  output_product_name: string;
  component_count: number;
  created_at: string;
}

export interface BomComponentRow { component_product_id: string; name: string; qty: number; }

export interface BomDetail {
  id: string;
  name: string;
  output_product_id: string;
  output_product_name: string;
  components: BomComponentRow[];
}

export interface ProductionOrder {
  id: string;
  bom_id: string;
  bom_name: string;
  output_product_id: string;
  output_product_name: string;
  qty: number;
  status: ProductionStatus;
  created_at: string;
  completed_at: string | null;
}

export interface ProductPick { product_id: string; name: string; }
```

- [ ] **Step 2: Write `shared/api.ts`** (throw-on-error, mirrors inventory)

```ts
import type { BomListItem, BomDetail, ProductionOrder, ProductPick } from './types';

export class ManufacturingApiError extends Error {
  constructor(public status: number, public code: string, public detail: unknown) {
    super(`${code} (${status})`);
  }
}

function safeJson(text: string): unknown { try { return JSON.parse(text); } catch { return text; } }

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (body as { error?: { code?: string } } | null)?.error;
    throw new ManufacturingApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

export const manufacturingApi = {
  listBoms: () => jsonFetch<{ items: BomListItem[] }>('/api/manufacturing/boms'),
  getBom: (id: string) => jsonFetch<BomDetail>(`/api/manufacturing/bom-detail/${id}`),
  createBom: (body: { name: string; output_product_id: string; components: { product_id: string; qty: number }[] }) =>
    jsonFetch<{ id: string }>('/api/manufacturing/boms', { method: 'POST', body: JSON.stringify(body) }),
  updateBom: (id: string, body: { name?: string; components: { product_id: string; qty: number }[] }) =>
    jsonFetch<{ id: string }>(`/api/manufacturing/bom-detail/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteBom: (id: string) =>
    jsonFetch<{ id: string; deleted: boolean }>(`/api/manufacturing/bom-detail/${id}`, { method: 'DELETE' }),
  listOrders: () => jsonFetch<{ items: ProductionOrder[] }>('/api/manufacturing/orders'),
  createOrder: (body: { bom_id: string; qty: number }) =>
    jsonFetch<{ id: string; status: string }>('/api/manufacturing/orders', { method: 'POST', body: JSON.stringify(body) }),
  advanceOrder: (id: string, to: string) =>
    jsonFetch<{ id: string; status: string }>(`/api/manufacturing/order-advance/${id}`, { method: 'POST', body: JSON.stringify({ to }) }),
  // Product picker source: inventory list (always enabled — manufacturing requires it).
  products: () => jsonFetch<{ items: ProductPick[] }>('/api/inventory/list'),
};
```

- [ ] **Step 3: Write `shared/permissions.ts` + its unit test**

```ts
// src/modules/manufacturing/shared/permissions.ts
import type { UserPortalPermissionMatrix } from '../../user-portal/api';

export const isOwnerLevel = (levelNumber: number | null | undefined): boolean =>
  levelNumber == null || levelNumber === 1;

function has(perms: UserPortalPermissionMatrix, key: string, lvl: number | null | undefined): boolean {
  if (isOwnerLevel(lvl)) return true;
  return perms[key] === true;
}

export const canViewManufacturing = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'manufacturing.products.view', lvl);
export const canCreateManufacturing = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'manufacturing.products.create', lvl);
export const canEditManufacturing = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'manufacturing.products.edit', lvl);
export const canDeleteManufacturing = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'manufacturing.products.delete', lvl);
```

```ts
// tests/unit/manufacturing-permissions.test.ts
import { describe, it, expect } from 'vitest';
import { canViewManufacturing, canEditManufacturing, isOwnerLevel } from '../../src/modules/manufacturing/shared/permissions';

describe('manufacturing FE permissions', () => {
  it('owner (level 1 / null) is all-on', () => {
    expect(isOwnerLevel(1)).toBe(true);
    expect(isOwnerLevel(null)).toBe(true);
    expect(canEditManufacturing({}, 1)).toBe(true);
  });
  it('L2 needs the explicit key', () => {
    expect(canViewManufacturing({}, 2)).toBe(false);
    expect(canViewManufacturing({ 'manufacturing.products.view': true }, 2)).toBe(true);
    expect(canEditManufacturing({ 'manufacturing.products.view': true }, 2)).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/manufacturing-permissions.test.ts` → Expected PASS (2).

- [ ] **Step 4: Write `ManufacturingRouteMounts.tsx`** (mirror `InventoryRouteMounts`)

```tsx
import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import ManufacturingPage from './workspace/pages/ManufacturingPage';

const ALL_MANUFACTURING_PERMS = [
  'manufacturing.products.view', 'manufacturing.products.create',
  'manufacturing.products.edit', 'manufacturing.products.delete',
];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_MANUFACTURING_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const enabled = enabledModules.some((m) => m.key === 'manufacturing');
  return { user, client, perms, enabled, slug: slug ?? '', loading };
}

export const ManufacturingMount = (function () {
  return function Mount() {
    const { user, client, perms, enabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!enabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has('manufacturing.products.view')) return <Navigate to={`/c/${slug}`} replace />;
    return <ManufacturingPage slug={slug} perms={perms} />;
  };
})();
```

- [ ] **Step 5: Write `manufacturing.css`** (namespaced `.mfg-*`)

```css
.mfg-page { padding: 1.5rem; }
.mfg-tabs { display: flex; gap: 0.5rem; border-bottom: 1px solid var(--border, #e2e2e2); margin-bottom: 1rem; }
.mfg-tab { padding: 0.5rem 1rem; background: none; border: none; cursor: pointer; font-weight: 600; color: var(--muted, #666); }
.mfg-tab.is-active { color: var(--fg, #111); border-bottom: 2px solid var(--accent, #2563eb); }
.mfg-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; gap: 1rem; }
.mfg-table { width: 100%; border-collapse: collapse; }
.mfg-table th, .mfg-table td { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border, #eee); }
.mfg-empty, .mfg-error { padding: 2rem; text-align: center; color: var(--muted, #777); }
.mfg-error { color: #b91c1c; }
.mfg-badge { padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
.mfg-badge.planned { background: #eef; color: #3730a3; }
.mfg-badge.in_progress { background: #fef9c3; color: #854d0e; }
.mfg-badge.done { background: #dcfce7; color: #166534; }
.mfg-badge.cancelled { background: #f3f4f6; color: #6b7280; }
.mfg-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
.mfg-modal { background: #fff; border-radius: 8px; padding: 1.5rem; width: min(560px, 92vw); max-height: 88vh; overflow: auto; }
.mfg-comp-row { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; }
.mfg-shortfall { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 0.75rem; margin-top: 0.75rem; color: #991b1b; font-size: 0.85rem; }
.mfg-btn { padding: 0.4rem 0.9rem; border-radius: 6px; border: 1px solid var(--border,#d1d5db); background:#fff; cursor:pointer; }
.mfg-btn.primary { background: var(--accent,#2563eb); color:#fff; border-color: transparent; }
```

- [ ] **Step 6: Write `ManufacturingPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { BomListItem, ProductionOrder, ProductionStatus } from '../../shared/types';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';
import BomBuilderModal from '../components/BomBuilderModal';
import CreateOrderModal from '../components/CreateOrderModal';
import '../../manufacturing.css';

const NEXT: Record<ProductionStatus, { to: ProductionStatus; label: string }[]> = {
  planned: [{ to: 'in_progress', label: 'Start' }, { to: 'cancelled', label: 'Cancel' }],
  in_progress: [{ to: 'done', label: 'Complete' }, { to: 'cancelled', label: 'Cancel' }],
  done: [],
  cancelled: [],
};

export default function ManufacturingPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const canCreate = perms.has('manufacturing.products.create');
  const canEdit = perms.has('manufacturing.products.edit');
  const [tab, setTab] = useState<'boms' | 'orders'>('boms');
  const [boms, setBoms] = useState<BomListItem[] | null>(null);
  const [orders, setOrders] = useState<ProductionOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bomModal, setBomModal] = useState<{ id?: string } | null>(null);
  const [orderModal, setOrderModal] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, o] = await Promise.all([manufacturingApi.listBoms(), manufacturingApi.listOrders()]);
      setBoms(b.items); setOrders(o.items);
    } catch (e) {
      setError(e instanceof ManufacturingApiError ? e.code : 'load_failed');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const advance = async (id: string, to: ProductionStatus) => {
    setRowError(null);
    try {
      await manufacturingApi.advanceOrder(id, to);
      await load();
    } catch (e) {
      if (e instanceof ManufacturingApiError && e.code === 'insufficient_stock') {
        const sf = (e.detail as any)?.error?.details?.shortfalls ?? [];
        setRowError(sf.length
          ? `Insufficient stock: ${sf.map((s: any) => `${s.name} (need ${s.need}, have ${s.have})`).join(', ')}`
          : 'Insufficient component stock.');
      } else {
        setRowError(e instanceof ManufacturingApiError ? e.code : 'advance_failed');
      }
    }
  };

  return (
    <div className="mfg-page">
      <h1>Manufacturing</h1>
      <div className="mfg-tabs">
        <button className={`mfg-tab ${tab === 'boms' ? 'is-active' : ''}`} onClick={() => setTab('boms')}>BOMs</button>
        <button className={`mfg-tab ${tab === 'orders' ? 'is-active' : ''}`} onClick={() => setTab('orders')}>Production Orders</button>
      </div>

      {error && <div className="mfg-error">Could not load Manufacturing ({error}). <button className="mfg-btn" onClick={() => void load()}>Retry</button></div>}
      {rowError && <div className="mfg-shortfall">{rowError}</div>}

      {tab === 'boms' && !error && (
        <>
          <div className="mfg-toolbar">
            <span>{boms ? `${boms.length} BOM(s)` : 'Loading…'}</span>
            {canCreate && <button className="mfg-btn primary" onClick={() => setBomModal({})}>New BOM</button>}
          </div>
          {boms && boms.length === 0 && <div className="mfg-empty">No BOMs yet. Create one to define what you assemble.</div>}
          {boms && boms.length > 0 && (
            <table className="mfg-table">
              <thead><tr><th>Name</th><th>Output</th><th>Components</th><th></th></tr></thead>
              <tbody>
                {boms.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td><td>{b.output_product_name}</td><td>{b.component_count}</td>
                    <td>{canEdit && <button className="mfg-btn" onClick={() => setBomModal({ id: b.id })}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === 'orders' && !error && (
        <>
          <div className="mfg-toolbar">
            <span>{orders ? `${orders.length} order(s)` : 'Loading…'}</span>
            {canCreate && <button className="mfg-btn primary" onClick={() => setOrderModal(true)}>New Order</button>}
          </div>
          {orders && orders.length === 0 && <div className="mfg-empty">No production orders yet.</div>}
          {orders && orders.length > 0 && (
            <table className="mfg-table">
              <thead><tr><th>Output</th><th>Qty</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.output_product_name}</td><td>{o.qty}</td>
                    <td><span className={`mfg-badge ${o.status}`}>{o.status.replace('_', ' ')}</span></td>
                    <td>{canEdit && NEXT[o.status].map((n) => (
                      <button key={n.to} className="mfg-btn" onClick={() => void advance(o.id, n.to)} style={{ marginRight: 4 }}>{n.label}</button>
                    ))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {bomModal && <BomBuilderModal bomId={bomModal.id} onClose={() => setBomModal(null)} onSaved={() => { setBomModal(null); void load(); }} />}
      {orderModal && <CreateOrderModal boms={boms ?? []} onClose={() => setOrderModal(false)} onSaved={() => { setOrderModal(false); void load(); }} />}
    </div>
  );
}
```

- [ ] **Step 7: Write `BomBuilderModal.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { ProductPick } from '../../shared/types';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';

interface Row { product_id: string; qty: number; }

export default function BomBuilderModal({ bomId, onClose, onSaved }: { bomId?: string; onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<ProductPick[]>([]);
  const [name, setName] = useState('');
  const [outputId, setOutputId] = useState('');
  const [rows, setRows] = useState<Row[]>([{ product_id: '', qty: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await manufacturingApi.products();
        setProducts(p.items);
        if (bomId) {
          const d = await manufacturingApi.getBom(bomId);
          setName(d.name); setOutputId(d.output_product_id);
          setRows(d.components.map((c) => ({ product_id: c.component_product_id, qty: c.qty })));
        }
      } catch (e) { setError(e instanceof ManufacturingApiError ? e.code : 'load_failed'); }
    })();
  }, [bomId]);

  const save = async () => {
    setBusy(true); setError(null);
    const comps = rows.filter((r) => r.product_id && r.qty > 0);
    if (!name.trim() || !outputId || comps.length === 0) { setError('Fill name, output and at least one component.'); setBusy(false); return; }
    try {
      if (bomId) await manufacturingApi.updateBom(bomId, { name: name.trim(), components: comps });
      else await manufacturingApi.createBom({ name: name.trim(), output_product_id: outputId, components: comps });
      onSaved();
    } catch (e) { setError(e instanceof ManufacturingApiError ? e.code : 'save_failed'); setBusy(false); }
  };

  return (
    <div className="mfg-modal-backdrop" onClick={onClose}>
      <div className="mfg-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{bomId ? 'Edit BOM' : 'New BOM'}</h2>
        <label>Name<br /><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <p><label>Output product<br />
          <select value={outputId} onChange={(e) => setOutputId(e.target.value)} disabled={!!bomId}>
            <option value="">— select —</option>
            {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
          </select></label></p>
        <h4>Components</h4>
        {rows.map((r, i) => (
          <div className="mfg-comp-row" key={i}>
            <select value={r.product_id} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, product_id: e.target.value } : x))}>
              <option value="">— component —</option>
              {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
            </select>
            <input type="number" min={1} value={r.qty} style={{ width: 70 }}
              onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} />
            <button className="mfg-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="mfg-btn" onClick={() => setRows([...rows, { product_id: '', qty: 1 }])}>+ Add component</button>
        {error && <div className="mfg-shortfall">{error}</div>}
        <p style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="mfg-btn" onClick={onClose}>Cancel</button>
          <button className="mfg-btn primary" onClick={() => void save()} disabled={busy}>Save</button>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Write `CreateOrderModal.tsx`**

```tsx
import { useState } from 'react';
import type { BomListItem } from '../../shared/types';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';

export default function CreateOrderModal({ boms, onClose, onSaved }: { boms: BomListItem[]; onClose: () => void; onSaved: () => void }) {
  const [bomId, setBomId] = useState('');
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!bomId || qty <= 0) { setError('Pick a BOM and a positive quantity.'); return; }
    setBusy(true); setError(null);
    try { await manufacturingApi.createOrder({ bom_id: bomId, qty }); onSaved(); }
    catch (e) { setError(e instanceof ManufacturingApiError ? e.code : 'save_failed'); setBusy(false); }
  };

  return (
    <div className="mfg-modal-backdrop" onClick={onClose}>
      <div className="mfg-modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Production Order</h2>
        {boms.length === 0 && <div className="mfg-empty">Create a BOM first.</div>}
        <p><label>BOM<br />
          <select value={bomId} onChange={(e) => setBomId(e.target.value)}>
            <option value="">— select —</option>
            {boms.map((b) => <option key={b.id} value={b.id}>{b.name} → {b.output_product_name}</option>)}
          </select></label></p>
        <p><label>Quantity<br />
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} /></label></p>
        {error && <div className="mfg-shortfall">{error}</div>}
        <p style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="mfg-btn" onClick={onClose}>Cancel</button>
          <button className="mfg-btn primary" onClick={() => void save()} disabled={busy || boms.length === 0}>Create</button>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Mount the route in `src/lib/router.tsx`**

Add the import near the `InventoryListMount` import (line ~46):
```tsx
import { ManufacturingMount } from '../modules/manufacturing/ManufacturingRouteMounts';
```
Add the route next to the `inventory` route (line ~127), inside the same children array:
```tsx
              { path: 'manufacturing', element: <ManufacturingMount /> },
```

- [ ] **Step 10: Add the Sidebar entry in `src/modules/user-portal/layout/Sidebar.tsx`**

After the Finance `showFinance` block, add:
```tsx
  // Manufacturing appears when enabled AND Owner (all-on) or holds the view key.
  const manufacturingEnabled = enabledModules.some((m) => m.key === 'manufacturing');
  const showManufacturing = manufacturingEnabled && (
    isOwner ||
    permissions['manufacturing.products.view'] === true
  );
```
Add `showManufacturing` to the Modules-group guard condition (the big `(showProducts || … )` OR):
```tsx
        {(showProducts || showPos || showBooking || showInventory || showManufacturing || showAnalytics || showEmail || showFinance || items.length > 0) && (
```
Add the NavLink after the Inventory link:
```tsx
            {showManufacturing && (
              <NavLink to={`/c/${slug}/manufacturing`}>Manufacturing</NavLink>
            )}
```

- [ ] **Step 11: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `useUserAuth`'s `permissions`/`enabledModules`/`user.level_number` fields differ, align to the exact shape used by `InventoryRouteMounts.tsx`/`Sidebar.tsx` — they are the reference.)

- [ ] **Step 12: Commit**

```bash
git add src/modules/manufacturing tests/unit/manufacturing-permissions.test.ts src/lib/router.tsx src/modules/user-portal/layout/Sidebar.tsx
git commit -m "feat(manufacturing): frontend (BOM builder + orders) + route + sidebar"
```

---

### Task 8: Seed script

**Files:**
- Create: `scripts/seed-manufacturing.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DATABASE_URL`, `@neondatabase/serverless`. Mirrors `scripts/seed-inventory.ts` structure.

- [ ] **Step 1: Write `scripts/seed-manufacturing.ts`** (idempotent; default `papa-s-saloon`)

```ts
// Seed realistic Manufacturing demo data (default: papa-s-saloon).
//   npm run seed:manufacturing            # papa-s-saloon
//   npm run seed:manufacturing some-slug
// Idempotent: (1) enables products+pos+inventory+manufacturing, (2) ensures a
// few component products + a "Signature Beard Kit" output product with stock,
// (3) defines one BOM, (4) creates a planned + an in_progress order so the
// lists aren't empty. Golden flow to demo live: open Manufacturing → Complete
// the in_progress order → component stock falls, kit stock rises.
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL is not set (run via npm run seed:manufacturing).'); process.exit(1); }
const SLUG = process.argv[2] ?? 'papa-s-saloon';
const sql = neon(DATABASE_URL);

const COMPONENTS = [
  { sku: 'MFG-OIL-30', name: 'Beard Oil 30ml (component)', price: 700, stock: 200 },
  { sku: 'MFG-BALM-30', name: 'Beard Balm 30g (component)', price: 800, stock: 150 },
  { sku: 'MFG-COMB-01', name: 'Wooden Comb (component)', price: 300, stock: 120 },
];
const OUTPUT = { sku: 'MFG-KIT-01', name: 'Signature Beard Kit', price: 2500 };

async function upsertProduct(clientId: string, p: { sku: string; name: string; price: number }): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.products (client_id, type, name, price_cents, pos_visible, status)
    VALUES (${clientId}, 'physical', ${p.name}, ${p.price}, true, 'active')
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;
  if (rows[0]) return rows[0].id;
  const found = (await sql`
    SELECT id FROM public.products WHERE client_id = ${clientId} AND name = ${p.name} LIMIT 1
  `) as Array<{ id: string }>;
  return found[0]!.id;
}

async function main(): Promise<void> {
  const clients = (await sql`SELECT id FROM public.clients WHERE slug = ${SLUG} LIMIT 1`) as Array<{ id: string }>;
  if (!clients[0]) { console.error(`No client with slug "${SLUG}".`); process.exit(1); }
  const clientId = clients[0].id;

  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key)
    VALUES (${clientId}, 'products'), (${clientId}, 'pos'), (${clientId}, 'inventory'), (${clientId}, 'manufacturing')
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
  await sql`UPDATE public.clients SET inventory_tracking_enabled = true WHERE id = ${clientId}`;

  const compIds: string[] = [];
  for (const c of COMPONENTS) {
    const id = await upsertProduct(clientId, c);
    compIds.push(id);
    await sql`
      INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
      VALUES (${clientId}, ${id}, ${c.stock}, 20)
      ON CONFLICT (client_id, product_id) DO UPDATE SET qty_on_hand = ${c.stock}
    `;
  }
  const outputId = await upsertProduct(clientId, OUTPUT);
  await sql`
    INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
    VALUES (${clientId}, ${outputId}, 0, 5)
    ON CONFLICT (client_id, product_id) DO NOTHING
  `;

  // One BOM (idempotent on name).
  let bomId: string;
  const existingBom = (await sql`
    SELECT id FROM public.boms WHERE client_id = ${clientId} AND name = 'Signature Beard Kit' LIMIT 1
  `) as Array<{ id: string }>;
  if (existingBom[0]) {
    bomId = existingBom[0].id;
  } else {
    const bomRows = (await sql`
      INSERT INTO public.boms (client_id, output_product_id, name)
      VALUES (${clientId}, ${outputId}, 'Signature Beard Kit') RETURNING id
    `) as Array<{ id: string }>;
    bomId = bomRows[0]!.id;
    await sql`
      INSERT INTO public.bom_components (bom_id, component_product_id, qty)
      VALUES (${bomId}, ${compIds[0]}, 1), (${bomId}, ${compIds[1]}, 1), (${bomId}, ${compIds[2]}, 1)
      ON CONFLICT (bom_id, component_product_id) DO NOTHING
    `;
  }

  // Demo orders: one planned, one in_progress (only if none exist for this bom).
  const haveOrders = (await sql`SELECT 1 FROM public.production_orders WHERE bom_id = ${bomId} LIMIT 1`) as unknown[];
  if (haveOrders.length === 0) {
    await sql`
      INSERT INTO public.production_orders (client_id, bom_id, qty, status)
      VALUES (${clientId}, ${bomId}, 10, 'planned'), (${clientId}, ${bomId}, 25, 'in_progress')
    `;
  }
  console.log(`Seeded Manufacturing demo for "${SLUG}".`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script** in `package.json` after `seed:procurement`:
```json
    "seed:procurement": "tsx --env-file=.env scripts/seed-procurement.ts",
    "seed:manufacturing": "tsx --env-file=.env scripts/seed-manufacturing.ts"
```

- [ ] **Step 3: Run the seed against dev**

Run: `npm run seed:manufacturing`
Expected: `Seeded Manufacturing demo for "papa-s-saloon".` Re-run once → same message, no duplicate rows (idempotent).

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-manufacturing.ts package.json
git commit -m "feat(manufacturing): seed script + seed:manufacturing npm script"
```

---

### Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 2: Full test suite** (Iron: the WHOLE suite, not just manufacturing)

Run: `npm run test`
Expected: all green, including the new `tests/manufacturing/*` and `tests/unit/manufacturing-*`. If a pre-existing unrelated test flakes on the shared DB, re-run once; investigate only genuine failures introduced here.

- [ ] **Step 3: Final commit if anything was adjusted**

```bash
git add -p   # stage only intended hunks
git commit -m "chore(manufacturing): verification pass — typecheck + full suite green"
```

## Self-Review notes (author)

- **Spec coverage:** migration (T1), authz enable-gate+L1 (T3), bucket×verb keys (T2/T3), BOM CRUD (T4), order create/list (T5), FSM + consume/produce + reject-shortfall (T6), registry/sidebar/route (T2/T7), seed (T8), tests throughout, full verify (T9). All spec sections mapped.
- **Duplicate-component** handled via `23505` → 400 in both create (T4) and PUT.
- **`sql.transaction`** used with an array of tagged queries (neon supports this — see `inventory-adjust.ts`).
- **Type consistency:** wire field names (`output_product_name`, `component_count`, `shortfalls[].{product_id,name,need,have}`, `status`) are identical across handler, types.ts, api.ts, page, and tests.
