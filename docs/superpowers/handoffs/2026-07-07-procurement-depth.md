# ERP2 Procurement — DEPTH build (D1.3) — Handoff

**Branch:** `feat/procurement-depth-iso` · **HEAD:** `205ee28` · **Base:** main `efcb588` (post-cleanup, includes 9346668)
**Worktree:** `../ExSol-ProcurementDepth-WT` · **Not pushed** (hook-blocked; the human integrates via Main).
**Status:** all 5 depth features complete, one commit each, typecheck clean, procurement suite 41/41.

---

## TL;DR

Five depth features on Procurement v1 (migration 056), one commit per feature. Four additive
migrations (069–072; 073 spare). New surfaces hang off the existing `ProcurementTabs` (Purchase
Orders · Suppliers · 3-Way Match · Trends). Integrates the **Finance** module (3-way match creates
a `finance_expenses` row) and reuses the **currency** util + **recharts** (lazy-loaded).

## Commits (one per feature)

| SHA | Feature |
|---|---|
| `bad2b3e` | Supplier deepen — payment terms, rating (1–5), and a supplier_contacts child table |
| `0833e4b` | Price Manager — per-supplier per-product prices + history; PO lines default from current price |
| `7a0fac8` | Vendor Approvals — threshold-gated PO chain draft→pending_approval→ordered (approve/reject) |
| `66761a9` | 3-Way Match GRN — PO × goods-received × invoice; mismatch flags; on-match creates a Finance expense |
| `205ee28` | Trend Analytics — spend by supplier / category / month (recharts, lazy) |

## Migrations (reserved 069–073; used 069–072)

- **069** `suppliers.payment_terms` + `suppliers.rating` (CHECK 1–5) + `supplier_contacts`.
- **070** `supplier_prices` (append-only; current = latest `effective_from <= today`). Distinct from
  the alternate-vendor `product_suppliers` table (migration 097, another module).
- **071** `'pending_approval'` PO status (transaction-safe ADD VALUE) + `purchase_orders`
  .submitted_at/approved_by/approved_at + `clients.po_approval_threshold_cents`.
- **072** `goods_receipts` + `goods_receipt_items` + `supplier_invoices` +
  `purchase_orders.finance_expense_id`.
- **073 unused** — Trend Analytics reads existing tables.
- Applied to **DEV only** (`ep-bold-wildflower`). Apply to **prod before/with the code deploy** (additive).

## New endpoints (functions)

- `procurement-suppliers` / `-supplier-detail` — now carry payment_terms + rating.
- `procurement-supplier-contacts` (GET/POST) + `procurement-supplier-contact-detail` (DELETE).
- `procurement-prices` (GET current/history + POST set).
- `procurement-settings` (GET/PATCH approval threshold).
- `procurement-order-transition` — rewritten FSM (order is threshold-aware; approve/reject added).
- `procurement-grn`, `procurement-invoices` (GET/POST).
- `procurement-match` (GET compute + POST confirm → Finance expense, race-guarded).
- `procurement-spend` (GET spend aggregates).

All gate via `requireProcurement` (enable-gate 412 → L1 bypass → matrix). New FE routes under
`/c/:slug/procurement/`: `match`, `trends` (trends is lazy-loaded).

## Cross-module integration

- **Finance**: a confirmed 3-way match INSERTs a `finance_expenses` row directly (category
  `'supplies'`, base currency, fx_rate 1, `approval_status = NULL` so it flows into the P&L) and
  links it back via `purchase_orders.finance_expense_id`. The `WHERE finance_expense_id IS NULL`
  guard on the link makes it single-shot (no double-expense). This is the established write pattern
  (mirrors `finance-expenses.ts`), not a cross-function HTTP call.
- **product_suppliers (097)**: left untouched — the Price Manager owns its own history table.

## New deps / env vars

None (recharts + currency util already on main).

## Verification

- `npm run typecheck` clean; **procurement suite 41/41** (9 files); seed ran green.
- Full suite: **1727 passed / 2 failed** — both **pre-existing environmental flakes, confirmed green
  in isolation (17/17 together), neither procurement-related**:
  `u-products-image-thumb` (sharp/WebP cache-miss) and `pos/CartPage.test.tsx` (jsdom navigation
  timing under concurrent load). Re-run `npx vitest run <file>` to confirm any red is one of these.

## Gotchas / follow-ups

- **Enum ADD VALUE** (071) is transaction-safe because the new value isn't used in the same migration.
- **3-way match is status-agnostic** server-side (works on any owned PO); the FE dropdown filters to
  ordered/received for UX.
- **Trends route is lazy** (`ProcurementSpendMount`, a self-contained gate) to keep recharts out of
  the main procurement chunk — mirrors analytics/supply-chain.
- **Currency**: `finance_expenses` uses the client's `base_currency`; FE `formatMoney` still uses the
  INR default (base_currency isn't plumbed to the FE client — platform follow-up).
- **CSS**: theme tokens only, 560px breakpoints added — jsdom can't verify; check dark theme + mobile
  in a REAL browser before merge (iron rule 9).
- **Deploy**: ~10 new functions → new-function-404 trap; bundle-hash change → alias-not-promoted. Run
  `restoreSiteDeploy` + probe the new endpoints after the push.
