# ERP4 Inventory — DEPTH build (D1.2) — Handoff

**Branch:** `feat/inventory-depth-iso` · **HEAD:** `a5db151` · **Base:** main `00179bd` (post-cleanup, includes 9346668)
**Worktree:** `../ExSol-InventoryDepth-WT` · **Not pushed** (hook-blocked; the human integrates via Main).
**Status:** all 7 depth features complete, one commit each, typecheck clean, inventory suite 42/42.

---

## TL;DR

Seven depth features layered onto Inventory v1 (migration 053), one commit per feature.
Two additive migrations (080, 081); five features needed no schema. New surfaces hang off an
in-page `InventoryTabs` bar (Dashboard · Stock · Returns · Locations · Labels); the sidebar
nav now lands on the dashboard. Reuses the platform seams: `_shared/pdf.ts` (labels),
`src/lib/currency.ts` (valuation), and cross-module READs of procurement (`purchase_order_items`)
and warehouse (`warehouse_locations` / `stock_by_location`).

---

## Commits (one per feature)

| SHA | Feature |
|---|---|
| `ee2dc53` | Dashboard — KPIs (SKUs, units, low-stock, 30-day movement volume) + low-stock / recent-movement panels |
| `255c1f9` | Returns & RMA — intake → restock (`return` movement + stock) or write-off (`writeoff` audit movement) |
| `0aa4005` | Cost Calculator — moving-average valuation on the dashboard (Stock value KPI + top-value table) |
| `5b3142c` | Lifecycle — active / seasonal / discontinued; list badge + filter + storefront-visibility hook |
| `a120be6` | Location Mapping — stock-by-location view over `warehouse_locations` |
| `0122360` | Label Generator — product + shelf label PDFs via the pdf seam |
| `a5db151` | Warehousing bridge — per-product location breakdown drawer + seed depth data |

## Migrations (reserved range 080–086; used 080–081)

- **`080_inventory_returns.sql`** — adds `return` + `writeoff` to the `stock_movement_type` enum
  (`ADD VALUE IF NOT EXISTS`, transaction-safe on PG12+ since the values aren't used in-migration)
  + `inventory_returns` table (disposition CHECK).
- **`081_inventory_lifecycle.sql`** — `inventory_stock.lifecycle_state` (CHECK active|seasonal|discontinued, default active) + index.
- **082–086 unused** — Dashboard, Cost, Location, Labels, Bridge all read existing tables.
- Applied to **DEV only** (`ep-bold-wildflower`). Apply to **prod before/with the code deploy** (additive).

## New endpoints (7 new functions; `inventory-list.ts` modified, not new)

- `GET  /api/inventory/dashboard` → `inventory-dashboard.ts` (KPIs + valuation)
- `GET|POST /api/inventory/returns` → `inventory-returns.ts`
- `POST /api/inventory/lifecycle` → `inventory-lifecycle.ts`
- `GET  /api/inventory/by-location` → `inventory-by-location.ts`
- `GET  /api/inventory/labels?kind=product|shelf&location_id=` → `inventory-labels.ts` (PDF response)
- `GET  /api/inventory/product-locations?product_id=` → `inventory-product-locations.ts`
- `inventory-list.ts` now returns `lifecycle_state` and accepts `?state=` filter.

All gate through `requireInventory` (enable-gate 412 → L1 bypass → matrix). New FE routes under
`/c/:slug/inventory/`: `dashboard`, `returns`, `locations`, `labels`.

## New deps / env vars

None.

## Seed

`scripts/seed-inventory.ts` extended (idempotent): costed received PO + `purchase` movements
(valuation basis), seasonal/discontinued lifecycle states, a **Front Store** location with placed
stock, and restock + write-off returns. `npm run seed:inventory` demos every feature on papa-s-saloon.

---

## Verification

- `npm run typecheck` clean; **inventory suite 42/42** (11 files).
- Full suite: **1354 passed / 14 skipped**, 6 failures — **all pre-existing environmental flakes,
  each green in isolation, none in inventory, none caused by these changes**:
  - `tests/integration/auth.test.ts` ×4 (login rate-limit DB counter + concurrency under load)
  - `tests/integration/workspace-export.test.ts`
  - `tests/integration/u-products-image-thumb.test.ts` DELETE (sharp/WebP)
  - `tests/pos/pub-menu.test.ts` 429 (20s timeout under full-suite Neon latency; passes on retry at ~15s)

## Gotchas / follow-ups

- **Cost calc** derives moving-average from `purchase` movements joined to `purchase_order_items`
  via the `po:<uuid>` ref (no denormalized column; future procurement receipts value automatically).
  Depends on procurement 056 (on main). Products with no costed purchase value at 0.
- **Location mapping + bridge** are cross-module READs of warehouse 057 tables; work whether or not
  the warehouse module is enabled (empty map otherwise).
- **PDF seam is text-only** → labels render SKU as text; true barcode/QR **image** rendering needs an
  image-capable PDF seam. Logged, not built.
- **`base_currency` isn't plumbed to the FE client** (`UserPortalClient`) → `formatMoney` uses the INR
  default. Platform follow-up to surface base_currency in `/u-me`.
- **Lifecycle "discontinued"** sets `products.storefront_visible=false`; re-activating does NOT auto-show.
- **CSS**: theme tokens only, 560px breakpoints added — jsdom can't verify; check dark theme + mobile in
  a REAL browser before merge (iron rule 9).
- **Deploy**: 7 new functions → new-function-404 trap; bundle-hash change → alias-not-promoted. Run
  `restoreSiteDeploy` and probe the new endpoints after the push.
