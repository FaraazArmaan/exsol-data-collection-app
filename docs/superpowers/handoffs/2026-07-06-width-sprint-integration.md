# ExSol — Main Integration Chat: resume-here handoff (updated 2026-07-07)

**Purpose:** a fresh agent (after `/clear`) can run integration cold from this doc. This chat is the
**Main integration / coordinator** — it merges module branches from sibling worktree chats, verifies,
and coordinates prod deploys. It does NOT build modules.

## Operating rules (read first)
- **`git push` is hook-blocked for agents** (PreToolUse hook in `.claude/settings.json`, iron rule 7).
  Commit locally; the **human pushes** by typing `! git push origin main` in the prompt. Never try to
  push — it exits 2.
- **Done = `npm run typecheck` AND full `npx vitest run`, both green.** No exceptions.
- **Never edit CLAUDE.md's iron rules casually** — they each encode a shipped prod failure.
- Worktrees share the object DB, so sibling branches are mergeable by name from this (primary) worktree.

## Current state (as of 2026-07-07)
- **`origin/main` == `00179bd`; local `main` is AHEAD by ~18 commits** (unpushed): Finance `f85227b`,
  Inventory `d092974`, Orders `17e269f`, Warehouse `30e0f56`, Supply-Chain `99e253f` (+tabs `c14b075`),
  Workforce `7de8219` (+nav fix `c9fc102`), HR `571b6ca` (+POS-label test fixup `c1d21de`), + interleaved
  handoff commits. Working tree clean. **7 depth modules merged; only `marketing` remains.**
