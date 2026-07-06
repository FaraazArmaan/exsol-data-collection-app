# Manufacturing Module (058) — v1 design

Status: approved 2026-07-06 · Migration: **058** (reserved) · Branch: `feat/manufacturing-iso`

## Purpose

Add lightweight bill-of-materials (BOM) + production capability on top of the
Inventory module (053). A BOM declares that an **output product** is assembled
from N **component products** at fixed quantities. A **production order** runs a
BOM `qty` times; completing it **consumes** component stock and **produces**
output stock, both recorded in the existing `stock_movements` ledger as
`type='production'`.

Golden flow: define a BOM → run a production order → component stock falls,
output stock rises.

## Scope

**In:** BOM CRUD (with components), production-order create + status FSM,
consume/produce on completion, module registry + authz + sidebar + route, seed,
tests.

**Out (v1):** partial completions, BOM versioning, multi-level/nested BOMs,
per-run scrap/yield %, guard against an output product appearing among its own
components, cost roll-ups.

## Dependencies

- **Inventory (053)** — reuses `inventory_stock` (truth) and `stock_movements`
  (append-only ledger). The `stock_movement_type` enum already contains
  `'production'`, so no enum change is needed.
- **Products** — BOM output + components reference `public.products`.
- The `manufacturing` Product `requires: ['products', 'inventory']`.

This branch bases on `main` which currently has migrations 053/054/056 (055 CRM
and 057 Warehouse not yet merged). 058 depends only on 053 + long-present tables
(`clients`, `products`, `user_nodes`), so the numbering gaps are harmless.

## Data model — migration `058_manufacturing.sql`

One statement per line; comments on their own line (Iron Rule 1). Mirrors 053's
style: plain `create type`, `create table if not exists`, `if not exists`
indexes, `set_updated_at` triggers.

- `production_order_status` enum: `planned | in_progress | done | cancelled`
- **`boms`**: `id uuid pk`, `client_id → clients ON DELETE CASCADE`,
  `output_product_id → products ON DELETE CASCADE`, `name text not null`,
  `created_at`, `updated_at` (+ `set_updated_at` trigger).
- **`bom_components`**: `id uuid pk`, `bom_id → boms ON DELETE CASCADE`,
  `component_product_id → products ON DELETE CASCADE`, `qty int CHECK qty > 0`,
  `UNIQUE(bom_id, component_product_id)`.
- **`production_orders`**: `id uuid pk`, `client_id → clients ON DELETE CASCADE`,
  `bom_id → boms ON DELETE RESTRICT`, `qty int CHECK qty > 0`,
  `status production_order_status not null default 'planned'`,
  `created_by → user_nodes ON DELETE SET NULL`, `created_at`, `updated_at`,
  `completed_at timestamptz` (+ `set_updated_at` trigger).
- Indexes: `boms(client_id)`, `production_orders(client_id, created_at desc)`.
  (`bom_components` lookups by `bom_id` are already served by the leading column
  of the `UNIQUE(bom_id, component_product_id)` index — no extra index.)

## Permissions — bucket×verb only (Iron Rule 3)

`manufacturing.products.{view,create,edit,delete}`

| verb | grants |
|------|--------|
| view | list/read BOMs + production orders |
| create | create BOM, create production order |
| edit | edit BOM components, **advance production-order status** |
| delete | delete BOM |

## Authz — `_manufacturing-authz.ts`

Mirrors `_inventory-authz.requireInventory`, two layers in order (Iron Rule 2):
1. **Enable-gate** — `manufacturing` module must be reachable from an enabled
   Product for the client, else `412 manufacturing_module_not_enabled`.
2. **Permission** — caller holds the required `manufacturing.products.<verb>`,
   **except `level_number === 1` (Owner)** who is treated all-on (returned the
   full `ALL_MANUFACTURING_PERMS` set in ctx). Same bypass repeated in Sidebar +
   RouteMount.

## Netlify functions (flat top-level files, explicit `config.path` + `method`)

Follows the newest-module convention (Booking/Finance): hyphenated `-detail/:id`
segments, never `:id` nested under a collection path (Iron Rule 5 / routing-404).

| file | path | methods | notes |
|------|------|---------|-------|
| `_manufacturing-authz.ts` | — | — | shared helper (underscore = not a route) |
| `manufacturing-boms.ts` | `/api/manufacturing/boms` | GET, POST | list / create-with-components |
| `manufacturing-bom-detail.ts` | `/api/manufacturing/bom-detail/:id` | GET, PUT, DELETE | read / replace components / delete (RESTRICT-guarded → 409 if orders exist) |
| `manufacturing-orders.ts` | `/api/manufacturing/orders` | GET, POST | list / create |
| `manufacturing-order-advance.ts` | `/api/manufacturing/order-advance/:id` | POST | FSM transition `{to}`; `→done` runs consume+produce |

