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
  (`restoreSiteDeploy` on any 404). All modules are gated behind `client_enabled_products`,
  so no live tenant is affected during the migrate-right-after window.
- **PUSHED 2026-07-06 (batch 2):** `origin/main` = `ab5f475` (was `554cb3b`). Added **CRM 055**
  (`2218180`), **Workforce 059** (`200304d`), **Manufacturing 058** (`ab5f475`) + docs. All three
  squash-merged, full suite **1248/1248** + typecheck clean, **local smoketests PASSED** (CRM:
  list→detail→timeline→add-note; Workforce: projects FSM + crm_customers FK path; Manufacturing:
  complete order → consume/produce, 4 `type='production'` ledger rows, output +25 / 3 components −25).
  **Prod migration follow-up (run now):** `npm run migrate` against prod applies **055, 057, 058, 059**
  in filename order (055 before 059 satisfies the FK; 058 needs only 053). Then probe
  `/api/{crm,workforce,manufacturing}/*` (+ warehouse if 057 wasn't applied in batch 1) —
  `restoreSiteDeploy` on any 404. All modules gated behind `client_enabled_products`.
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

## Merged into main + pushed to prod (integrated) ✅
- **Marketing Automation 060** (`c3b0bcd`): campaigns over CRM + mailer. Migration 060 (the free
  gap). Endpoints marketing/campaigns(+:id)/audience-count/send; live send reuses Email RESEND key
  (dev-fallback logs). Smoketest passed (a 500 seen once was a transient Neon fetch-failed, cleared
  on reload). **Before enabling live Resend: sanitize `body_html` on render (stored-XSS).**
  PROD: migrate 060, enable product, `seed:marketing`.
- **Workforce Timesheets** (`245fbdf`, migration **107**): log/approve/delete billable time.
  Fixed the modified-already-applied-059 trap by extracting `timesheet_entries` to `107_timesheet_entries.sql`
  (`IF NOT EXISTS` — no-op on dev where it pre-existed, creates on prod), reverting the 059 edit.
  Dark-themed the branch's light `.wf-ts-*` CSS (rule #9). 1329/1329; smoketested; prod migrated + live.
- Marketing 060 + Timesheet endpoints hit the Edge-registration trap on deploy → `restoreSiteDeploy`
  on deploy `245fbdf` → all `/api/{marketing,workforce}/*` now 401 (live). restoreSiteDeploy on a
  `ready` deploy re-registers ALL functions, so one restore covers a multi-module push.

Inventory 053, Email 052, **Finance 054**, **Procurement 056**, **Warehouse 057**, **CRM 055**, **Workforce 059**, **Manufacturing 058**, **Data Collection + Catalog 061**, **Brand Portfolio 062**, **Supply Chain dashboard (no mig)**, POS branding-consume, Branding 050.

- **Supply Chain dashboard** (`7d3250a` + dark-theme fix `a4fe1d0`): read-projection over
  inventory/procurement/manufacturing — **NO migration**. 3 GET endpoints
  (`supply-chain-inventory/procurement/manufacturing`). Route `/c/:slug/supply-chain` (recharts
  code-split). Enable the `supply-chain` product per client. Smoketest passed (panels populate;
  fixed white-panel light-CSS on merge). PROD: enable product + `seed:supply-chain` for the demo.

### Prod-enablement pattern (learned this session)
Migrations create tables; they do NOT enable modules for a tenant. A new module is invisible on prod
until its product is in `client_enabled_products` AND (for demo data) its `seed:*` script has run
against prod. Full prod bring-up = push → migrate → **enable products** → **seed** (all done for
papa-s-saloon; joe-s-hardware still only saloon-booking).

- **Data Collection + Catalog 061** (`b2d7a0a`): public `/catalog/:slug` (storefront-minus-cart + contact CTA)
  + `/onboard/:token` (guest CSV/XLSX import → Product Manager). Migration 061 (onboard_tokens +
  clients.contact_phone/email). Smoketest passed. Catalog & Data Collection have NO sidebar entry
  (fix `8dc4d26` kept them out of the generic rail).
- **Brand Portfolio 062** (`a6ab94e`): public `/site/:slug` (hero + product grid + gallery + booking/
  contact) + authed editor `/c/:slug/brand-site`. Standalone `brand-portfolio` product (enable per-client).
  Migration 062 (brand_site_config). Smoketest passed. **Note:** the site's product grid needs
  `clients.storefront_enabled=true` (uses pub-menu); else it shows a graceful "catalogue coming soon".
  Enabled it for papa-s-saloon on **dev** during smoke.

- **Manufacturing 058** (`ab5f475`, squash of feat/manufacturing-iso): BOMs + production orders over
  Inventory. Product `manufacturing` (requires products+inventory). Migration `058_manufacturing.sql`
  (enum production_order_status + boms/bom_components/production_orders). Order-advance consumes
  components + produces output via `stock_movements` type='production'. 4 endpoints + authz.
  Smoketest: completed a qty-25 order → 4 production ledger rows, output +25 / 3 components −25.
  v1 deferrals (documented, not bugs): concurrent double-complete can double-consume (needs
  SELECT FOR UPDATE); BOM picker lists only stocked products. See `project_manufacturing_058_deferrals`.

- **CRM 055** (`2218180`, squash of feat/crm-iso): read-model over sales+bookings; `crm_customers`
  + `crm_notes`; endpoints crm-refresh/customers-list/customer-detail/notes/note-detail; FE list +
  detail (live timeline + notes CRUD). Smoketest: added a note live, timeline shows 7 orders.
- **Workforce+PSRM 059** (`200304d`, squash of feat/workforce-psrm-iso): two modules
  (workforce/employees + project-service/business+customers) under `workforce` product
  (requires saloon-booking). `workforce_shifts`, `projects`, `project_assignments`
  (`projects.customer_id` → `crm_customers`, so merged AFTER CRM). 7 workforce-* endpoints.
  Smoketest: projects list + detail render; shift grid degrades to empty-state without booking_resources.

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
| ~~CRM 055~~ | ~~`feat/crm-iso`~~ | **MERGED to local main `2218180` on 2026-07-06** (squash, smoketested). | Done — see above. |
| ~~Warehouse 057~~ | ~~`feat/warehouse-iso`~~ | **MERGED to local main `dff6f24` + nav fix `2399f58` on 2026-07-06.** | Done — see above. |
| ~~Workforce+PSRM 059~~ | ~~`feat/workforce-psrm-iso`~~ | **MERGED to local main `200304d` on 2026-07-06** (squash, after CRM). | Done — see above. |
| ~~Manufacturing 058~~ | ~~`feat/manufacturing-iso`~~ | **MERGED to main + pushed `ab5f475` on 2026-07-06** (squash, smoketested). | Done — see above. |
| **Analytics** | `feat/analytics-review-iso` @ `24a9a86` | Author's handoff says COMPLETE / prod-live (doc-only commit on branch). | Confirm nothing code-side is stranded on the branch. |

## Wave gates
Wave 2 (Procurement 056, Warehouse 057, Manufacturing 058, Workforce+PSRM 059) gated on Inventory
AND CRM merged — **both now merged**, so Workforce 059 landed (CRM FK satisfied). Remaining
worktree work: **Manufacturing 058** (impl in progress — do not merge). Migration gaps on main:
**051** (Payments — design-only, awaiting keys) and **058** (Manufacturing — not merged); both
expected. Wave-3 (Catalog Website, Data Collection 061, Marketing 060, Brand Portfolio 062, Supply
Chain dashboard) not started.

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
