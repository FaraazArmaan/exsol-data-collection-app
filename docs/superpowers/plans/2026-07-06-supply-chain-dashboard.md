# Supply Chain Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only cross-module "Supply Chain" dashboard at `/c/:slug/supply-chain` that aggregates low-stock, open POs, in-progress production, and 30-day stock-movement volume over existing tables — zero migrations.

**Architecture:** Mirror the Analytics module. Three flat, independently-fetched GET aggregation functions (`supply-chain-inventory` / `-procurement` / `-manufacturing`) gated by one bucket permission (`supply-chain.products.view`, Owner-bypassed). A route-lazy React module renders one purpose-built section per backing module, each self-gated on `enabledModules`. Tenant-wide `client_id` scope (no subtree). Data is seeded for `papa-s-saloon`.

**Tech Stack:** Netlify Functions v2 (flat `.ts`), Neon Postgres (`@neondatabase/serverless`), React 18 + Vite, recharts (already a dependency), vitest.

## Global Constraints

- **No migration.** Pure read-projection; create no tables. (Highest existing migration is 061.)
- **Iron rule #1/#5:** Netlify functions are flat top-level files. `/api/foo` routes to `foo.ts`. Each of the 3 endpoints has a distinct `config.path`, all `GET` — no path/method collisions.
- **Iron rule #2:** authz = enable-gate THEN `level_number === 1` Owner bypass — in `_supply-chain-authz.ts` AND Sidebar AND RouteMount. `level_number == null` counts as Owner.
- **Iron rule #3:** permission keys are `<module>.<bucket>.<verb>` ONLY. The one key is `supply-chain.products.view`. Never action-namespaced.
- **Iron rule #4:** a ModuleManifest is invisible without a ProductManifest entry.
- **Iron rule #6:** tests share one persistent dev DB (no teardown). Randomize unique-constrained literals. These handlers touch **no** Blobs → **no `getStore` mock**.
- **Iron rule #7/#8:** never `git push`; confirm `git branch --show-current` == `feat/supply-chain-iso` before the first commit. Stage by path (never `git add -A` in a sibling worktree).
- **Neon serialization:** `BIGINT` returns as string → `Number()` it. Emit dates as `to_char(..., 'YYYY-MM-DD')` to avoid the local-midnight→UTC shift. Money is integer cents; INR formatting is frontend-only.
- **Matrix shape:** `getLevelMatrix` and `UserPortalPermissionMatrix` are `Record<string, true>` — check with `matrix[key]` / `=== true`, never `boolean`.
- **Worktree:** `../ExSol-SupplyChain-WT`, branch `feat/supply-chain-iso`, base `main @ b2d7a0a`.
- **Definition of done:** `npm run typecheck` AND the FULL vitest suite both green.

---

### Task 1: Registry — manifest, product, registration

**Files:**
- Create: `src/modules/registry/manifests/supply-chain.ts`
- Create: `src/modules/registry/products-list/supply-chain.ts`
- Modify: `src/modules/registry/modules.ts` (import + map entry)
- Modify: `src/modules/registry/products.ts` (import + map entry)
- Test: `src/modules/registry/__tests__/supply-chain-manifest.test.ts`

**Interfaces:**
- Produces: module key `'supply-chain'`, product key `'supply-chain'`, permission key `'supply-chain.products.view'`. The `ModuleManifest`/`ProductManifest` types are in `src/modules/registry/types.ts`.

- [ ] **Step 1: Write the failing test**

`src/modules/registry/__tests__/supply-chain-manifest.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getModule } from '../modules';
import { getProduct } from '../products';
import { isValidPermissionKey } from '../../../../netlify/functions/_shared/permission-keys';

describe('supply-chain registry', () => {
  it('module registered: products bucket, view-only, vendor-side', () => {
    const m = getModule('supply-chain');
    expect(m).toBeTruthy();
    expect(m!.data_buckets).toEqual(['products']);
    expect(m!.verbs).toEqual(['view']);
    expect(m!.vendor_side).toBe(true);
  });

  it('product brings in the module', () => {
    const p = getProduct('supply-chain');
    expect(p).toBeTruthy();
    expect(p!.modules.some((r) => r.module === 'supply-chain')).toBe(true);
    expect(p!.requires).toBeUndefined();
  });

  it('supply-chain.products.view validates when the product is enabled', () => {
    expect(isValidPermissionKey('supply-chain.products.view', ['supply-chain'])).toBe(true);
  });

  it('rejects a bucket the module does not declare', () => {
    expect(isValidPermissionKey('supply-chain.business.view', ['supply-chain'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- src/modules/registry/__tests__/supply-chain-manifest.test.ts`
Expected: FAIL (`getModule('supply-chain')` is undefined).

> Note the test import path has FOUR `../` up to repo root then into `netlify/` (`__tests__` → `registry` → `modules` → `src` → repo root). Adjust if your runner reports a resolution error.

- [ ] **Step 3: Create the manifest**

`src/modules/registry/manifests/supply-chain.ts`:
```ts
import type { ModuleManifest } from '../types';

// Supply Chain — a read-only cross-module dashboard over Inventory, Procurement,
// and Manufacturing. All three are product-catalog data, so it uses the 'products'
// bucket → the single key supply-chain.products.view. Toggle per client via the
// `supply-chain` Product (see products-list/supply-chain.ts).
export const supplyChainManifest: ModuleManifest = {
  key: 'supply-chain',
  label: 'Supply Chain',
  data_buckets: ['products'],
  verbs: ['view'],
  vendor_side: true,
  customer_side: false,
};
```

- [ ] **Step 4: Create the product**

`src/modules/registry/products-list/supply-chain.ts`:
```ts
import type { ProductManifest } from '../types';

// Standalone-enablable (no `requires`): the dashboard self-gates each panel on
// whether the backing module (inventory/procurement/manufacturing) is enabled.
export const supplyChainProduct: ProductManifest = {
  key: 'supply-chain',
  label: 'Supply Chain',
  modules: [
    { module: 'supply-chain', side: 'vendor' },
  ],
};
```

- [ ] **Step 5: Register the module** in `src/modules/registry/modules.ts`

Add the import next to the other manifest imports (near line 12):
```ts
import { supplyChainManifest } from './manifests/supply-chain';
```
Add the map entry inside `moduleRegistry` (next to `analytics: analyticsManifest,`):
```ts
  'supply-chain': supplyChainManifest,
```

- [ ] **Step 6: Register the product** in `src/modules/registry/products.ts`

Add the import next to the other product imports (near line 11):
```ts
import { supplyChainProduct } from './products-list/supply-chain';
```
Add the map entry inside `productRegistry` (next to `'analytics': analyticsProduct,`):
```ts
  'supply-chain': supplyChainProduct,
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run test -- src/modules/registry/__tests__/supply-chain-manifest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add src/modules/registry/manifests/supply-chain.ts src/modules/registry/products-list/supply-chain.ts src/modules/registry/modules.ts src/modules/registry/products.ts src/modules/registry/__tests__/supply-chain-manifest.test.ts
git commit -m "feat(supply-chain): registry manifest + product + registration"
```

---

### Task 2: Backend authz helper `_supply-chain-authz.ts`