All ownership-scope every query by `client_id`; foreign objects → `404`.

## The FSM + golden transaction (`manufacturing-order-advance`)

Legal transitions: `planned → in_progress`, `in_progress → done`,
`planned → cancelled`, `in_progress → cancelled`. `done` and `cancelled` are
terminal. Any illegal transition → `409 illegal_transition`.

`→ in_progress` / `→ cancelled`: status update only, no stock movement.

`→ done` (the golden path):
1. Load BOM components; `need[c] = component.qty × order.qty`.
2. Load current `qty_on_hand` per component; compute shortfalls.
3. If any component short → **`409 insufficient_stock { shortfalls: [{product, need, have}] }`**,
   nothing written, order stays `in_progress`.
4. Else one `sql.transaction([...])`:
   - per component: `qty_on_hand = qty_on_hand - need` (**no `GREATEST` clamp** —
     the `qty_on_hand >= 0` CHECK is the concurrency backstop; catch Postgres
     `23514` → also `409 insufficient_stock`) + `stock_movements` row
     `type='production', qty_delta = -need, ref = <order id>`.
   - output: upsert `+order.qty` + `stock_movements` row
     `type='production', qty_delta = +order.qty, ref = <order id>`.
   - `production_orders.status = 'done', completed_at = now()`.

Decision (2026-07-06): reject-with-shortfall over clamp-at-zero — clamping would
mark an order `done` while silently not consuming inputs it never had, corrupting
the ledger.

## Frontend — `src/modules/manufacturing/`

Mirrors `inventory` / `booking`: shared types + throw-on-error API layer + perms
in a shared dir; namespaced `.mfg-*` CSS. Reuses existing shared components.

- `shared/types.ts` — `Bom`, `BomComponent`, `ProductionOrder`, status union.
- `shared/api.ts` — throw-on-error fetch wrappers.
- `shared/permissions.ts` — `ALL_MANUFACTURING_PERMS`.
- `manufacturing.css` — `.mfg-*`.
- `ManufacturingRouteMounts.tsx` — `gate()` mount on `manufacturing.products.view`
  with the L1-owner bypass (mirrors `InventoryRouteMounts`).
- `workspace/pages/ManufacturingPage.tsx` — one page, two tabs: **BOMs** and
  **Production Orders**. Handles empty / loading / error states.
- `workspace/components/BomBuilderModal.tsx` — create/edit: name, output-product
  select, component rows (product + qty).
- `workspace/components/CreateOrderModal.tsx` — pick BOM + qty.
- Production-order list with per-row advance buttons; renders the
  `insufficient_stock` shortfall list inline on a failed completion.

Route: `/c/:slug/manufacturing` → `ManufacturingPage` (single mount).

## Registry wiring

- `manifests/manufacturing.ts` — `ModuleManifest` key `manufacturing`,
  `data_buckets: ['products']`, all four verbs, `vendor_side: true`; register in
  `modules.ts`.
- `products-list/manufacturing.ts` — `ProductManifest` key `manufacturing`,
  `modules: [{ module: 'manufacturing', side: 'vendor' }]`,
  `requires: ['products', 'inventory']`; register in `products.ts`.
- Sidebar entry (enabled + owner/`manufacturing.products.view`).
- `router.tsx` mount.

## Seed — `scripts/seed-manufacturing.ts` (+ `npm run seed:manufacturing`)

Idempotent, default `papa-s-saloon`: enable products+inventory+manufacturing,
ensure component products (e.g. beard oil, comb, balm) + an output product
("Signature Beard Kit") with starting stock, define one BOM, create production
orders in mixed states (a `planned`, an `in_progress`) so the list isn't empty.

## Tests — `tests/manufacturing/`

Randomize unique-constrained literals (shared persistent dev DB, no teardown).
No Blob usage → no `getStore` mock needed.

- `_helpers.ts` — seed manufacturing client, seed BOM, read orders/movements
  (mirrors `tests/inventory/_helpers.ts`).
- `authz.test.ts` — `412` not-enabled, `403` missing-permission, L1 bypass.
- `boms.test.ts` — create BOM+components, list, ownership `404`, validation.
- `orders.test.ts` — create order, list, validation.
- `advance.test.ts` — golden: `planned→in_progress→done` drops component stock,
  raises output stock, writes `production` movements; insufficient → `409` +
  no movements + order stays `in_progress`; illegal transition → `409`; cancel.

## Verification (Done = both green)

`npm run typecheck` AND the FULL vitest suite.
