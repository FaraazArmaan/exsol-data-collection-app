# Supply Chain Dashboard — v1 design (width slice)

**Date:** 2026-07-06
**Branch/worktree:** `feat/supply-chain-iso` @ `../ExSol-SupplyChain-WT` (base `main` @ `b2d7a0a`)
**Migration:** none (RESERVED number unused — pure read-projection over existing tables)
**Pattern mirrored:** Analytics module (`docs/superpowers/specs/2026-06-30-analytics-module-design.md`)

---

## 1. What it is

A read-only cross-module dashboard at `/c/:slug/supply-chain`. It is *the cross-module
dashboard, not a new data store* — it aggregates over tables owned by three already-merged
modules and owns **no tables of its own**:

| Panel | Reads from (module / table) | Meaning |
|---|---|---|
| **Low-stock alerts** | Inventory / `inventory_stock` | items where `qty_on_hand <= reorder_level` |
| **30-day movement volume** (chart) | Inventory / `stock_movements` | daily `Σ abs(qty_delta)` over last 30 days |
| **Open purchase orders** | Procurement / `purchase_orders` (+ `_items`, `suppliers`) | `status = 'ordered'`, with `expected_on` + computed total |
| **In-progress production** | Manufacturing / `production_orders` (+ `boms`, `products`) | `status = 'in_progress'` |

Depth (filters, drill-down, per-item history, export) is explicitly **out of scope** for v1.
The bar for "done" is: a free-clicking reviewer hits no 500s and no blank screens — every
panel handles loading / empty / error, backed by realistic seeded demo data.

---

## 2. Permissions & gating

### One bucket, one key
All supply-chain data is product-catalog data, and `DataBucket` is a closed union
(`business | employees | customers | products`). The three backing modules each declare
`data_buckets: ['products']`. Therefore the dashboard uses a single bucket:

- **Module key:** `supply-chain` (hyphenated keys are already used by `data-collection`).
- **Permission key:** `supply-chain.products.view` (view-only; it is a read projection).

