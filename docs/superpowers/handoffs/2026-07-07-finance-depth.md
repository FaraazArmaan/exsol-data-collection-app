# Handoff — Finance ERP1 depth (6 features) (2026-07-07)

## ═══════ STATUS: COMPLETE — ready for integration cherry-pick ═══════

Finance depth is **built, tested, and green** on branch `feat/finance-depth-iso` in worktree
`../ExSol-Finance-WT`. **Local commits only — never pushed** (the hook blocks push; isolated terminal).

- **HEAD:** `5791a51`  |  **based on `main` @ `00179bd`**  |  **7 commits** (6 features + docs regen)
- **Done gate:** `tsc --noEmit` 0 errors · **49 finance tests green** (`tests/finance/*`) · full suite green
  **modulo pre-existing shared-DB flakes** (Neon `fetch failed` under load; `auth`/`pub-menu` rate-limit
  timing; `u-products-image-thumb` webp) — all pass in isolation (29/29), none in Finance.
- One commit per feature, typecheck + finance tests green after each.

## What it is (6 depth features on top of Finance v1 / mig 054)

The Finance page is now **tabbed** (Overview | Cashflow | Recurring | Approvals | AI Insights); the active
tab is deep-linked via `?tab=`. Multicurrency + OCR enhance the existing Add-Expense flow.

| # | Feature | Commit | Migration |
|---|---|---|---|
| 1 | **Cashflow calendar** — daily income (sales+bookings) vs expense, month grid + mobile day-list | `362ac41` | none |
| 2 | **Multicurrency ledger** — expenses in any currency, base amount for the P&L | `3807cc8` | 063 |
| 3 | **Recurring/milestone** — templates auto-materialize via cron or on demand | `d7443ad` | 064 |
| 4 | **Expense approvals** — threshold gate, request→approve/reject + audit | `7d9f05a` | 065 |
| 5 | **AI dashboard** — monthly narrative + anomalies over P&L (ai.ts) | `e2a6559` | 066 |
| 6 | **OCR receipt capture** — scan a receipt → prefilled expense form (ai.ts vision) | `4472aa4` | none |

**Spec source:** the D1.1 terminal brief (this branch). No separate design doc — features are the brief's
FEATURE BLOCK.

## Migrations

- **063** `finance_expense_currency` — `currency` / `amount_base_cents` / `fx_rate` on `finance_expenses`.
- **064** `finance_recurring_templates` — templates table + `template_id` FK on `finance_expenses`.
- **065** `finance_approvals` — `finance_settings` (threshold) + `approval_status`/`approved_by`/`approved_at`/`approval_note` on `finance_expenses`.
- **066** `finance_ai_reports` — cache for AI insight reports (PK client_id+month).
- **067–068 reserved but UNUSED** — release back to the coordinator's pool.
- All additive + idempotent. **Applied to DEV.** **Prod: run `npm run migrate` against the prod
  DATABASE_URL before deploying this code** (P&L reads the new columns).

## New Netlify functions (flat files) + routes

| File | Route | Method | Perm |
|---|---|---|---|
| `finance-cashflow.ts` | `/api/finance/cashflow?month=` | GET | `finance.business.view` |
| `finance-recurring.ts` | `/api/finance/recurring` | GET/POST | view / create |
| `finance-recurring-detail.ts` | `/api/finance/recurring-detail/:id` | PATCH/DELETE | edit / delete |
| `finance-recurring-run.ts` | `/api/finance/recurring-run` | POST | create |
| **`finance-recurring-cron.ts`** | (scheduled `0 2 * * *`, no route) | — | system |
| `finance-settings.ts` | `/api/finance/settings` | GET/PUT | view / edit |
| `finance-approvals.ts` | `/api/finance/approvals?status=pending\|decided` | GET | view |
| `finance-approval-decide.ts` | `/api/finance/approval-decide/:id` | POST | edit |
| `finance-ai-insights.ts` | `/api/finance/ai-insights?month=` | GET/POST | view / edit |
| `finance-ocr-receipt.ts` | `/api/finance/ocr-receipt` | POST | create |

Helpers (`_` prefix, not routes): `_finance-fx.ts` (base conversion + resolveCurrency),
`_finance-recurring.ts` (`materializeDueTemplates`), `_finance-settings.ts`, `_finance-ai.ts`,
`_finance-ocr.ts`; `_finance-validators.ts` extended. Multi-method routes all set `config.method`;
detail/run/decide use distinct path segments (no literal sub-path under a `:param`).

**⚠️ `finance-recurring-cron.ts` is a NEW scheduled function** — Netlify scheduled functions are still
greenfield in this repo (only `booking-pending-cleanup` precedes it). **Verify it registers on first
deploy.** The real logic is the directly-testable `materializeDueTemplates(sql, {clientId?, asOf?})`, so
the on-demand `POST /recurring-run` covers the same behaviour without waiting for the schedule.