**Files:**
- Create: `netlify/functions/_supply-chain-authz.ts`
- Create: `tests/supply-chain/_helpers.ts` (shared test seeders — first use here)
- Test: `tests/supply-chain/authz.test.ts`

**Interfaces:**
- Produces: `resolveSupplyChainAccess(req): Promise<{ ok: true; access: { clientId: string } } | { ok: false; res: Response }>`. Enforces `supply-chain.products.view` (Owner/admin bypass). Consumed by all 3 endpoints.
- `tests/supply-chain/_helpers.ts` produces: `rand()`, `seedInventoryData(clientId)`, `seedProcurementData(clientId)`, `seedManufacturingData(clientId)`.

- [ ] **Step 1: Write the shared test helpers** `tests/supply-chain/_helpers.ts`

```ts
import { db } from '../../netlify/functions/_shared/db';
import { seedProducts } from '../pos/_helpers';

const sql = db();

export function rand(): string {
  return Math.random().toString(36).slice(2, 7);
}

// Inventory: one below-reorder product, one healthy; movements across the window.
export async function seedInventoryData(
  clientId: string,
): Promise<{ lowProductId: string; okProductId: string }> {
  const [lowId, okId] = await seedProducts(clientId, [
    { name: `LowStock ${rand()}` },
    { name: `OkStock ${rand()}` },
  ]);
  await sql`
    INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
    VALUES (${clientId}::uuid, ${lowId}::uuid, 2, 10),
           (${clientId}::uuid, ${okId}::uuid, 50, 10)
  `;
  await sql`
    INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_at)
    VALUES
      (${clientId}::uuid, ${lowId}::uuid, -5, 'sale',     'demo', now() - interval '2 days'),
      (${clientId}::uuid, ${okId}::uuid,  20, 'purchase', 'demo', now() - interval '2 days'),
      (${clientId}::uuid, ${okId}::uuid,  -3, 'sale',     'demo', now() - interval '10 days')
  `;
  return { lowProductId: lowId!, okProductId: okId! };
}

// Procurement: one 'ordered' PO (qty 10 @ 5000c = 50000c) + one 'received' (must be excluded).
export async function seedProcurementData(clientId: string): Promise<{ orderedPoId: string }> {
  const [pid] = await seedProducts(clientId, [{ name: `PO Product ${rand()}` }]);
  const supplierRows = (await sql`
    INSERT INTO public.suppliers (client_id, name)
    VALUES (${clientId}::uuid, ${`Supplier ${rand()}`})
    RETURNING id
  `) as Array<{ id: string }>;
  const supplierId = supplierRows[0]!.id;
  const orderedRows = (await sql`
    INSERT INTO public.purchase_orders (client_id, supplier_id, status, expected_on, notes)
    VALUES (${clientId}::uuid, ${supplierId}::uuid, 'ordered', (now() + interval '5 days')::date, 'demo')
    RETURNING id
  `) as Array<{ id: string }>;
  const orderedPoId = orderedRows[0]!.id;
  await sql`
    INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
    VALUES (${orderedPoId}::uuid, ${pid}::uuid, 10, 5000)
  `;
  await sql`
    INSERT INTO public.purchase_orders (client_id, supplier_id, status, notes)
    VALUES (${clientId}::uuid, ${supplierId}::uuid, 'received', 'closed')
  `;
  return { orderedPoId };
}

// Manufacturing: one 'in_progress' order (qty 30) + one 'planned' (must be excluded).
export async function seedManufacturingData(clientId: string): Promise<void> {
  const [outProd] = await seedProducts(clientId, [{ name: `Made ${rand()}` }]);
  const bomRows = (await sql`
    INSERT INTO public.boms (client_id, output_product_id, name)
    VALUES (${clientId}::uuid, ${outProd}::uuid, ${`BOM ${rand()}`})
    RETURNING id
  `) as Array<{ id: string }>;
  const bomId = bomRows[0]!.id;
  await sql`
    INSERT INTO public.production_orders (client_id, bom_id, qty, status)
    VALUES (${clientId}::uuid, ${bomId}::uuid, 30, 'in_progress'),
           (${clientId}::uuid, ${bomId}::uuid,  5, 'planned')
  `;
}
```

- [ ] **Step 2: Write the failing authz test** `tests/supply-chain/authz.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolveSupplyChainAccess } from '../../netlify/functions/_supply-chain-authz';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';

describe('resolveSupplyChainAccess', () => {
  it('owner (L1) is allowed and gets their clientId', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []); // L1 owner bypasses the matrix
    const out = await resolveSupplyChainAccess(
      makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-inventory'),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.access.clientId).toBe(ctx.clientId);
  });

  it('a sub holding supply-chain.products.view is allowed', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, ['supply-chain.products.view']);
    const out = await resolveSupplyChainAccess(
      makeBucketUserRequest(sub, 'GET', '/api/supply-chain-inventory'),
    );
    expect(out.ok).toBe(true);
  });

  it('a sub without the key is 403', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, []);
    const out = await resolveSupplyChainAccess(
      makeBucketUserRequest(sub, 'GET', '/api/supply-chain-inventory'),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.res.status).toBe(403);
  });

  it('no session is 401', async () => {
    const out = await resolveSupplyChainAccess(new Request('http://localhost/api/supply-chain-inventory'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test -- tests/supply-chain/authz.test.ts`
Expected: FAIL (module `_supply-chain-authz` not found).

- [ ] **Step 4: Implement** `netlify/functions/_supply-chain-authz.ts`

```ts
// Supply-chain authorization. Tenant-wide (client_id) — the backing tables carry
// no user_node scoping, so there is no subtree resolver (unlike analytics).
// Gate = the single bucket key supply-chain.products.view, with admin + L1 Owner bypass.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import {
  requireAdmin, requireBucketUser, getLevelMatrix, UnauthorizedError,
} from './_shared/permissions';

const REQUIRED_KEY = 'supply-chain.products.view';

export interface SupplyChainAccess {
  clientId: string;
}

export async function resolveSupplyChainAccess(
  req: Request,
): Promise<{ ok: true; access: SupplyChainAccess } | { ok: false; res: Response }> {
  // 1. Admin → full tenant. Admins act on a client via ?client=.
  try {
    await requireAdmin(req);
    const clientId = new URL(req.url).searchParams.get('client');
    if (!clientId) return { ok: false, res: jsonError(400, 'missing_client') };
    return { ok: true, access: { clientId } };
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
    // not admin — fall through
  }

  // 2. Bucket-user.
  let credential: { user_node_id: string; client_id: string };
  try {
    const r = await requireBucketUser(req);
    credential = r.credential;
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, res: jsonError(401, 'unauthorized') };
    throw e;
  }

  const sql = db();
  const nodeRows = (await sql`
    SELECT level_number, client_id FROM public.user_nodes
    WHERE id = ${credential.user_node_id}::uuid LIMIT 1
  `) as Array<{ level_number: number | null; client_id: string }>;
  if (nodeRows.length === 0) return { ok: false, res: jsonError(401, 'unauthorized') };

  const levelNumber = nodeRows[0]!.level_number ?? 1; // legacy null level → Primary/Owner
  const clientId = nodeRows[0]!.client_id;
  const isOwner = levelNumber === 1;

  if (!isOwner) {
    const matrix = await getLevelMatrix(clientId, levelNumber);
    if (!matrix[REQUIRED_KEY]) return { ok: false, res: jsonError(403, 'forbidden') };
  }

  return { ok: true, access: { clientId } };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/supply-chain/authz.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_supply-chain-authz.ts tests/supply-chain/_helpers.ts tests/supply-chain/authz.test.ts
git commit -m "feat(supply-chain): authz resolver (bucket gate + owner bypass, tenant-wide)"
```