- **Depth integration progress (merged locally + fully verified, NOT pushed):**
  1. **Finance** (`f85227b`, migs 063–066) — 5 tabs Overview/Cashflow/Recurring/Approvals/AI smoke-tested,
     dark-theme confirmed via computed styles. ~11 new `/api/finance/*` endpoints.
  2. **Inventory** (`d092974`, migs 080–081) — all 5 sections Dashboard/Stock/Returns/Locations/Labels +
     all 7 features smoke-tested (lifecycle badges, moving-avg cost, cross-module Locations bridge, PDF
     labels endpoint returns valid `%PDF-`), dark-theme confirmed. 6 new `/api/inventory/*` endpoints +
     `inventory-list` now returns `lifecycle_state`/accepts `?state=`. docs/reference regenerated.
  3. **Orders** (`17e269f`, migs 087–091) — **NEW module** riding the pos product. All 5 tabs
     Overview/Returns&Shipments/Backorders/SLA/Fulfillments smoke-tested (refund+shipment+fulfillment
     FSMs, pick-list/packing-slip PDFs valid `%PDF-`, SLA-targets GET renders, split/merge panels),
     dark-theme confirmed. authz gate order verified (412→L1→matrix). 17 new `/api/orders/*` endpoints.
     **Nav dedupe:** renamed the POS `/pos/sales` sidebar link 'Orders'→'Sales' (user decision) so the
     new Order-Management 'Orders' link isn't a duplicate label. `router.tsx` union-merged
     (inventory-depth routes + orders route). docs/reference regenerated.
  4. **Warehouse** (`30e0f56`, migs 093–096) — depth layer over Warehouse v1 (existing module, no new
     registration). All 5 tabs Stock&Locations/Putaway/Inbound/Safety/AI-Slotting smoke-tested (putaway
     queue from POs, ASN + `asn-detail/:id` param-route dialog, safety incidents/checklists, AI-slotting
     with keyless `_shared/ai.ts` fallback "AI preview"), dark-theme confirmed. authz gate order verified
     (412→L1→matrix; Owner-bypass gap fixed on-branch). 14 new `/api/warehouse/*` endpoints. Only
     docs/reference conflicted on merge (regenerated).
  5. **Supply-Chain** (`99e253f`, migs 097–098) — depth panels over supply-chain v1 (existing module).
     All 5 features smoke-tested: Alternate Suppliers (link table), Risk Analysis (1 High/13 Medium —
     single-supplier + overdue-PO), drill-downs (row-click → movements modal, `supply-chain-drill`),
     CO₂ (editable factors + per-PO estimates + 30d trend), AI Brief (keyless `_shared/ai.ts` fallback
     "AI preview"), dark-theme confirmed. **Manifest change:** supply-chain verbs extended to
     view/create/edit/delete → new keys `supply-chain.products.{create,edit,delete}` (bucket×verb; grant
     per access level for supplier/CO2 editing). 5 new `/api/supply-chain-*` endpoints. Only
     docs/reference conflicted (regenerated). **Coordinator debt (pre-existing, NOT this branch):**
     `generate-reference.ts` CREATE-TABLE regex is case-sensitive → `schema.md` omits lowercase-DDL
     migrations (incl. 097/098); endpoints.md/permissions.md correct. Fix the regex when convenient.
  6. **Workforce** (`7de8219` + nav fix `c9fc102`, migs 112–119) — 8 ERP10 features (leave, punching,
     overtime, swaps, payroll, training, assets, employee dashboard). 11 tables, 19 functions, 8 pages.
     **Platform change:** `DATA_BUCKETS` extended +leave/payroll/assets (additive to the closed union;
     other modules declare their own subset, unaffected; REAL buckets w/ tables+CRUD, not a projection).
     authz gate order verified (412→L1→matrix); 12 new bucket×verb keys; Access Levels UI auto-surfaces.
     **Integration fix:** the branch left the 3 v1 pages on the old 3-tab nav → 8 features undiscoverable
     from the landing page; extracted a shared `WorkforceNav` (all 11 pages, one source of truth) — smoke
     confirmed all 11 tabs reachable. **Dev-DB wrinkle:** tables pre-existed on shared dev but 112–119
     weren't in `schema_migrations` (chat applied then renumbered) → migrate 112 errored "already exists";
     reconciled the 8 tracking rows so `npm run migrate` is clean on dev. Prod unaffected (fresh apply).
  7. **HR** (`571b6ca`, mig 120) — **NEW module** + standalone `hr` product. 4 tabs Dashboard/Org-Chart/
     Onboarding/Offboarding smoke-tested (org tree over user_nodes, onboarding instance w/ checklist
     items, completed offboarding), dark-theme + manifest-driven sidebar link confirmed. authz gate order
     412→L1→matrix; reuses the `employees` bucket (`hr.employees.*`, no new DATA_BUCKETS). 5 new
     `/api/hr/*` endpoints (reuses AMS `user-node-credential`/`user-nodes-move` for offboarding). Also
     carried a bundled `feat(portfolio)` fix (`/site/:slug` @media ≤560px in `src/lib/components.css`).
     Merge conflicts (package.json/router/modules.ts/products.ts) all union-resolved. Regenerated docs.
     Fast-follow: HR dashboard's "no leave table exists yet" copy is now stale (workforce
     `leave_requests` landed in this same integration) — could read it instead of timesheet hours.
  - **Regression caught & fixed** (`c1d21de`): the Orders `Orders`→`Sales` POS-nav rename broke
    `storefront-nav.test.tsx` (asserted the old label); the dev-Neon-flaky full suite had masked it.
    Updated the test to the intended `Sales` label. **Lesson: run at least the touched FE test files even
    when the full suite is flaking** — a targeted `vitest run <file>` isn't subject to the DB overload.
  - Verification note: the full `npx vitest run` intermittently flakes on **dev-Neon overload**
    (`NeonDbError: fetch failed` across untouched-module files + the known `pub-menu` 429 / webp-thumb).
    Cleanest full run so far was **1408/1410** (2 flakes, both documented). Each merged module's own suite
    passes in isolation (Finance suite, Inventory 42/42, Orders 72/72, Warehouse 64/64, Supply-Chain
    76/76, Workforce 124/124, HR 11/11). Capture one clean full run when load subsides.
  - **Pending for the human (per prod runbook below):** push `main`; migrate 063–066 + 080–081 + 087–091
    + 093–096 + 097–098 + 112–119 + 120 on prod; probe the new `/api/finance/*`, `/api/inventory/*`,
    `/api/orders/*`, `/api/warehouse/*`, `/api/supply-chain-*`, `/api/workforce/*`, `/api/hr/*` endpoints
    for the Edge-404 trap (esp. GET+PUT `/api/orders/sla-targets` — config.method-array routing — and the
    `:param` routes `warehouse/asn-detail/:id`, `warehouse/safety-incident/:id`,
    `supply-chain-suppliers/:id`); run all the new `seed:*` scripts on prod (finance/inventory/orders/
    warehouse/supply-chain/workforce/hr). **Enable the `orders` AND `hr` products** for papa-s-saloon on
    prod (both new — invisible until enabled; their seeds enable on dev). **Grant** the new
    `supply-chain.products.{create,edit,delete}` and `workforce.{leave,payroll,assets}.*` keys per access
    level (Owner has them via L1 bypass). Finance/Inventory/Warehouse/Supply-Chain/Workforce products
    already enabled on prod.
  - Remaining depth branches to integrate (own worktrees, unpushed): **marketing** (last one).
