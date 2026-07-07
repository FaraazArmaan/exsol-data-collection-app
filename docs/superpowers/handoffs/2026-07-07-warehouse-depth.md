# Warehouse DEPTH — module-chat handoff (2026-07-07)

**Scope:** File Manager terminal, queue 1 — Warehouse DEPTH (4 features) on top of Warehouse v1
(mig 057, already on main). Isolated module chat: local commits only, **no push / no merge / no
deploy** — the Main integration chat owns that. This doc is the paste-ready trail for integration.

## Ground truth
- **Worktree:** `../ExSol-FileManager-WT`
- **Branch:** `feat/warehouse-depth-iso` — based on `main` @ `00179bd` (post-cleanup, includes 9346668)
- **HEAD:** `8fdeb70` · 7 commits ahead of main · tree clean
- **Verification:** `npm run typecheck` clean; **full suite 1389/1389** (239 files); warehouse module
  suite 24 → **61** tests. Migrations 093–096 applied to the dev branch.

## Commits (oldest→newest)
| SHA | Feature |
|---|---|
| `5307e09` | Putaway Tasks (mig 093) |
| `3368a79` | Inbound ASN (mig 094) |
| `18f6394` | Safety Management (mig 095) |
| `eb59ff6` | AI Warehouse (mig 096) |
| `0184e64` | reference-doc regen (endpoints + schema) |
| `7fa31cf` | fix: Owner-bypass gap — full `warehouse.products.*` set (hostile-review blocker) |
| `8fdeb70` | fix: `to_char` DATE columns + sales-only slotting velocity (hostile-review) |

## Features
1. **Putaway Tasks** — received-PO lines land in a queue awaiting a home; confirm allocates into a
   `stock_by_location` row and writes a net-zero `type='transfer'` movement pair (receipt already
   counted the total, so `inventory_stock` is untouched). Generation is idempotent (partial unique
   index on `purchase_order_item_id`). Cross-module: READs Procurement `purchase_orders`/`_items`.