---

### Task 3: `supply-chain-inventory.ts` endpoint

**Files:**
- Create: `netlify/functions/supply-chain-inventory.ts`
- Test: `tests/supply-chain/inventory.test.ts`

**Interfaces:**
- Consumes: `resolveSupplyChainAccess` (Task 2); `seedInventoryData`, `rand` (Task 2 helpers).
- Produces: `GET /api/supply-chain-inventory` → `{ kpis:{lowStockCount,movementVolume30d}, lowStock:[{productId,name,sku,qtyOnHand,reorderLevel,deficit}], movementSeries:[{day,volume}], generatedAt }`. `movementSeries` is exactly 30 rows (zero-filled).

- [ ] **Step 1: Write the failing test** `tests/supply-chain/inventory.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-inventory';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';
import { seedInventoryData } from './_helpers';

describe('GET /api/supply-chain-inventory', () => {
  it('returns low-stock rows, 30-day zero-filled series, and KPIs', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    await seedInventoryData(ctx.clientId);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-inventory'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // exactly one product is below reorder (qty 2 <= 10)
    expect(body.lowStock.length).toBe(1);
    expect(body.lowStock[0].qtyOnHand).toBe(2);
    expect(body.lowStock[0].reorderLevel).toBe(10);
    expect(body.lowStock[0].deficit).toBe(8);
    expect(body.kpis.lowStockCount).toBe(1);

    // series is a full 30-day window; volume = sum(abs(qty_delta)) = 5+20+3 = 28
    expect(body.movementSeries.length).toBe(30);
    expect(body.kpis.movementVolume30d).toBe(28);
    const total = body.movementSeries.reduce((a: number, p: any) => a + p.volume, 0);
    expect(total).toBe(28);
  });

  it('is 403 for a sub without the key', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/supply-chain-inventory'));
    expect(res.status).toBe(403);
  });

  it('does not leak another tenant’s rows', async () => {
    const a = await seedClientWithProductsEnabled();
    await grantPerms(a.clientId, 1, []);
    const b = await seedClientWithProductsEnabled();
    await seedInventoryData(b.clientId); // b has low-stock; a must not see it
    const res = await handler(makeBucketUserRequest(a, 'GET', '/api/supply-chain-inventory'));
    const body = await res.json();
    expect(body.lowStock.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- tests/supply-chain/inventory.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `netlify/functions/supply-chain-inventory.ts`

```ts
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess } from './_supply-chain-authz';