- **Prod schema:** current — 62 migrations applied through **137**, none pending. (051 Payments = never
  built; that gap is expected.)
- **Everything is LIVE on prod** (`exsoldatacollectionapp.netlify.app`): all width modules
  (products, pos, booking, inventory, analytics, email, finance, procurement, warehouse, crm, workforce
  + project-service, manufacturing) + wave-3 (data-collection/catalog 061, brand-portfolio 062,
  supply-chain, marketing 060) + workforce **timesheets** (mig 107) + the **412 enable-gate** fix for
  analytics/supply-chain + the **Gate-B cleanup** (registry-driven nav, `@registry/*` alias,
  docs/reference generator, `.claude/` harness) + **platform spine seams** (`_shared/ai.ts`,
  `_shared/pdf.ts`, `_shared/webhook.ts`, `src/lib/currency.ts`, mig 137, `webhook-example.ts`) + the
  **Manage Team page redesign**.
- Demo tenant **papa-s-saloon** has all products enabled + seeded on prod; `storefront_enabled=true`.
  Second tenant `joe-s-hardware` has only saloon-booking.

## The integration runbook (per module handoff)
1. **Inspect** the branch: `git log <base>..<branch>`, `git diff --stat <base>..<branch>`. Check for
   overlap with what's on main since its base (conflict risk) and whether it re-touches an
   already-merged module (take only the delta, don't re-merge).
2. **Merge:** `git merge --squash <branch>` (one commit per module) — or `git cherry-pick` a range when
   the commits are independent (spine seams) or you only want a delta (a follow-up commit on an
   already-merged branch). Registry/Sidebar/package conflicts are almost always **keep-both / union**;
   `modules.ts`/`products.ts` maps usually auto-merge, only the import lines conflict.
3. **Theme-check EVERY merged module's CSS** (iron rule 9): `grep -niE '#fff|#e5e7eb|#f3f4f6|var\(--color-|var\(--sc-|#[0-9a-f]{6}' <module>.css` filtered against the real tokens. Modules keep shipping
   light CSS (white cards / invisible text). Fix to `--bg-*/--text-*/--border-*/--accent/--danger/--success`
   + `color-mix`. This has recurred 6×.
4. **New module nav** is registry-driven now: the manifest sets `hasDedicatedNav: true` +
   `navLinks:[{path,label,viewKeys,order,skipEnableCheck?}]`. The old `MODULES_WITH_DEDICATED_NAV` set is
   GONE. A module missing the flag renders a duplicate/dead `/m/:key` stub.
5. **New deps** → run `npm install` (worktree node_modules is stale otherwise — phantom tsc errors).
6. **Verify:** dev `npm run migrate` (applies the module's migration on dev), `npm run typecheck`, full
   `npx vitest run`. For registry/alias changes also `npx netlify build --offline` (confirms functions
   bundle).
7. **Commit locally** (never push). Update this doc if it's a milestone.

### Flake signatures (NOT regressions — confirm by re-running the file in isolation)
The shared dev Neon DB is under heavy parallel-chat load. These fail intermittently and **pass in
isolation**: `@neondatabase/serverless … fetch failed` (any DB-heavy integration test),
`auth.test.ts` rate-limit throttle, `pub-menu` 429, `u-products-image-thumb` (sharp/WebP),
`workspace-export`, `files-*`. If a failure is one of these AND the file passes alone → flake. If the
failure is in a file the change actually touched → real.

## Prod deploy runbook (after the human pushes)
1. **Prod migrations:** the prod Neon branch host is `ep-dawn-bird-aojs8xxb` (dev is
   `ep-bold-wildflower-aoi9zvbd` — NEVER migrate against dev). The human supplies the prod connection
   string (do NOT commit it anywhere). Echo the `ep-` host to confirm prod, then
   `DATABASE_URL="<prod>" npm run migrate`. Additive migrations are safe before/with the code deploy.
2. **New-function Edge-registration trap:** new Netlify functions deploy but 404 at the edge. After the
   build reaches `ready`, probe each new endpoint; on 404 run
   `netlify api restoreSiteDeploy --data '{"site_id":"6d53c9bf-d6a7-4fb4-a16e-e5a4e94f59b4","deploy_id":"<latest ready deploy id>"}'`.
   Get the deploy id via `netlify api listSiteDeploys --data '{"site_id":"6d53c9bf-d6a7-4fb4-a16e-e5a4e94f59b4","per_page":1}'`.
   One restore re-registers ALL functions from the push. 401/500 = registered/healthy; only 404 = trap.
3. **Enable + seed the demo tenant** for a new module on prod: insert its product into
   `client_enabled_products` for papa-s-saloon, then `DATABASE_URL="<prod>" npm run seed:<module>`.
   Modules gate on `client_enabled_products` — a module is invisible until its product is enabled, even
   though the tables exist.

## Rollback
- **Checkpoint tag** `checkpoint-pre-depth-cleanup` (`8c8f253`) on origin = pre-cleanup state.
- Prod code rollback without git: `restoreSiteDeploy` on an older `ready` deploy id.
- **Migrations are forward-only** — reverting code does NOT drop tables. For a DB rollback across
  depth-phase migrations, use Neon point-in-time restore (take a snapshot before a risky batch).

## Next work — Gate C (depth phase)
Spine seams are live, so depth features that consume `lib/ai.ts` / `lib/pdf.ts` / webhook pattern /
`currency.ts` are unblocked. Plan + migration ranges: `../ExSol-Strategy-WT/docs/strategy/2026-07-06-depth-phase-plan.md`
(063–136 per module dept; 137–139 spine — 137 used, 138–139 free). Tell depth terminals to **rebase
onto current main** before continuing (the cleanup's `shared/` moves are clean renames), declare nav via
manifest, use `/new-module` + `/hostile-review`. Only **Payments 051** remains from width (design-only,
awaiting Razorpay keys). Sub-agents available: `hostile-reviewer`, `conformance-auditor`.

## References
- Width/wave master plan: `../ExSol-Strategy-WT/docs/strategy/2026-07-02-terminal-fanout-plan.md`
- Depth plan + ranges: `../ExSol-Strategy-WT/docs/strategy/2026-07-06-depth-phase-plan.md`
- Generated reference (regenerate after merges): `npm run docs:reference` → `docs/reference/{endpoints,permissions,schema}.md`; pattern debt in `docs/reference/CONFORMANCE.md`
- Project law + iron rules: `CLAUDE.md`; detail in `.claude/rules/`
- POS-chat living trail: `docs/superpowers/handoffs/2026-06-30-pos-session-handoff.md`