## Registry + enablement

- **No manifest change.** All permission keys stay `finance.business.{view,create,edit,delete}` — the
  DATA_BUCKETS/VERBS unions are closed, so approvals/AI/etc. reuse the `business` bucket. Sidebar/router/
  nav unchanged (still one "Finance" link → tabbed page).
- `npm run seed:finance` (extended) demos every feature on `papa-s-saloon`: 19 expenses across 3 months
  incl. **1 USD** expense (multicurrency), 4 recurring/milestone templates, a **₹50,000 approval threshold
  + 1 pending expense**. AI insights generate on-demand; OCR is interactive. Enable prod tenants via
  product management (the `finance` product must be in `client_enabled_products`).

## Env vars

- **`ANTHROPIC_API_KEY` — optional, NEW consumer.** The AI dashboard and OCR call the shared `_shared/ai.ts`
  seam, which **never throws**: with no key (dev) it returns a deterministic rule-based summary / empty OCR
  prefill flagged `is_fallback`, and lights up automatically once the key is set. Nothing else new.

## Behaviour changes vs Finance v1 (important for integration)

1. **P&L expense sum now uses `amount_base_cents`** (was `amount_cents`) so mixed-currency ledgers
   aggregate in the client base currency — matches sales/booking revenue (always base).
2. **P&L + cashflow EXCLUDE pending/rejected expenses** (`approval_status IS NULL OR 'approved'`). An
   above-threshold expense doesn't hit net until approved.
3. **Cron-materialized expenses skip the approval gate by design** — the recurring template is the
   authorization (only manually-entered expenses are gated).

## Gotchas / decisions

- **Currency is format-only** (`src/lib/currency`, no rate source) → the fx rate is **entered per
  expense** (major base units per 1 entry unit). Same-currency ⇒ rate 1, base == amount. JPY (0 decimals)
  handled via `currencyMeta().decimals`, not a hardcoded `/100`. Migration 063 backfills existing rows to
  INR/rate-1 — safe only because papa-s-saloon (the only finance client) is INR-based.
- **AI seam**: no JSON mode — the endpoint instructs JSON, parses, and **clamps every field** (a
  hallucinated category/currency/date is dropped). Rule-based fallback beats an empty dashboard. Reports
  cache per (client, month); `POST /ai-insights` force-regenerates (edit perm — LLM calls cost).
- **OCR** validates every extracted field to what the form accepts before returning the prefill; the user
  always reviews before saving. **Receipt-image persistence (Blobs + a `receipt_key` column) is
  intentionally deferred** — this slice is extract→prefill only.
- **Approvals audit** uses the shared `logAudit` seam (op `finance.expense.approved|rejected`, target
  `finance_expense`). The decide UPDATE is guarded on `approval_status='pending'` + client scope, so
  cross-tenant / already-decided ids are 404 (no double-decide).
- **L1 Owner bypass** unchanged (in `_finance-authz.ts` + `FinanceRouteMounts.tsx` + registry-driven
  Sidebar) — new endpoints all go through `requireFinance`, which already has it.

## Theming (iron rule #9)

All new UI uses `.fin-*` classes consuming **only** `src/lib/theme.css` dark tokens
(`--bg-surface/-elevated`, `--text-primary/-secondary/-muted`, `--border-subtle/-default/-strong`,
`--accent`+`--text-on-accent`, `--success`/`--danger`). No invented vars, no hardcoded light values.
jsdom doesn't eval CSS vars — **confirm the 5 tabs + modals in a real browser** (`netlify dev --port 5185
--target-port 8895`), incl. the 560px calendar grid→list switch.

## Deferred (none block merge)

- Recurring catch-up materializes **one period per run** (a months-behind template advances gradually as
  the daily cron runs); loop-to-present if bulk catch-up is wanted.
- Editing an expense's amount does **not** re-trigger the approval gate (create-time only).
- Approvals is a **single-step** chain (one approver); multi-step sequence is a future extension.
- OCR receipt-image storage (see above).

## Verification note

`tests/finance/*` (49 tests) cover: cashflow daily totals + tz + empty; multicurrency base compute (USD +
JPY) + cross-currency sum + missing-rate 400 + patch recompute; recurring materialize/advance + milestone
deactivate + foreign base + run endpoint + paused-skip; approvals threshold gate + P&L exclusion + approve
counts + audit row + reject + double-decide 404 + edit-perm gate; AI fallback structure + loss→high-severity
anomaly + cache/regenerate; OCR field-mapping + invalid-field-drop + no-key fallback + non-JSON degrade +
media-type 400. FE is typecheck-verified; a real-browser smoke of the 5 tabs was **not** run headlessly.