2. **Inbound ASN** — advance shipment notices, optionally linked to a PO (lines pre-fill from PO
   items), with per-line expected-vs-received variance. Pure reconciliation — does **not** mutate
   `inventory_stock` (Procurement's PO receive owns the stock increment; avoids double counting).
3. **Safety Management** — `safety_incidents` (dated, severity-graded, open→closed) + recurring
   `safety_checklists` with `safety_checklist_signoffs`; "due" derived from latest signoff vs cadence.
   Standalone, no cross-module deps.
4. **AI Warehouse** — slotting suggestions. Candidates DERIVED DETERMINISTICALLY (stock sitting away
   from the pick-face store location, ranked by 90-day **sale** velocity); `_shared/ai.ts` writes the
   rationale (keyless dev fallback → demoable without a key). Nothing moves until a human applies
   (runs a real transfer) or dismisses. Full audit trail in `warehouse_slotting_suggestions`.

FE: `WarehousePage` is now a tabbed shell — **Stock & Locations / Putaway / Inbound / Safety /
AI Slotting**. All tabs gated by the same bucket×verb perms as their endpoints. Namespaced `.wh-*`
CSS, theme tokens only, 560px mobile rules.

## Migrations (093–096, additive + idempotent)
- `093_warehouse_putaway` — `warehouse_putaway_tasks`
- `094_warehouse_asn` — `inbound_asns` + `asn_lines`
- `095_warehouse_safety` — `safety_incidents` + `safety_checklists` + `safety_checklist_signoffs`
- `096_warehouse_slotting` — `warehouse_slotting_suggestions`

No new `stock_movement_type` value (`'transfer'` already existed). No new DataBucket — perms reuse the
existing `warehouse.business.*` (locations/safety) and `warehouse.products.*` (stock/putaway/ASN/AI).

## New Netlify functions + routes (14)
| Function | Route(s) | Perms |
|---|---|---|
| `warehouse-putaway` | `GET /api/warehouse/putaway` | products.view |
| `warehouse-putaway-generate` | `POST /api/warehouse/putaway-generate` | products.edit |
| `warehouse-putaway-confirm` | `POST /api/warehouse/putaway-confirm` | products.edit |
| `warehouse-asn` | `GET+POST /api/warehouse/asn` | products.view / .create |
| `warehouse-asn-detail` | `GET /api/warehouse/asn-detail/:id` | products.view |
| `warehouse-asn-receive` | `POST /api/warehouse/asn-receive` | products.edit |
| `warehouse-products` | `GET /api/warehouse/products` | products.view |
| `warehouse-safety-incidents` | `GET+POST /api/warehouse/safety-incidents` | business.view / .create |
| `warehouse-safety-incident` | `PATCH+DELETE /api/warehouse/safety-incident/:id` | business.edit / .delete |
| `warehouse-safety-checklists` | `GET+POST /api/warehouse/safety-checklists` | business.view / .create |
| `warehouse-safety-signoff` | `POST /api/warehouse/safety-signoff` | business.edit |
| `warehouse-ai-slotting` | `GET /api/warehouse/ai-slotting` | products.view |
| `warehouse-ai-slotting-generate` | `POST /api/warehouse/ai-slotting-generate` | products.edit |
| `warehouse-ai-slotting-decide` | `POST /api/warehouse/ai-slotting-decide` | products.edit |

All go through `requireWarehouse` (enable-gate 412 → `level_number === 1` Owner all-on → matrix).

## Integration steps (for the Main chat)
1. Merge `feat/warehouse-depth-iso` (`8fdeb70`) into main.
2. **Prod migrate:** `npm run migrate` against prod applies `093–096` (additive; gated behind
   `client_enabled_products`, so no live tenant is affected in the migrate-right-after window).
3. Push; after Netlify deploy, **probe all 14 routes** — new functions can deploy yet 404 at the Edge;
   `netlify api restoreSiteDeploy` fixes it. Pay attention to the `:param` routes
   (`asn-detail/:id`, `safety-incident/:id`) — integration tests bypass routing so they're the real
   thing to verify live.
4. `npm run seed:warehouse` (after `seed:inventory`) for papa-s-saloon demo data.

## Env vars
- **None required.** AI slotting uses `_shared/ai.ts`, which falls back to a deterministic canned
  rationale when `ANTHROPIC_API_KEY` is unset (dev/CI/demo). Set `ANTHROPIC_API_KEY` for live rationale.

## Gotchas / open items
- **Browser verification owed (iron rule 9):** the 5 tabs were NOT verified in a real browser this
  session (jsdom doesn't render CSS). Hostile review cleared theme-token usage statically, but do a
  dark-theme + 560px mobile pass before final sign-off.
- **Owner-bypass fix is included** (`7fa31cf`): `ALL_WAREHOUSE_PERMS` in both `_warehouse-authz.ts` and
  `WarehouseRouteMounts.tsx` is now the full 8-key grid. Lesson logged to memory
  `feedback_module_l1_bypass_pattern` (depth-work variant: a new required key must be added to the
  synthetic Owner set, or the Owner is blanked relative to a permissioned L2).
- **Migration allocation:** 093–096 were free on main (a sparse set: 001–062 + 107 + 137). Confirm no
  other parallel terminal also grabbed 093–096 — coordinator's call.
- **Dependency:** Putaway + ASN READ Procurement (056) — already on main. AI + PDF seams
  (`_shared/ai.ts`, `_shared/pdf.ts`) present on main.

## Hostile-review result
Full adversarial pass run pre-handoff. One BLOCKER (Owner-bypass, fixed `7fa31cf` + regression tests),
one SHOULD-FIX (DATE serialization, fixed `8fdeb70`), one NIT (velocity double-count, fixed `8fdeb70`),
one NIT declined (rgba modal scrim — theme-agnostic, pre-existing from v1). All other categories
(routing, cross-tenant scoping, ledger net-zero, cross-module writes, key-shape, test-DB) held clean.