export const config = { path: '/api/supply-chain-inventory', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  const sql = db();
  const tzRows = (await sql`
    SELECT timezone FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ timezone: string }>;
  const tz = tzRows[0]?.timezone ?? 'UTC';

  const lowStock = (await sql`
    SELECT s.product_id AS "productId", p.name, p.sku,
           s.qty_on_hand AS "qtyOnHand", s.reorder_level AS "reorderLevel",
           (s.reorder_level - s.qty_on_hand) AS deficit
    FROM public.inventory_stock s
    JOIN public.products p ON p.id = s.product_id AND p.deleted_at IS NULL
    WHERE s.client_id = ${clientId}::uuid
      AND s.qty_on_hand <= s.reorder_level
    ORDER BY (s.reorder_level - s.qty_on_hand) DESC
    LIMIT 100
  `) as Array<{
    productId: string; name: string; sku: string | null;
    qtyOnHand: number; reorderLevel: number; deficit: number;
  }>;

  const seriesRows = (await sql`
    WITH days AS (
      SELECT generate_series(
        (date_trunc('day', now() AT TIME ZONE ${tz}) - interval '29 days'),
        date_trunc('day', now() AT TIME ZONE ${tz}),
        interval '1 day'
      )::date AS day
    ),
    vol AS (
      SELECT date_trunc('day', created_at AT TIME ZONE ${tz})::date AS day,
             sum(abs(qty_delta))::int AS volume
      FROM public.stock_movements
      WHERE client_id = ${clientId}::uuid
        AND created_at >= (now() - interval '30 days')
      GROUP BY 1
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(v.volume, 0) AS volume
    FROM days d
    LEFT JOIN vol v ON v.day = d.day
    ORDER BY d.day
  `) as Array<{ day: string; volume: number | string }>;

  const movementSeries = seriesRows.map((r) => ({ day: r.day, volume: Number(r.volume) }));
  const movementVolume30d = movementSeries.reduce((a, r) => a + r.volume, 0);

  return jsonOk({
    kpis: { lowStockCount: lowStock.length, movementVolume30d },
    lowStock,
    movementSeries,
    generatedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/supply-chain/inventory.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/supply-chain-inventory.ts tests/supply-chain/inventory.test.ts
git commit -m "feat(supply-chain): inventory endpoint (low-stock + 30-day movement series)"
```

---

### Task 4: `supply-chain-procurement.ts` endpoint

**Files:**
- Create: `netlify/functions/supply-chain-procurement.ts`
- Test: `tests/supply-chain/procurement.test.ts`

**Interfaces:**
- Consumes: `resolveSupplyChainAccess`; `seedProcurementData`.
- Produces: `GET /api/supply-chain-procurement` → `{ kpis:{openPoCount,openValueCents}, openPos:[{id,supplier,status,expectedOn,itemCount,totalCents}], generatedAt }`. Only `status='ordered'`.

- [ ] **Step 1: Write the failing test** `tests/supply-chain/procurement.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-procurement';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';
import { seedProcurementData } from './_helpers';

describe('GET /api/supply-chain-procurement', () => {
  it('returns only ordered POs with computed totals', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    await seedProcurementData(ctx.clientId); // 1 ordered (10@5000=50000c) + 1 received

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-procurement'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.openPos.length).toBe(1);
    expect(body.openPos[0].status).toBe('ordered');
    expect(body.openPos[0].itemCount).toBe(1);
    expect(body.openPos[0].totalCents).toBe(50000);
    expect(body.openPos[0].expectedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.kpis.openPoCount).toBe(1);
    expect(body.kpis.openValueCents).toBe(50000);
  });

  it('is 403 for a sub without the key', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/supply-chain-procurement'));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- tests/supply-chain/procurement.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `netlify/functions/supply-chain-procurement.ts`

```ts
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess } from './_supply-chain-authz';

export const config = { path: '/api/supply-chain-procurement', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  const sql = db();
  const rows = (await sql`
    SELECT po.id, s.name AS supplier, po.status,
           to_char(po.expected_on, 'YYYY-MM-DD') AS "expectedOn",
           COALESCE(li.item_count, 0) AS "itemCount",
           COALESCE(li.total_cents, 0) AS "totalCents"
    FROM public.purchase_orders po
    JOIN public.suppliers s ON s.id = po.supplier_id
    LEFT JOIN (
      SELECT purchase_order_id,
             count(*)::int AS item_count,
             sum(qty * unit_cost_cents)::bigint AS total_cents
      FROM public.purchase_order_items
      GROUP BY purchase_order_id
    ) li ON li.purchase_order_id = po.id
    WHERE po.client_id = ${clientId}::uuid
      AND po.status = 'ordered'
    ORDER BY po.expected_on ASC NULLS LAST, po.created_at DESC
    LIMIT 100
  `) as Array<{
    id: string; supplier: string; status: string; expectedOn: string | null;
    itemCount: number | string; totalCents: number | string;
  }>;

  const openPos = rows.map((r) => ({
    id: r.id, supplier: r.supplier, status: r.status, expectedOn: r.expectedOn,
    itemCount: Number(r.itemCount), totalCents: Number(r.totalCents),
  }));
  const openValueCents = openPos.reduce((a, r) => a + r.totalCents, 0);

  return jsonOk({
    kpis: { openPoCount: openPos.length, openValueCents },
    openPos,
    generatedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/supply-chain/procurement.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/supply-chain-procurement.ts tests/supply-chain/procurement.test.ts
git commit -m "feat(supply-chain): procurement endpoint (open POs + computed totals)"
```

---

### Task 5: `supply-chain-manufacturing.ts` endpoint

**Files:**
- Create: `netlify/functions/supply-chain-manufacturing.ts`
- Test: `tests/supply-chain/manufacturing.test.ts`

**Interfaces:**
- Consumes: `resolveSupplyChainAccess`; `seedManufacturingData`.
- Produces: `GET /api/supply-chain-manufacturing` → `{ kpis:{inProgressCount,unitsInProduction}, orders:[{id,product,bomName,qty,createdAt}], generatedAt }`. Only `status='in_progress'`; product via `boms.output_product_id`.

- [ ] **Step 1: Write the failing test** `tests/supply-chain/manufacturing.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-manufacturing';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';
import { seedManufacturingData } from './_helpers';

describe('GET /api/supply-chain-manufacturing', () => {
  it('returns only in_progress orders with the BOM output product', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    await seedManufacturingData(ctx.clientId); // 1 in_progress (qty 30) + 1 planned

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-manufacturing'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.orders.length).toBe(1);
    expect(body.orders[0].qty).toBe(30);
    expect(typeof body.orders[0].product).toBe('string');
    expect(body.orders[0].product.startsWith('Made')).toBe(true);
    expect(body.kpis.inProgressCount).toBe(1);
    expect(body.kpis.unitsInProduction).toBe(30);
  });

  it('is 403 for a sub without the key', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedSubordinateUser(base, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/supply-chain-manufacturing'));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- tests/supply-chain/manufacturing.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `netlify/functions/supply-chain-manufacturing.ts`

```ts
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess } from './_supply-chain-authz';

export const config = { path: '/api/supply-chain-manufacturing', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  const sql = db();
  const rows = (await sql`
    SELECT po.id, p.name AS product, b.name AS "bomName", po.qty,
           to_char(po.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "createdAt"
    FROM public.production_orders po
    JOIN public.boms b ON b.id = po.bom_id
    JOIN public.products p ON p.id = b.output_product_id AND p.deleted_at IS NULL
    WHERE po.client_id = ${clientId}::uuid
      AND po.status = 'in_progress'
    ORDER BY po.created_at DESC
    LIMIT 100
  `) as Array<{ id: string; product: string; bomName: string; qty: number | string; createdAt: string }>;

  const orders = rows.map((r) => ({ ...r, qty: Number(r.qty) }));
  const unitsInProduction = orders.reduce((a, r) => a + r.qty, 0);

  return jsonOk({
    kpis: { inProgressCount: orders.length, unitsInProduction },
    orders,
    generatedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/supply-chain/manufacturing.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/supply-chain-manufacturing.ts tests/supply-chain/manufacturing.test.ts
git commit -m "feat(supply-chain): manufacturing endpoint (in-progress production orders)"
```

---

### Task 6: Frontend data layer — types, api, format, hook, gating

**Files:**
- Create: `src/modules/supply-chain/types.ts`
- Create: `src/modules/supply-chain/api.ts`
- Create: `src/modules/supply-chain/format.ts`
- Create: `src/modules/supply-chain/gating.ts`
- Create: `src/modules/supply-chain/hooks/useSupplyChain.ts`
- Test: `src/modules/supply-chain/__tests__/data-layer.test.ts`

**Interfaces:**
- Produces: `SectionKey`, `InventoryResponse`, `ProcurementResponse`, `ManufacturingResponse` (types); `fetchSection<T>(section)`; `formatCents`, `formatCount`; `visibleSectionsFor(enabledModuleKeys: Set<string>): SectionKey[]`; `useSupplyChain<T>(section)`.

- [ ] **Step 1: Write the failing test** `src/modules/supply-chain/__tests__/data-layer.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { visibleSectionsFor } from '../gating';
import { formatCents, formatCount } from '../format';
import { fetchSection } from '../api';
import { useSupplyChain } from '../hooks/useSupplyChain';

afterEach(() => vi.unstubAllGlobals());

describe('gating', () => {
  it('shows only sections whose backing module is enabled', () => {
    expect(visibleSectionsFor(new Set(['inventory']))).toEqual(['inventory']);
    expect(visibleSectionsFor(new Set(['procurement', 'manufacturing', 'pos'])))
      .toEqual(['procurement', 'manufacturing']);
    expect(visibleSectionsFor(new Set())).toEqual([]);
  });
});

describe('format', () => {
  it('formats cents as INR and counts with grouping', () => {
    expect(formatCents(50000)).toContain('500');
    expect(formatCount(1234)).toBe('1,234');
  });
});

describe('fetchSection', () => {
  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    await expect(fetchSection('inventory')).rejects.toThrow('403');
  });
});

describe('useSupplyChain', () => {
  it('resolves to data on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: 1 }) })));
    const { result } = renderHook(() => useSupplyChain('inventory'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ ok: 1 });
    expect(result.current.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- src/modules/supply-chain/__tests__/data-layer.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `types.ts`**

```ts
export type SectionKey = 'inventory' | 'procurement' | 'manufacturing';

export interface InventoryResponse {
  kpis: { lowStockCount: number; movementVolume30d: number };
  lowStock: {
    productId: string; name: string; sku: string | null;
    qtyOnHand: number; reorderLevel: number; deficit: number;
  }[];
  movementSeries: { day: string; volume: number }[];
  generatedAt: string;
}

export interface ProcurementResponse {
  kpis: { openPoCount: number; openValueCents: number };
  openPos: {
    id: string; supplier: string; status: string; expectedOn: string | null;
    itemCount: number; totalCents: number;
  }[];
  generatedAt: string;
}

export interface ManufacturingResponse {
  kpis: { inProgressCount: number; unitsInProduction: number };
  orders: { id: string; product: string; bomName: string; qty: number; createdAt: string }[];
  generatedAt: string;
}
```

- [ ] **Step 4: Implement `api.ts`**

```ts
import type { SectionKey } from './types';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

const ENDPOINT: Record<SectionKey, string> = {
  inventory: '/api/supply-chain-inventory',
  procurement: '/api/supply-chain-procurement',
  manufacturing: '/api/supply-chain-manufacturing',
};

export function fetchSection<T>(section: SectionKey): Promise<T> {
  return get<T>(ENDPOINT[section]);
}
```

- [ ] **Step 5: Implement `format.ts`**

```ts
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

// Chart theme (kept local to the module; the only recharts-adjacent constants).
export const CHART_FILL = '#6366f1';
export const AXIS_STROKE = '#64748b';
export const GRID_STROKE = '#e2e8f0';
```

- [ ] **Step 6: Implement `gating.ts`**

```ts
import type { SectionKey } from './types';

const SECTION_MODULE: Record<SectionKey, string> = {
  inventory: 'inventory',
  procurement: 'procurement',
  manufacturing: 'manufacturing',
};

const ORDER: SectionKey[] = ['inventory', 'procurement', 'manufacturing'];

// A section shows only when its backing module is enabled for the client.
export function visibleSectionsFor(enabledModuleKeys: Set<string>): SectionKey[] {
  return ORDER.filter((k) => enabledModuleKeys.has(SECTION_MODULE[k]));
}
```

- [ ] **Step 7: Implement `hooks/useSupplyChain.ts`**

```ts
import { useEffect, useState } from 'react';
import { fetchSection } from '../api';
import type { SectionKey } from '../types';

interface State<T> { data: T | null; loading: boolean; error: string | null; }

export function useSupplyChain<T>(section: SectionKey): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    setState({ data: null, loading: true, error: null });
    fetchSection<T>(section)
      .then((d) => { if (alive) setState({ data: d, loading: false, error: null }); })
      .catch((e) => { if (alive) setState({ data: null, loading: false, error: String(e?.message ?? e) }); });
    return () => { alive = false; };
  }, [section]);
  return state;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test -- src/modules/supply-chain/__tests__/data-layer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add src/modules/supply-chain/types.ts src/modules/supply-chain/api.ts src/modules/supply-chain/format.ts src/modules/supply-chain/gating.ts src/modules/supply-chain/hooks/useSupplyChain.ts src/modules/supply-chain/__tests__/data-layer.test.ts
git commit -m "feat(supply-chain): frontend data layer (types, api, hook, gating, format)"
```

---

### Task 7: Frontend components + CSS

**Files:**
- Create: `src/modules/supply-chain/supply-chain.css`
- Create: `src/modules/supply-chain/components/KpiTile.tsx`
- Create: `src/modules/supply-chain/components/Section.tsx`
- Create: `src/modules/supply-chain/components/MovementChart.tsx`
- Create: `src/modules/supply-chain/components/InventorySection.tsx`
- Create: `src/modules/supply-chain/components/ProcurementSection.tsx`
- Create: `src/modules/supply-chain/components/ManufacturingSection.tsx`
- Create: `src/modules/supply-chain/components/SupplyChainDashboard.tsx`
- Test: `src/modules/supply-chain/__tests__/SupplyChainDashboard.test.tsx`

**Interfaces:**
- Consumes: `useSupplyChain`, `visibleSectionsFor`, `formatCents`, `formatCount`, response types (Task 6); `useUserAuth` from `../../user-portal/user-auth-context` (returns `{ enabledModules: {key,label}[] }`).
- Produces: `SupplyChainDashboard` (named export) rendering visible sections; each section fetches independently and handles loading/error/empty.

- [ ] **Step 1: Write the failing test** `src/modules/supply-chain/__tests__/SupplyChainDashboard.test.tsx`

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SupplyChainDashboard } from '../components/SupplyChainDashboard';

let enabledModules: { key: string; label: string }[] = [];
vi.mock('../../user-portal/user-auth-context', () => ({
  useUserAuth: () => ({ enabledModules }),
}));

const INV = {
  kpis: { lowStockCount: 1, movementVolume30d: 28 },
  lowStock: [{ productId: 'p1', name: 'Shampoo', sku: null, qtyOnHand: 2, reorderLevel: 10, deficit: 8 }],
  movementSeries: [{ day: '2026-07-01', volume: 28 }],
  generatedAt: 'x',
};

beforeEach(() => {
  enabledModules = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('inventory') ? INV : { kpis: {}, generatedAt: 'x' }),
  })));
});
afterEach(() => vi.unstubAllGlobals());

describe('SupplyChainDashboard', () => {
  it('shows the empty-all state when no backing module is enabled', () => {
    enabledModules = [];
    render(<SupplyChainDashboard />);
    expect(screen.getByText(/No supply-chain modules are enabled/i)).toBeInTheDocument();
  });

  it('renders the Inventory section (with data) when inventory is enabled', async () => {
    enabledModules = [{ key: 'inventory', label: 'Inventory' }];
    render(<SupplyChainDashboard />);
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Shampoo')).toBeInTheDocument());
    // procurement section absent
    expect(screen.queryByRole('heading', { name: 'Procurement' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- src/modules/supply-chain/__tests__/SupplyChainDashboard.test.tsx`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement `components/KpiTile.tsx`**

```tsx
export function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="sc-kpi">
      <div className="sc-kpi-value">{value}</div>
      <div className="sc-kpi-label">{label}</div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `components/Section.tsx`**

```tsx
import type { ReactNode } from 'react';

interface Props {
  title: string;
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}

export function Section({ title, loading, error, empty, emptyText, children }: Props) {
  return (
    <section className="sc-section">
      <h2 className="sc-section-title">{title}</h2>
      {loading && <div className="sc-state sc-loading">Loading…</div>}
      {!loading && error && (
        <div className="sc-state sc-error">Couldn’t load {title.toLowerCase()} (error {error}).</div>
      )}
      {!loading && !error && empty && <div className="sc-state sc-empty">{emptyText}</div>}
      {!loading && !error && !empty && children}
    </section>
  );
}
```

- [ ] **Step 5: Implement `components/MovementChart.tsx`**

```tsx
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { CHART_FILL, AXIS_STROKE, GRID_STROKE } from '../format';

export function MovementChart({ series }: { series: { day: string; volume: number }[] }) {
  return (
    <div className="sc-chart" style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={series} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="day" stroke={AXIS_STROKE} tick={{ fontSize: 10 }} interval={4} />
          <YAxis stroke={AXIS_STROKE} tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="volume" fill={CHART_FILL} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 6: Implement `components/InventorySection.tsx`**

```tsx
import { useSupplyChain } from '../hooks/useSupplyChain';
import type { InventoryResponse } from '../types';
import { formatCount } from '../format';
import { Section } from './Section';
import { KpiTile } from './KpiTile';
import { MovementChart } from './MovementChart';

export function InventorySection() {
  const { data, loading, error } = useSupplyChain<InventoryResponse>('inventory');
  const empty = !!data && data.lowStock.length === 0 && data.movementSeries.every((p) => p.volume === 0);
  return (
    <Section
      title="Inventory"
      loading={loading}
      error={error}
      empty={empty}
      emptyText="No low-stock items and no recent movements."
    >
      {data && (
        <>
          <div className="sc-kpis">
            <KpiTile label="Low-stock items" value={formatCount(data.kpis.lowStockCount)} />
            <KpiTile label="30-day movement volume" value={formatCount(data.kpis.movementVolume30d)} />
          </div>
          <MovementChart series={data.movementSeries} />
          {data.lowStock.length === 0 ? (
            <p className="sc-note">All tracked items are above their reorder level.</p>
          ) : (
            <table className="sc-table">
              <thead>
                <tr><th>Product</th><th>SKU</th><th>On hand</th><th>Reorder</th><th>Deficit</th></tr>
              </thead>
              <tbody>
                {data.lowStock.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.name}</td>
                    <td>{r.sku ?? '—'}</td>
                    <td>{r.qtyOnHand}</td>
                    <td>{r.reorderLevel}</td>
                    <td className="sc-deficit">{r.deficit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Section>
  );
}
```

- [ ] **Step 7: Implement `components/ProcurementSection.tsx`**

```tsx
import { useSupplyChain } from '../hooks/useSupplyChain';
import type { ProcurementResponse } from '../types';
import { formatCount, formatCents } from '../format';
import { Section } from './Section';
import { KpiTile } from './KpiTile';

export function ProcurementSection() {
  const { data, loading, error } = useSupplyChain<ProcurementResponse>('procurement');
  const empty = !!data && data.openPos.length === 0;
  return (
    <Section
      title="Procurement"
      loading={loading}
      error={error}
      empty={empty}
      emptyText="No open purchase orders."
    >
      {data && (
        <>
          <div className="sc-kpis">
            <KpiTile label="Open purchase orders" value={formatCount(data.kpis.openPoCount)} />
            <KpiTile label="Open PO value" value={formatCents(data.kpis.openValueCents)} />
          </div>
          <table className="sc-table">
            <thead>
              <tr><th>Supplier</th><th>Expected</th><th>Items</th><th>Total</th></tr>
            </thead>
            <tbody>
              {data.openPos.map((r) => (
                <tr key={r.id}>
                  <td>{r.supplier}</td>
                  <td>{r.expectedOn ?? '—'}</td>
                  <td>{r.itemCount}</td>
                  <td>{formatCents(r.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
```

- [ ] **Step 8: Implement `components/ManufacturingSection.tsx`**

```tsx
import { useSupplyChain } from '../hooks/useSupplyChain';
import type { ManufacturingResponse } from '../types';
import { formatCount } from '../format';
import { Section } from './Section';
import { KpiTile } from './KpiTile';

export function ManufacturingSection() {
  const { data, loading, error } = useSupplyChain<ManufacturingResponse>('manufacturing');
  const empty = !!data && data.orders.length === 0;
  return (
    <Section
      title="Manufacturing"
      loading={loading}
      error={error}
      empty={empty}
      emptyText="No in-progress production orders."
    >
      {data && (
        <>
          <div className="sc-kpis">
            <KpiTile label="In-progress orders" value={formatCount(data.kpis.inProgressCount)} />
            <KpiTile label="Units in production" value={formatCount(data.kpis.unitsInProduction)} />
          </div>
          <table className="sc-table">
            <thead>
              <tr><th>Product</th><th>BOM</th><th>Qty</th><th>Started</th></tr>
            </thead>
            <tbody>
              {data.orders.map((r) => (
                <tr key={r.id}>
                  <td>{r.product}</td>
                  <td>{r.bomName}</td>
                  <td>{r.qty}</td>
                  <td>{r.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
```

- [ ] **Step 9: Implement `components/SupplyChainDashboard.tsx`**

```tsx
import { useUserAuth } from '../../user-portal/user-auth-context';
import { visibleSectionsFor } from '../gating';
import type { SectionKey } from '../types';
import { InventorySection } from './InventorySection';
import { ProcurementSection } from './ProcurementSection';
import { ManufacturingSection } from './ManufacturingSection';
import '../supply-chain.css';

const SECTION_COMPONENT: Record<SectionKey, () => JSX.Element> = {
  inventory: InventorySection,
  procurement: ProcurementSection,
  manufacturing: ManufacturingSection,
};

export function SupplyChainDashboard() {
  const { enabledModules } = useUserAuth();
  const enabledKeys = new Set(enabledModules.map((m) => m.key));
  const sections = visibleSectionsFor(enabledKeys);

  return (
    <div className="sc-dashboard">
      <header className="sc-header">
        <h1>Supply Chain</h1>
        <p className="sc-sub">Live view across inventory, procurement, and production.</p>
      </header>
      {sections.length === 0 ? (
        <div className="sc-state sc-empty sc-empty-all">
          No supply-chain modules are enabled yet. Enable Inventory, Procurement, or
          Manufacturing to see data here.
        </div>
      ) : (
        <div className="sc-sections">
          {sections.map((key) => {
            const Cmp = SECTION_COMPONENT[key];
            return <Cmp key={key} />;
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Implement `supply-chain.css`** (namespaced `.sc-*`)

```css
.sc-dashboard { padding: 24px; max-width: 1100px; margin: 0 auto; }
.sc-header h1 { margin: 0 0 4px; font-size: 22px; }
.sc-sub { margin: 0 0 20px; color: var(--sc-muted, #64748b); font-size: 13px; }
.sc-sections { display: flex; flex-direction: column; gap: 24px; }
.sc-section { border: 1px solid var(--sc-border, #e2e8f0); border-radius: 10px; padding: 16px; background: var(--sc-card, #fff); }
.sc-section-title { margin: 0 0 12px; font-size: 15px; }
.sc-kpis { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.sc-kpi { flex: 1 1 160px; border: 1px solid var(--sc-border, #e2e8f0); border-radius: 8px; padding: 12px; }
.sc-kpi-value { font-size: 22px; font-weight: 600; }
.sc-kpi-label { font-size: 12px; color: var(--sc-muted, #64748b); margin-top: 2px; }
.sc-chart { margin: 8px 0 12px; }
.sc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.sc-table th, .sc-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--sc-border, #eef2f6); }
.sc-table th { color: var(--sc-muted, #64748b); font-weight: 500; }
.sc-deficit { color: #dc2626; font-weight: 600; }
.sc-state { padding: 16px; font-size: 13px; color: var(--sc-muted, #64748b); }
.sc-error { color: #b91c1c; }
.sc-note { font-size: 13px; color: var(--sc-muted, #64748b); margin: 8px 0 0; }
.sc-empty-all { border: 1px dashed var(--sc-border, #cbd5e1); border-radius: 10px; text-align: center; }
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `npm run test -- src/modules/supply-chain/__tests__/SupplyChainDashboard.test.tsx`
Expected: PASS (2 tests).

> If jsdom lacks `ResponsiveContainer` dimensions, the chart renders empty but the surrounding DOM (heading, table rows) still asserts fine — the test does not query chart internals.

- [ ] **Step 12: Commit**

```bash
git add src/modules/supply-chain/supply-chain.css src/modules/supply-chain/components/ src/modules/supply-chain/__tests__/SupplyChainDashboard.test.tsx
git commit -m "feat(supply-chain): dashboard components + sections + movement chart + CSS"
```

---

### Task 8: Route mount + router + nav + sidebar wiring

**Files:**
- Create: `src/modules/supply-chain/SupplyChainRouteMount.tsx`
- Modify: `src/lib/router.tsx` (lazy import + route block)
- Modify: `src/modules/user-portal/nav/useNavItems.ts:24` (add `'supply-chain'` to `MODULES_WITH_DEDICATED_NAV`)
- Modify: `src/modules/user-portal/layout/Sidebar.tsx` (gating block + group guard + NavLink)

**Interfaces:**
- Consumes: `SupplyChainDashboard` (Task 7); `useUserAuth().permissions`/`enabledModules`/`user` (Sidebar).
- Produces: route `/c/:slug/supply-chain` and a Sidebar NavLink gated on enablement + Owner/`supply-chain.products.view`.

- [ ] **Step 1: Create the route mount** `src/modules/supply-chain/SupplyChainRouteMount.tsx`

```tsx
import { SupplyChainDashboard } from './components/SupplyChainDashboard';

export default function SupplyChainRouteMount() {
  return <SupplyChainDashboard />;
}
```

- [ ] **Step 2: Add the lazy import** in `src/lib/router.tsx` (near the analytics lazy import, ~line 40)

```ts
// Lazy-loaded so the supply-chain bundle (incl. recharts) is a separate chunk,
// fetched only when a user opens Supply Chain — mirrors Analytics.
const SupplyChainRouteMount = lazy(() => import('../modules/supply-chain/SupplyChainRouteMount'));
```

- [ ] **Step 3: Add the route block** in `src/lib/router.tsx` inside the `UserDashboardLayout` children, immediately after the `analytics` route (~line 156)

```tsx
              { path: 'supply-chain', element: (
                <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
                  <SupplyChainRouteMount />
                </Suspense>
              ) },
```

- [ ] **Step 4: Add to `MODULES_WITH_DEDICATED_NAV`** in `src/modules/user-portal/nav/useNavItems.ts:24`

Add `'supply-chain'` to the set literal (so it doesn't also appear in the generic `/m/:moduleKey` rail):
```ts
const MODULES_WITH_DEDICATED_NAV = new Set<string>(['products', 'pos', 'booking', 'analytics', 'inventory', 'email', 'finance', 'procurement', 'warehouse', 'crm', 'manufacturing', 'workforce', 'project-service', 'supply-chain']);
```

- [ ] **Step 5: Add the Sidebar gating block** in `src/modules/user-portal/layout/Sidebar.tsx`, right after the `showAnalytics` block (~line 77)

```tsx
  // Supply Chain appears when the workspace has it enabled AND the caller is an
  // Owner (all-on) or holds the supply-chain view permission. Mirrors Analytics.
  const supplyChainEnabled = enabledModules.some((m) => m.key === 'supply-chain');
  const showSupplyChain = supplyChainEnabled && (
    isOwner || permissions['supply-chain.products.view'] === true
  );
```

- [ ] **Step 6: Add `showSupplyChain` to the Modules group-guard** on the `Sidebar.tsx` render-guard line (~134). Insert `|| showSupplyChain` into the boolean chain:

```tsx
        {(showProducts || showPos || showBooking || showInventory || showManufacturing || showCrm || showAnalytics || showEmail || showFinance || showProcurement || showWarehouse || showWorkforce || showSupplyChain || items.length > 0) && (
```

- [ ] **Step 7: Add the NavLink** in the Modules group, next to the Analytics NavLink (~line 158)

```tsx
            {showSupplyChain && (
              <NavLink to={`/c/${slug}/supply-chain`}>Supply Chain</NavLink>
            )}
```

- [ ] **Step 8: Typecheck (this task has no unit test — the gate is the compiler + route wiring)**

Run: `npm run typecheck`
Expected: no errors. (If `JSX.Element` is unresolved in `SECTION_COMPONENT`, ensure `SupplyChainDashboard.tsx` is `.tsx` and React JSX types are in scope — they are, via the project's tsconfig.)

- [ ] **Step 9: Commit**

```bash
git add src/modules/supply-chain/SupplyChainRouteMount.tsx src/lib/router.tsx src/modules/user-portal/nav/useNavItems.ts src/modules/user-portal/layout/Sidebar.tsx
git commit -m "feat(supply-chain): route mount + router + sidebar nav wiring"
```

---

### Task 9: Seed script for `papa-s-saloon`

**Files:**
- Create: `scripts/seed-supply-chain.ts`
- Modify: `package.json` (add `seed:supply-chain` script)

**Interfaces:**
- Consumes: existing `papa-s-saloon` client (by slug). Produces visible data in all three panels.

- [ ] **Step 1: Implement `scripts/seed-supply-chain.ts`** (mirrors `scripts/seed-procurement.ts`)

```ts
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set (run via `npm run seed:supply-chain`, which loads .env).');
  process.exit(1);
}

const SLUG = process.argv[2] ?? 'papa-s-saloon';
const sql = neon(DATABASE_URL);

async function main(): Promise<void> {
  const clients = (await sql`
    SELECT id, name FROM public.clients WHERE slug = ${SLUG} LIMIT 1
  `) as Array<{ id: string; name: string }>;
  const client = clients[0];
  if (!client) {
    console.error(`No client found with slug "${SLUG}".`);
    process.exit(1);
  }
  const clientId = client.id;

  // 1. Enable the dashboard + its three backing products (idempotent).
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key)
    VALUES (${clientId}::uuid, 'products'), (${clientId}::uuid, 'inventory'),
           (${clientId}::uuid, 'procurement'), (${clientId}::uuid, 'manufacturing'),
           (${clientId}::uuid, 'supply-chain')
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
  await sql`
    UPDATE public.clients SET inventory_tracking_enabled = true WHERE id = ${clientId}::uuid
  `;

  // 2. Ensure a few demo physical products exist.
  const demoNames = ['SC Shampoo', 'SC Conditioner', 'SC Hair Oil', 'SC Wax'];
  for (const name of demoNames) {
    await sql`
      INSERT INTO public.products (client_id, type, name, price_cents, pos_visible, status)
      SELECT ${clientId}::uuid, 'physical', ${name}, 19900, true, 'active'::product_status
      WHERE NOT EXISTS (
        SELECT 1 FROM public.products
        WHERE client_id = ${clientId}::uuid AND name = ${name} AND deleted_at IS NULL
      )
    `;
  }
  const products = (await sql`
    SELECT id FROM public.products
    WHERE client_id = ${clientId}::uuid AND type = 'physical' AND deleted_at IS NULL
    ORDER BY name LIMIT 4
  `) as Array<{ id: string }>;

  // 3. Inventory stock — first product below reorder, rest healthy (idempotent).
  for (let i = 0; i < products.length; i++) {
    const onHand = i === 0 ? 2 : 40 + i * 5;
    await sql`
      INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
      VALUES (${clientId}::uuid, ${products[i]!.id}::uuid, ${onHand}::int, 10)
      ON CONFLICT (client_id, product_id) DO NOTHING
    `;
  }

  // 4. 30 days of movements (only if none exist yet for this client).
  const mv = (await sql`
    SELECT count(*)::int AS n FROM public.stock_movements WHERE client_id = ${clientId}::uuid
  `) as Array<{ n: number }>;
  if (mv[0]!.n === 0 && products.length > 0) {
    for (let d = 0; d < 30; d++) {
      const p = products[d % products.length]!;
      const delta = d % 3 === 0 ? -(3 + (d % 5)) : (5 + (d % 7));
      const type = delta < 0 ? 'sale' : 'purchase';
      await sql`
        INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_at)
        VALUES (${clientId}::uuid, ${p.id}::uuid, ${delta}::int, ${type}, 'seed',
                now() - (${d}::text || ' days')::interval)
      `;
    }
  }

  // 5. A supplier + two 'ordered' POs with future expected dates (only if none open).
  await sql`
    INSERT INTO public.suppliers (client_id, name, phone, email, notes)
    SELECT ${clientId}::uuid, 'SC Metro Supplies', '+91 98200 33333', 'sc@metro.example', 'Demo supplier'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.suppliers WHERE client_id = ${clientId}::uuid AND name = 'SC Metro Supplies' AND deleted_at IS NULL
    )
  `;
  const openCount = (await sql`
    SELECT count(*)::int AS n FROM public.purchase_orders WHERE client_id = ${clientId}::uuid AND status = 'ordered'
  `) as Array<{ n: number }>;
  if (openCount[0]!.n === 0 && products.length > 0) {
    const supplier = (await sql`
      SELECT id FROM public.suppliers WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL ORDER BY name LIMIT 1
    `) as Array<{ id: string }>;
    for (const days of [3, 9]) {
      const po = (await sql`
        INSERT INTO public.purchase_orders (client_id, supplier_id, status, expected_on, notes)
        VALUES (${clientId}::uuid, ${supplier[0]!.id}::uuid, 'ordered', (now() + (${days}::text || ' days')::interval)::date, 'Awaiting delivery')
        RETURNING id
      `) as Array<{ id: string }>;
      await sql`
        INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
        VALUES (${po[0]!.id}::uuid, ${products[0]!.id}::uuid, 25, 4200)
      `;
    }
  }

  // 6. A BOM + an 'in_progress' production order (only if none in progress).
  const inProg = (await sql`
    SELECT count(*)::int AS n FROM public.production_orders WHERE client_id = ${clientId}::uuid AND status = 'in_progress'
  `) as Array<{ n: number }>;
  if (inProg[0]!.n === 0 && products.length > 0) {
    const bom = (await sql`
      INSERT INTO public.boms (client_id, output_product_id, name)
      VALUES (${clientId}::uuid, ${products[0]!.id}::uuid, 'SC Signature Blend')
      RETURNING id
    `) as Array<{ id: string }>;
    await sql`
      INSERT INTO public.production_orders (client_id, bom_id, qty, status)
      VALUES (${clientId}::uuid, ${bom[0]!.id}::uuid, 40, 'in_progress')
    `;
  }

  const counts = (await sql`
    SELECT
      (SELECT count(*)::int FROM public.inventory_stock  WHERE client_id = ${clientId}::uuid AND qty_on_hand <= reorder_level) AS low_stock,
      (SELECT count(*)::int FROM public.stock_movements  WHERE client_id = ${clientId}::uuid) AS movements,
      (SELECT count(*)::int FROM public.purchase_orders  WHERE client_id = ${clientId}::uuid AND status = 'ordered') AS open_pos,
      (SELECT count(*)::int FROM public.production_orders WHERE client_id = ${clientId}::uuid AND status = 'in_progress') AS in_progress
  `) as Array<{ low_stock: number; movements: number; open_pos: number; in_progress: number }>;
  const c = counts[0]!;
  console.log(`Seeded supply-chain for ${client.name} (${SLUG}):`);
  console.log(`  low-stock items:   ${c.low_stock}`);
  console.log(`  stock movements:   ${c.movements}`);
  console.log(`  open POs:          ${c.open_pos}`);
  console.log(`  in-progress prod:  ${c.in_progress}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script** — open `package.json`, find the `"seed:procurement"` line, duplicate it as `"seed:supply-chain"` pointing at `scripts/seed-supply-chain.ts` (keep whatever runner/`.env` prefix the sibling seed scripts use, e.g. `tsx` / `dotenv`).

- [ ] **Step 3: Run the seed against the dev DB** (only if `papa-s-saloon` exists in your dev DB; otherwise note it's skipped)

Run: `npm run seed:supply-chain`
Expected: prints non-zero counts for low-stock, movements, open POs, in-progress. If it errors `No client found with slug "papa-s-saloon"`, seed the base modules first (`npm run seed:inventory` / `:procurement` / `:manufacturing`) or run against a slug that exists — the script is idempotent.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-supply-chain.ts package.json
git commit -m "feat(supply-chain): seed script for papa-s-saloon demo data"
```

---

### Task 10: Full verification & final commit

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Run the FULL vitest suite** (not just supply-chain — iron rule)

Run: `npm run test`
Expected: all green, including the new `tests/supply-chain/*`, `src/modules/registry/__tests__/supply-chain-manifest.test.ts`, and `src/modules/supply-chain/__tests__/*`.

> If a pre-existing unrelated test is flaky on the shared dev DB (dup-key / gist collision), re-run once; if it persists and is unrelated to supply-chain, note it in the handoff rather than "fixing" another module's test.

- [ ] **Step 3: Confirm branch + clean tree, then final housekeeping commit if needed**

Run: `git branch --show-current` (must be `feat/supply-chain-iso`), then `git status`.
Expected: branch correct; tree clean (all work already committed across Tasks 1-9).

- [ ] **Step 4: Hand off** — end the session reply with:
`Work done. <handoff prompt: worktree ../ExSol-SupplyChain-WT, branch feat/supply-chain-iso, HEAD SHA, migration=none, new functions supply-chain-inventory|procurement|manufacturing + routes, env vars: none new (DATABASE_URL only), summary, gotchas>`

---

## Self-Review

**Spec coverage:**
- Route `/c/:slug/supply-chain` → Task 8. ✓
- Low-stock panel → Task 3 + Task 7 InventorySection. ✓
- 30-day movement chart → Task 3 series + Task 7 MovementChart. ✓
- Open POs panel → Task 4 + Task 7 ProcurementSection. ✓
- In-progress production → Task 5 + Task 7 ManufacturingSection. ✓
- One bucket `supply-chain.products.view` + Owner bypass → Task 1 + Task 2. ✓
- Per-panel backing-module gating → Task 6 `visibleSectionsFor` + Task 7 dashboard. ✓
- Tenant-wide scope, no subtree → Task 2 authz + every endpoint's `client_id` filter. ✓
- Registry (ModuleManifest + ProductManifest) → Task 1. ✓
- Sidebar/RouteMount enable-gate + Owner bypass → Task 8. ✓
- Lazy recharts chunk → Task 8 lazy import. ✓
- Seed for papa-s-saloon → Task 9. ✓
- Real-DB tests, no getStore mock → Tasks 2-6. ✓
- No migration → Global Constraints; no task creates one. ✓
- Verification typecheck + full suite → Task 10. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the command + expected result. Task 8 (wiring) and Task 9 step 2 (`package.json`) are described as exact edits against quoted anchor lines rather than invented code, because the surrounding file content is established and must be matched, not replaced.

**Type consistency:** `SectionKey` union identical across `types.ts`, `gating.ts`, `api.ts`, `hooks/useSupplyChain.ts`. Endpoint JSON keys (`lowStock`/`movementSeries`/`openPos`/`orders`/`kpis` fields) match the frontend `InventoryResponse`/`ProcurementResponse`/`ManufacturingResponse` exactly. `resolveSupplyChainAccess` return type is identical in the helper, its test, and all three endpoints. `getLevelMatrix`/permissions treated as `Record<string, true>` throughout.
