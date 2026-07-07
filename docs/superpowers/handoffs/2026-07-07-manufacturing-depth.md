# Manufacturing DEPTH — module-chat handoff (2026-07-07)

**Scope:** File Manager terminal, queue 2 — Manufacturing DEPTH (6 features, D1.7) on top of
Manufacturing v1 (mig 058, on main). Isolated module chat: local commits only, **no push / no
merge / no deploy** — the Main integration chat owns that.

## Ground truth
- **Worktree:** `../ExSol-FileManager-WT`
- **Branch:** `feat/manufacturing-depth-iso` — based on `main` @ `efcb588` (post-cleanup)
- **HEAD:** `cfffd93` · 9 commits ahead · tree clean
- **Verification:** `npm run typecheck` clean; manufacturing module suite 23 → **60** tests;
  registry/permission tests green. **Full suite:** all green EXCEPT the pre-existing
  `u-products-image-thumb` sharp/webp flake (passes in isolation — environmental libvips
  contention under parallel load, not this branch). Migs 074–079 applied to the dev branch.

## Commits (oldest→newest)
| SHA | Feature |
|---|---|
| `3af837a` | Production Kanban (mig 074) |
| `f1e1d67` | BOM Designer cost rollup (mig 075) |
| `e92294f` | Quality Control (mig 076) |
| `3142ef9` | Part Tracking (mig 077) |
| `76d335d` | Maintenance/Downtime/Scrap (mig 078) — **adds the `business` bucket** |
| `8b70f1f` | Capacity Planning (mig 079) |
| `f137ca2` | registry test update for the business bucket |
| `cfffd93` | reference-doc regen |

## Features
1. **Production Kanban** — drag board over the FSM lanes (planned/in_progress/done/cancelled).
   `board_rank`/`priority`/`due_on` on production_orders. Native drag advances via the existing
   order-advance (consume/produce on completion); status buttons are the mobile/a11y fallback.
2. **BOM Designer** — component cost rollup. `manufacturing_product_costs` (manufacturing-owned,
   since no product/inventory cost exists — only PO items carry unit_cost_cents). Live assembled
   cost in the builder.
3. **Quality Control** — per-order checklists; fail → **scrap** (removes defective output from
   stock via a type='adjustment' movement) or **rework** (recorded, no stock change).
4. **Part Tracking** — lot/batch refs on consumed components; two-way traceability (order↔lot).
5. **Maintenance/Downtime/Scrap** — shop-floor logs (business bucket) + a standalone scrap action
   (writes stock_movements). Introduced the `business` bucket (see below).
6. **Capacity Planning** — work-center resources with daily hours; orders scheduled (resource +
   estimated_hours + due_on); load view flags overbooked resource-days.

FE: `ManufacturingPage` is a tabbed shell — **Kanban / BOMs / Production Orders / Quality /
Part Tracking / Maintenance / Capacity**. Product tabs gate on `products.view`, shop-floor tabs
(Maintenance/Capacity) on `business.view`; the default tab adapts. `.mfg-*` CSS, theme tokens only.

## The `business` bucket change (feature 5) — read this
Manufacturing v1 had one bucket (`products`). Maintenance/downtime and capacity aren't product
stock, so the manifest now declares `data_buckets: ['products', 'business']`. Consequences handled:
- `ALL_MANUFACTURING_PERMS` extended to the **full 8-key grid** in BOTH `_manufacturing-authz.ts`
  and `ManufacturingRouteMounts.tsx` (Owner-bypass parity — the recurring class from
  `feedback_module_l1_bypass_pattern`).
- The RouteMount gate now allows `products.view` **OR** `business.view` (a business-only user can
  reach the page; tabs self-gate).
- `tests/unit/manufacturing-registry.test.ts` updated to expect both buckets.
- Access-Levels grid now shows a `manufacturing.business` row — intended.

