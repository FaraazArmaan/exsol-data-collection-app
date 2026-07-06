# ExSol — Main Integration Chat Handoff (2026-07-06)

**Living trail for the Main integration / coordinator chat.** Update at every merge/push milestone;
newest status at top. This chat owns `main`, runs prod migrations, batch-pushes, and merges module
worktrees. It does NOT build modules — the isolated module chats do that and hand off paste-ready
prompts.

## Read these first (do not duplicate — referenced by path)
- **Width-sprint master plan + migration allocation + wave gates:**
  `../ExSol-Strategy-WT/docs/strategy/2026-07-02-terminal-fanout-plan.md`
- **POS living trail** (POS-chat scope): `docs/superpowers/handoffs/2026-06-30-pos-session-handoff.md`
- **Project law:** `CLAUDE.md` (root) — iron rules inherited by every worktree.
- **Memory index:** deploy traps, migration coordination, revenue attribution.

## Ground truth as of this handoff
- **PUSHED 2026-07-06:** `origin/main` = `554cb3b` (was `02ef6a2`). Finance 054 + Procurement 056
  + Warehouse 057 + POS-branding-consume are now on prod code. Netlify auto-deploy triggered.
  **Prod migration follow-up:** run `npm run migrate` against prod (applies `057` + closes any
  054/056 gap) and probe the new `/api/{warehouse,finance,procurement}/*` endpoints
  (`restoreSiteDeploy` on any 404). All three modules are gated behind `client_enabled_products`,
  so no live tenant is affected during the migrate-right-after window.
- (Superseded) Local `main` HEAD was `2399f58`; before the push local was 8 commits ahead:
  - `e7dc36b`,`bf9db06` — POS branding consume-refactor (FE-only)
  - `91fde77`,`37efc7a` — **Finance 054**
  - `d61ba14` — **Procurement 056**
  - `3c6e170` — this handoff doc
  - `dff6f24` — **Warehouse 057** (cherry-picked; 6 registry/Sidebar conflicts resolved keep-both)
  - `2399f58` — **Warehouse nav-dedup fix** (found via local smoketest — see below)
- **Working tree clean.** No push yet — batch-deploy rule (accumulate offline-verified commits →
  single push to conserve Netlify credits). Iron rule #7: **this chat commits, the human pushes.**

### Prod DB vs prod code (intentional skew — verify before promoting)
Memory records **migrations 050/052/053/054/056 already applied to prod**, but prod *code* is only
at Email 052. Additive-migration-first pattern (safe: unused columns/tables). Before the next push,
confirm the unpushed commits' features have their migrations present on prod in order. Migrations
present locally on main: `…050, 052, 053, 054, 056, 057` (**note the gaps: no 051, no 055**).
`057_warehouse` is applied to **dev**; apply to **prod** before/with the batch push.

## Merged into local main (integrated) ✅
Inventory 053, Email 052, **Finance 054**, **Procurement 056**, **Warehouse 057**, POS branding-consume, Branding 050.

- **Warehouse 057** (`dff6f24` + `2399f58`): locations layer over Inventory — locations CRUD,
  stock-by-location view, atomic transfer (two `type='transfer'` ledger rows, net-zero on
  `inventory_stock`). Migration `057_warehouse.sql` (additive; `transfer` already in
  `stock_movement_type`). New funcs: `warehouse-locations` (GET/POST `/api/warehouse/locations`),
  `warehouse-location` (PATCH/DELETE `/api/warehouse/location/:id`), `warehouse-stock`
  (GET `/api/warehouse/stock`), `warehouse-transfer` (POST `/api/warehouse/transfer`) + helper
  `_warehouse-authz.ts`. No new env vars. **Local smoketest PASSED** (papa-s-saloon, Owner):
  UI renders, transfer golden flow moves stock + writes ledger. Found + fixed a duplicate
  `/m/warehouse` nav stub (`useNavItems` dedup set missed `warehouse`).

- **Finance 054** (`91fde77` + `37efc7a`): money-legible P&L read-model over `sales` + expenses
  ledger; `incurred_on` returned as `YYYY-MM-DD` (no tz day-shift). Migration `054_finance_expenses.sql`.