Inventing per-panel buckets (`inventory`/`procurement`/`manufacturing`) is **not possible**
without editing the shared `DATA_BUCKETS` type — out of scope for this isolated chat — and
action-namespaced keys are forbidden (iron rule #3). This is a deliberate, forced choice.

### Two-layer gating (mirrors Analytics Bookings/Catalog)
1. **Access to the dashboard:** `supply-chain` Product enabled for the client **AND**
   (`level_number === 1` Owner **OR** the caller holds `supply-chain.products.view`).
   Enforced in `_supply-chain-authz.ts`, the Sidebar, and the RouteMount — all three carry
   the enable-gate **then** the `level_number === 1` Owner bypass (iron rule #2).
2. **Per-panel visibility:** each section renders only if its **backing module** is enabled
   for the client (`enabledModules` contains `inventory` / `procurement` / `manufacturing`).
   A client with `supply-chain` on but a backing module off simply doesn't see that panel;
   a client with none of the three on sees a friendly "nothing to show yet" dashboard.

The `supply-chain` Product has **no `requires`** — it is standalone-enablable and self-gates
per panel, exactly like Analytics.

---

## 3. Scope

Tenant-wide. Every backing table is scoped by `client_id uuid NOT NULL`; **none** carries a
`user_node` scoping column (stock levels / POs / production orders are operational tenant
state, not per-person attribution). So there is **no subtree math and no `?node=`** — every
query is `WHERE <t>.client_id = ${clientId}::uuid`. `clientId` comes from the session cookie
(admin `?client=` or bucket-user credential → `user_nodes.client_id`), never from `:slug`.

---

## 4. Backend — 3 flat aggregation functions

Flat top-level files in `netlify/functions/` (no subfolders). Function-name routing; each has
a distinct `config.path`, all `GET`, so no path/method collisions. No query params in v1
(fixed 30-day window, tenant-wide) — so no validators file.

### Shared helper: `_supply-chain-authz.ts`
```ts
export interface SupplyChainAccess { clientId: string; tz: string; }
export async function resolveSupplyChainAccess(
  req: Request,
): Promise<{ ok: true; access: SupplyChainAccess } | { ok: false; res: Response }>
```
Logic copied from `_analytics-authz.ts` minus the subtree resolver:
- **Admin** (`requireAdmin`) → `clientId` from `?client=` (400 if missing), bypass.
- Else **bucket-user** (`requireBucketUser`, throws → 401) → read `user_nodes.level_number`
  + `client_id`. `isOwner = level_number === 1 || level_number == null`.
  - Owner → allowed.
  - Else → `getLevelMatrix(clientId, level)`; require `['supply-chain.products.view']`, else
    `jsonError(403, 'forbidden')`.
- Resolve `tz` via `SELECT timezone FROM public.clients WHERE id = $clientId` (`?? 'UTC'`).

### `supply-chain-inventory.ts` — `GET /api/supply-chain-inventory`
```jsonc
{
  "kpis": { "lowStockCount": 4, "movementVolume30d": 812 },
  "lowStock": [ { "productId","name","sku","qtyOnHand","reorderLevel","deficit" } ], // deficit = reorder-onhand, worst first, cap 100
  "movementSeries": [ { "day": "2026-06-07", "volume": 42 } ],  // 30 rows, zero-filled, tz-bucketed on abs(qty_delta)
  "generatedAt": "…"
}
```
SQL: low-stock from `inventory_stock JOIN products p ON p.id=product_id AND p.deleted_at IS NULL`
where `qty_on_hand <= reorder_level`. Movement series: `date_trunc('day', created_at AT TIME
ZONE $tz)` over `created_at >= now() - interval '30 days'`, `Σ abs(qty_delta)`, left-joined
against a generated 30-day day series so gaps render as 0.

### `supply-chain-procurement.ts` — `GET /api/supply-chain-procurement`
```jsonc
{
  "kpis": { "openPoCount": 3, "openValueCents": 154900 },
  "openPos": [ { "id","supplier","status","expectedOn","itemCount","totalCents" } ], // status='ordered', expected_on asc nulls last, cap 100
  "generatedAt": "…"
}
```
`purchase_orders po JOIN suppliers s ON s.id=po.supplier_id` where `po.status='ordered'`;
total via `LEFT JOIN (SELECT purchase_order_id, count(*) itemCount, Σ qty*unit_cost_cents total
FROM purchase_order_items GROUP BY 1)`.

### `supply-chain-manufacturing.ts` — `GET /api/supply-chain-manufacturing`
```jsonc
{
  "kpis": { "inProgressCount": 2, "unitsInProduction": 60 },
  "orders": [ { "id","product","bomName","qty","createdAt" } ], // status='in_progress', newest first, cap 100
  "generatedAt": "…"
}
```
`production_orders po JOIN boms b ON b.id=po.bom_id JOIN products p ON p.id=b.output_product_id
AND p.deleted_at IS NULL` where `po.status='in_progress'`.

All three: money in integer cents (INR formatted frontend-only); BIGINT sums coerced with
`Number()`; dates emitted as `to_char(..., 'YYYY-MM-DD')` to dodge the local-midnight→UTC shift.

---

## 5. Frontend — `src/modules/supply-chain/`

Self-contained (own components, no cross-module imports), namespaced CSS `.sc-*`. Mirrors the
Analytics module layout.

```
SupplyChainRouteMount.tsx        default → <SupplyChainDashboard/>
supply-chain.css
api.ts                           throw-on-error fetch (fetchInventory/fetchProcurement/fetchManufacturing)
types.ts                         response contracts
format.ts                        formatCents (INR), formatDate (local), chart theme constants
hooks/useSupplyChain.ts          fetch hook w/ stale-guard (alive flag), keyed per section
components/
  SupplyChainDashboard.tsx       reads useUserAuth().enabledModules; decides visible sections
  Section.tsx                    generic frame: title + loading / error / empty / children
  KpiTile.tsx                    label + value (count | cents)
  InventorySection.tsx           KPIs + LowStockTable + MovementChart
  ProcurementSection.tsx         KPIs + OpenPoTable
  ManufacturingSection.tsx       KPIs + ProductionTable
  MovementChart.tsx              recharts BarChart (only file importing 'recharts')
  tables (LowStockTable/OpenPoTable/ProductionTable inline or small files)
__tests__/
  SupplyChainDashboard.test.tsx  gating (pure helper + rendered)
  useSupplyChain.test.tsx
  KpiTile.test.tsx
```

- **Code-splitting:** the whole module is route-lazy (`lazy(() => import('.../SupplyChainRouteMount'))`
  wrapped in `<Suspense>`) so recharts lives in a code-split chunk, exactly like Analytics.
- **Gating helper:** `visibleSectionsFor(enabledModuleKeys): SectionKey[]` — exported pure
  function so gating is unit-testable without a DOM. `SECTION_MODULE = { inventory:'inventory',
  procurement:'procurement', manufacturing:'manufacturing' }`.
- **Independent fetch:** each section calls its own endpoint via `useSupplyChain(sectionKey)`;
  a slow or failing section never blocks the others. Disabled backing module → section not
  rendered, endpoint not called.
- **Every state handled:** `Section` renders a spinner (loading), an inline error with the
  status (error), an empty-state line (loaded but zero rows), else the content.

---

## 6. Registry, router, sidebar

- `src/modules/registry/manifests/supply-chain.ts` — `ModuleManifest { key:'supply-chain',
  label:'Supply Chain', data_buckets:['products'], verbs:['view'], vendor_side:true,
  customer_side:false }`; register in `modules.ts`.
- `src/modules/registry/products-list/supply-chain.ts` — `ProductManifest { key:'supply-chain',
  label:'Supply Chain', modules:[{ module:'supply-chain', side:'vendor' }] }` (no `requires`);
  register in `products.ts`.
- `src/lib/router.tsx` — lazy import + `{ path:'supply-chain', element:<Suspense>…</Suspense> }`
  under `/c/:slug`; add `'supply-chain'` to `MODULES_WITH_DEDICATED_NAV` in `useNavItems.ts`.
- `src/modules/user-portal/layout/Sidebar.tsx` — add the standard block:
  `supplyChainEnabled = enabledModules.some(m => m.key === 'supply-chain')`;
  `showSupplyChain = supplyChainEnabled && (isOwner || permissions['supply-chain.products.view'] === true)`;
  NavLink `to={\`/c/${slug}/supply-chain\`}`.

---

## 7. Seed — `scripts/seed-supply-chain.ts`

Mirrors `seed-procurement.ts`/`seed-inventory.ts`. Resolves `papa-s-saloon` by slug (errors
clearly if absent), then guarantees every panel is non-empty:
- ensures a handful of demo products (random SKU suffix), some `inventory_stock` rows with
  `qty_on_hand <= reorder_level` (visible low-stock), plus healthy rows;
- ~30 days of `stock_movements` (mixed `type`, signed `qty_delta`) so the chart has shape;
- 2–3 `suppliers` + `purchase_orders` with `status='ordered'` and **future** `expected_on` +
  `purchase_order_items`;
- 1–2 `boms` + `production_orders` with `status='in_progress'`.
Randomize unique-constrained literals (shared persistent dev DB, no teardown).

---

## 8. Tests

Mirror Analytics: backend handlers run against the **real Neon dev DB** (seed real rows, fake
only the auth cookie via a `makeBucketUserRequest` equivalent) — **no `getStore` mock** (these
handlers touch zero Blobs).

- `tests/supply-chain/_helpers.ts` — compose existing `seedClientWithProductsEnabled` +
  `grantPerms(clientId, 1, ['supply-chain.products.view'])` + row inserters; enable the
  backing Products for the test client.
- `tests/supply-chain/inventory.test.ts` — low-stock rows, 30-day zero-filled series, KPIs;
  caller without perm → 403; owner bypass → 200.
- `tests/supply-chain/procurement.test.ts` — only `ordered` POs; total = `Σ qty*unit_cost`;
  `received`/`draft`/`cancelled` excluded.
- `tests/supply-chain/manufacturing.test.ts` — only `in_progress`; product via BOM output.
- `tests/supply-chain/authz.test.ts` — enable-gate + owner bypass + tenant isolation
  (client A never sees client B's rows).
- `src/modules/registry/__tests__/supply-chain-manifest.test.ts` — manifest wired, key derives
  to `supply-chain.products.view`, Product brings in the module, key validates.
- `src/modules/supply-chain/__tests__/*` — gating (`visibleSectionsFor` + rendered),
  `useSupplyChain` stale-guard, `KpiTile`.

Randomize unique literals; keep seeded timestamps in a fixed historical window to avoid
"today" collisions across re-runs.

---

## 9. Verification (definition of done)

`npm run typecheck` **and** the **full** vitest suite both green (not just supply-chain tests).
Then commit; hand off to the Main integration chat (no push, no merge here).

---

## 10. Out of scope (v1)

Filters/date-picker, drill-down to underlying rows, per-item movement history, server-side
export, supplier/BOM detail pages, any writes. All deferred — this is a width slice.