## Migrations (074–079, additive + idempotent)
- `074_manufacturing_kanban` — ALTER production_orders: board_rank, priority, due_on
- `075_manufacturing_costs` — manufacturing_product_costs
- `076_manufacturing_qc` — manufacturing_qc_checks
- `077_manufacturing_lots` — manufacturing_consumption_lots
- `078_manufacturing_maintenance` — manufacturing_maintenance_logs + manufacturing_scrap_logs
- `079_manufacturing_capacity` — manufacturing_resources + ALTER production_orders (resource_id, estimated_hours)

No new `stock_movement_type` (scrap uses the existing `'adjustment'`). No new DataBucket type
value — `business` is one of the four fixed buckets.

## New Netlify functions + routes (14)
`manufacturing-kanban` (GET /kanban) · `manufacturing-order-board` (POST /order-board) ·
`manufacturing-costs` (GET/POST /costs) · `manufacturing-bom-cost` (GET /bom-cost/:id) ·
`manufacturing-qc` (GET/POST /qc) · `manufacturing-qc-result` (POST /qc-result) ·
`manufacturing-lots` (GET/POST /lots) · `manufacturing-maintenance` (GET/POST /maintenance) ·
`manufacturing-scrap` (GET/POST /scrap) · `manufacturing-resources` (GET/POST /resources) ·
`manufacturing-order-resource` (POST /order-resource) · `manufacturing-capacity` (GET /capacity).
All go through `requireManufacturing` (enable-gate 412 → L1 all-on → matrix). All config.path unique;
:param routes (bom-cost/:id) sit under distinct prefixes from siblings.

## Integration steps (Main chat)
1. Merge `feat/manufacturing-depth-iso` (`cfffd93`).
2. **Prod migrate:** `npm run migrate` against prod applies 074–079 (additive; gated behind
   `client_enabled_products`, so no live tenant is affected in the migrate-right-after window).
3. Push; after deploy, **probe all 14 routes** — new functions can deploy yet 404 at the Edge
   (`netlify api restoreSiteDeploy`). Integration tests bypass routing, so the `:id` routes are
   the real thing to verify live.
4. `npm run seed:manufacturing` (after `seed:inventory`) for demo data across all 6 features.

## Env vars
- **None.** No AI/PDF/mailer seams consumed by these features.

## Gotchas / open items
- **Browser verification owed (iron rule 9):** the 7 tabs were NOT verified in a real browser this
  session (jsdom can't render/eval CSS or DnD). Do a dark-theme + 560px pass, and specifically try
  the Kanban native drag on desktop + the status-button fallback on mobile before sign-off.
- **Migration allocation:** 074–079 confirmed free on main (a sparse set). Confirm no other
  parallel terminal also grabbed them — coordinator's call.
- **Kanban FSM:** the board's client-side LEGAL map mirrors order-advance.ts. Backward lane moves
  (done→in_progress) are intentionally rejected; rework is handled in the Quality tab, not by
  dragging.
- **Full-suite flake:** `u-products-image-thumb` (sharp/webp) fails only under parallel load;
  passes standalone. Pre-existing, not manufacturing.

## Hostile-review — done, clean
A full adversarial pass ran pre-handoff. It **cleared every recurring failure class**:
Owner-bypass parity (8-key grid in both authz + RouteMount, mount gate widened), routing (all 16
config.paths distinct, no literal-vs-`:id` collisions), DATE serialization (all reads `to_char`'d),
cross-tenant scoping, ledger atomicity (QC-scrap + standalone scrap both `sql.transaction` with
pre-check + 23514 backstop), BIGINT/int casts, CSS tokens, migrations, nav, Blobs.

Two findings, both **fixed** in `82d7410`:
- **should-fix** — `ManufacturingPage.load()` fetched BOMs+Orders (products.view) unconditionally,
  giving a business-only user a stuck 403 banner. Now guarded behind `canProducts`.
- **nit** — `/api/manufacturing/costs` GET returned BIGINT `unit_cost_cents` as a string vs the
  `number` type. Now `Number()`'d server-side; test asserts the numeric wire type.

One accepted nit (no change): capacity/maintenance tests use a few fixed unique-constrained literals,
safe because each test seeds a fresh random client_id (matches the repo pattern).

**Final HEAD: `82d7410`** (this doc commit will advance it).