- **Procurement 056** (`d61ba14`): suppliers + purchase orders; receiving a PO writes
  `stock_movements` (type=purchase) + increments `inventory_stock`. Migration `056_procurement.sql`.
  Built on merged Inventory 053.

## Built but NOT yet merged to main (worktrees awaiting handoff/merge)
| Module | Branch @ HEAD | State | Merge notes |
|---|---|---|---|
| **CRM 055** | `feat/crm-iso` @ `25e3765` | ~9/13 tasks: migration, list+detail+notes endpoints, FE list page, routes/sidebar done. **Remaining: FE detail page, seed, full-suite verify.** | **Wave-2 GATE.** Migration 055 not on main yet. |
| ~~Warehouse 057~~ | ~~`feat/warehouse-iso`~~ | **MERGED to local main `dff6f24` + nav fix `2399f58` on 2026-07-06.** | Done — see above. |
| **Manufacturing 058** | `feat/manufacturing-iso` @ `6271f46` | **Spec + impl-plan + migration 058 only — implementation IN PROGRESS, not done.** | Do NOT merge yet; TDD in flight. |
| **Analytics** | `feat/analytics-review-iso` @ `24a9a86` | Author's handoff says COMPLETE / prod-live (doc-only commit on branch). | Confirm nothing code-side is stranded on the branch. |

## Wave gates — corrected against `git branch --merged`
Wave 2 (Procurement 056, Warehouse 057, Manufacturing 058, Workforce+PSRM 059) was gated on
**Inventory AND CRM merged**. Inventory is merged; **CRM 055 is still worktree-only.** Procurement
056 already shipped to local main (Inventory dependency satisfied). Workforce 059 (needs CRM's
`crm_customers` ref) stays blocked until CRM merges. **Merging CRM 055 is the highest-leverage next
step** — it unblocks Workforce and the Supply Chain dashboard, and closes the prod migration gap at 055.

## Not yet started / design-only
- **Payments 051** — spec `docs/superpowers/specs/2026-07-01-pos-v2.5-online-payment-design.md`.
  Design-only, **on hold until Razorpay keys.** Migration 051 reserved but unused → the 051 gap on
  main is expected. Needs `RAZORPAY_ENC_KEY` + per-context env when built.
- Wave-3 (Catalog Website, Data Collection 061, Marketing 060, Brand Portfolio 062, Supply Chain
  dashboard) — not started; see fanout plan §12–13.

## Next actions for a fresh Main-chat agent (in order)
1. **Merge-review CRM 055** from `feat/crm-iso` once its author signals the last 3 tasks done
   (FE detail + seed + verify). It's the wave-2/wave-3 unlock.
2. **Merge Warehouse 057** (looks ready) after a review pass + full suite.
3. **Batch-push decision:** when the next 1–2 modules land, push the accumulated main once, then
   apply any still-pending prod migrations **in number order before promoting**, and
   `restoreSiteDeploy`-probe every new function endpoint.
4. Leave Manufacturing 058 alone until its chat hands off.

## Coordinator gotchas (verified conventions)
- **Never `git push` / never merge from a module worktree** — only Main chat merges, human pushes.
- **New Netlify function can deploy but 404 at edge → `netlify api restoreSiteDeploy`.** Always probe.
- **Flat function files only** (a subfolder = one function); two funcs sharing `config.path` must
  both set `config.method`; `/api/foo/:id` routes to `foo.ts` by name.
- **Tests share one persistent dev DB, no teardown** — randomize unique literals; run the FULL
  suite before declaring green.
- Dev Neon endpoint `ep-bold-wildflower-aoi9zvbd`; prod is a separate branch — echo the `ep-` host
  before any destructive psql.

## Suggested skills for the next session
- `superpowers:requesting-code-review` (or a `pr-review-toolkit:code-reviewer` subagent) — over each
  module diff before merging to main.
- `superpowers:verification-before-completion` — enforce typecheck + full vitest green pre-merge.
- `superpowers:using-git-worktrees` — stage by path, never `git add -A` in a sibling (node_modules
  symlink + origin/main drift traps).
- `superpowers:test-driven-development` — if this chat finishes CRM's remaining FE tasks.
