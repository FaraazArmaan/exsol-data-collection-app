# Supply Chain DEPTH — handoff for Main integration chat

**Status:** ✅ Complete on `feat/supply-chain-depth-iso` @ `bb7d672` (worktree `ExSol-Analytics-WT`, base `main@00179bd`). Typecheck clean; FULL suite **1407/1407** (pipefail-confirmed). NOT pushed/merged (isolated terminal).

**Plan:** `docs/superpowers/plans/2026-07-07-supply-chain-depth.md`
**Per-feature review ledger:** `.superpowers/sdd/progress.md` (worktree, git-ignored)

## Commits (10, off 00179bd)
```
bb7d672 fix: bound single-supplier risk + drill product names + banner copy   (final-review fixes)
8ae79ae fix: manifest test expects extended CRUD verbs
3a6c576 chore: CO2 error state + fallback test + docs:reference regen
40ddeb1 feat: AI-SCM narrative brief (ai.ts seam)               [F5]
338df2c feat: CO2 calculator (mig 098, per-category factors + trend) [F4]
57f4345 feat: dashboard drill-downs (movements, PO items, BOM)  [F3]
55f56b6 feat: risk analysis (single-supplier, lead-time, overdue POs) [F2]
f505ea6 fix: F1 delete routing + suggestAlternate helper + suppliers panel gating
438f464 feat: alternate vendor & supplier management (mig 097)  [F1]
dd4fadd docs: depth plan
```

## Migrations
- **097** `product_suppliers` (product↔supplier: lead_time_days, unit_cost_cents, is_primary; one-primary partial unique index).
- **098** `co2_emission_factors` (per category_id + null=client-default; partial unique indexes).
- Both additive + splitter-safe, applied to DEV. **Run `npm run migrate` on the PROD Neon URL before/with promote.**
- **Reserved 099–101 UNUSED** — free for another terminal.

## New functions + routes
| File | Routes | Auth |
|---|---|---|
| `supply-chain-suppliers.ts` | `GET`/`POST /api/supply-chain-suppliers`, `DELETE /api/supply-chain-suppliers/:id` | view read; create/edit/delete writes |
| `supply-chain-risk.ts` | `GET /api/supply-chain-risk` | view |
| `supply-chain-drill.ts` | `GET /api/supply-chain-drill?type=&id=` | view |
| `supply-chain-co2.ts` | `GET`/`POST /api/supply-chain-co2` | view read; edit write |
| `supply-chain-brief.ts` | `GET /api/supply-chain-brief` | view (uses `_shared/ai.ts`) |
| `_supply-chain-lib.ts` | (helper) `suggestAlternate` / `batchSuggestAlternates` | — |
| `_supply-chain-authz.ts` | (modified) added `resolveSupplyChainWrite(req, key)` | — |

## Permissions
`supply-chain` manifest verbs extended `view` → `view/create/edit/delete` → **new keys** `supply-chain.products.{create,edit,delete}`. Grant per access level for supplier/CO2 editing. (Enable-gate + L1-owner-bypass order preserved in both resolvers.)

## Env vars
None required. AI brief falls back to a deterministic canned response with no key. For **live** briefs, set the Anthropic key `_shared/ai.ts` reads.

## Gotchas
- **ZEROTH (412 enable-gates) were ALREADY on main** in both `_analytics-authz.ts` and `_supply-chain-authz.ts` — skipped as done.
- **Probe the 5 new endpoints post-deploy**; `netlify api restoreSiteDeploy` if Edge 404s.
- **Stale worktree deps:** `ExSol-Analytics-WT` needed `npm install` for `@anthropic-ai/sdk` + `pdf-lib` (main's seam deps) before typecheck passed — do the same in any worktree touching these.
- **Verify dark-theme + 560px mobile in a REAL browser** (jsdom can't catch CSS-var / layout issues) for the new panels.

## Non-blocking fast-follows (from final opus review; safe to patch in place)
set-primary not transactional (DB unique index is backstop); "today" tz inconsistent risk/brief (tenant tz) vs co2 (UTC); co2 `byPo` GET unbounded (add a date window); 403 code drift (reads `forbidden` vs writes `missing_permission`); `risk.counts.low` is a dead always-0 tier; DRY the co2 category-factor subquery + tenant-tz helpers into `_supply-chain-lib.ts`.

## Pre-existing coordinator debt (NOT this branch)
`scripts/generate-reference.ts` uses a case-sensitive `CREATE TABLE` regex → generated `schema.md` omits every lowercase `create table` migration (041, 053–061, 097, 098). `endpoints.md`/`permissions.md` (TS-derived) regenerated correctly. Fix the regex.
