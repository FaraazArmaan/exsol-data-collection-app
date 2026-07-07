# Cleanup-2 audit (code-quality round)

Audited 2026-07-08 on `chore/cleanup-2-iso` (tag `cleanup-2-base` = main @ `075a8ac`).
Read-only phase-1 findings. Tools: jscpd, knip, depcheck, madge, cross-module import scan,
3 read-only code-audit agents (findings spot-verified — see CSS caveat, which is a worked
example of why "dead" claims need per-class verification).

## Baseline metrics (before)

| metric | value |
|---|---|
| src+functions LOC (ts/tsx, incl tests) | 71,166 |
| non-test src LOC | 38,128 (src) + 27,381 (functions) |
| jscpd duplication | **4.82% lines / 283 clones** (ts: 6.81%) |
| circular deps (madge) | **0** |
| knip | 8 unused files, 39 unused exports, 76 unused types |
| depcheck | prettier only (config-only by design — keep) |
| baseline suite | 1869/1870 — **1 pre-existing red** (see F0) |

## F0 — pre-existing red baseline (must fix first)

`tests/supply-chain/risk.test.ts:235` "overdue_po: past expected_on → flagged" fails
deterministically between 00:00–05:30 IST: the seed computes "3 days ago" in UTC date math
(`seedPO(…, -3)`) while `supply-chain-risk.ts:152` counts days in the tenant timezone
(`now() AT TIME ZONE tz`). Local date ≠ UTC date in that window → "4 day(s) overdue".
**Test-only fix**: compute the seed/expectation from the same tenant-tz day arithmetic.

## a. Duplication clusters (3+ = extraction candidates; 2 = leave alone)

### A1. `_<module>-authz.ts` family — 17 files, ~576 pairwise-dup lines ★ biggest win
13 plain files (_booking, _crm, _data-collection, _email, _finance, _hr, _inventory,
_manufacturing, _marketing, _orders, _portfolio, _procurement, _warehouse) share a verbatim
~58-line core: requireBucketUser→401, level+perms SQL, 412 enable-gate, L1 Owner bypass,
matrix check. Variants: _pos (dual products+pos gate), _workforce (dual-module gate, one
param each); _analytics + _supply-chain are structurally different (admin paths, scopes) —
**excluded**. Factory `_shared/module-authz.ts`:
`makeModuleAuthz({ moduleKey: string | string[], allPerms, extraGate? })` → est. **~700 net
lines removed**, wire-identical. Coverage: per-module authz tests exercise 401/403/412/L1/200.
Risk: HIGH blast radius (all module auth) — do LAST, hostile-review after.

### A2. `*RouteMounts.tsx` — workforce (157 lines, 12 mounts) + pos (119 lines, 7 mounts)
Both lack the local `gate()` helper that booking/inventory/crm/manufacturing already use.
Adopting the SAME per-module local-factory pattern (not a cross-module lib) saves ~140 lines
and aligns the family. Iron-rule-2 order must be preserved verbatim. jsdom tests exist for pos
(PosRouteMounts.test.tsx); workforce mount tests to be checked/added as characterization first.

### A3. `shared/api.ts` fetch-wrapper family — 7 modules, ~126 dup lines (optional)
email/inventory/manufacturing/orders/portfolio/procurement/warehouse each re-declare the same
~15-line fetch wrapper + ApiError class. A `src/lib/module-api.ts` factory would remove ~100
lines. Optional: benefit is modest and it couples 7 modules to one helper; cuttable.

### A4. Small clusters — LEAVE (2-copy or low value)
analytics-* handlers (5 files, 94 lines — shared WHERE-clause shape, but each query differs);
client-levels/roles AMS handlers (5, 81); files-detail/download/thumbnail (3, 43 — shared
access-resolution, subtle tier logic); workforce-leaves/punches/timesheets (3, 52);
team-modals (3, 36); exporters csv↔xlsx (2, 68); Leave↔Overtime pages (2, 64);
AccessDashboard↔UserManageTeam (2, 216 — see NOT-DOING).

## b. Verbosity hotspots (agent-audited, behavior-preserving)

| # | site | lines saved | risk | tests |
|---|---|---|---|---|
| V1 | `workforce-asset-assignments.ts:38-122` handleGet — 8-branch if-pyramid, same SELECT ×8, collapse to dynamic WHERE | ~65 | low | **THIN — characterization test first** |
| V2 | `workforce-asset-assignments.ts:226-262` handlePatch — 4 near-identical UPDATEs → one COALESCE update | ~28 | low-med | THIN — same test file as V1 |
| V3 | `files-detail.ts:123-140` PATCH tier-permission triplet → mapping loop | ~14 | low | good |
| V4 | `files.ts:149-163` POST same tier triplet | ~10 | low | good |

**V3/V4 (theme T4) REJECTED at implementation review**: the three tier branches differ in
table AND column names; neon's tagged-template `sql` cannot parameterize identifiers, so the
"mapping loop" would require `sql.unsafe()`/dynamic identifiers inside permission-adjacent
code to save ~24 lines. Explicit branches are clearer and safer — readability over brevity.
No code changed.

Explicitly NOT verbosity (load-bearing asymmetries, agent-verified): login.ts dual client
lookups, user-nodes.ts subtree branches, u-products.ts counts-vs-items filters,
user-nodes-move.ts three move cases, u-products-detail.ts setField chain (clear as-is).

## c. Dead code

- knip unused files: 6 unwired `shared/permissions.ts` (crm, email, inventory, marketing,
  procurement, warehouse — known CONFORMANCE debt; wire or leave, do NOT delete) + 2
  operational scripts (keep, documented).
- 39 unused exports / 76 unused types: mostly `export` keywords to drop (symbol used in-file)
  or genuinely dead helpers (e.g. `branding/index.ts` re-exports, `analytics/format.ts
  localISO`). Mechanical sweep with per-symbol verification; ~150-250 lines.
- CSS: see NOT-DOING — the "dead class" audit was 90%+ false positives.

## d. Structure smells

- S1: `user-portal/user-auth-context` + `user-portal/api` types are imported by 20+ modules'
  RouteMounts/permissions — platform infrastructure living inside a module folder. Correct home:
  `src/lib/` (or `modules/shared/`). ~30-file mechanical move; DEFER unless wanted (churn vs
  purity; every open feature branch would conflict).
- S2: `crm/lib/merge.ts → booking/lib/dedupe` (normalizePhone) — also used by
  `_booking-customer-upsert.ts`. 3 consumers across seams ⇒ move `normalizePhone` to `src/lib/phone.ts`.
- S3: catalog→pos internals (`pos/pages/MenuPage`, `NotAvailableCard`) — documented legacy
  (catalog reuses the menu grid); leave, note in CONFORMANCE.
- S4: `team-modals → ams/api` (7 imports) — shared component importing one side's API for types;
  a types-only extraction exists (`team-modal-api.ts`) but is bypassed. Small tidy; optional.
- S5: two authz files regressed to deep relative registry imports post-systematize:
  `_analytics-authz.ts:18`, `_supply-chain-authz.ts:17` → `@registry/products` (2-line fix).

## e. Bad connections

- madge: **zero circular dependencies**.
- No config.path/method collisions introduced since last round (not re-audited here; generator
  docs current as of main).
- Cross-module import scan: 55 total; all but ~8 are the S1 auth-context/api-types seam; the
  rest are S2/S3/S4 above.

## NOT-DOING (recommended against, with reasons)

1. **CSS dead-class deletion**: the audit agent flagged 62 classes; spot-verification proved
   11/11 sampled families LIVE via template literals (`fin-anomaly-${severity}`,
   `ord-badge-${status}`, `inv-life-${lifecycle}`, `wh-pill-${…}`, `hr-badge-${…}`,
   `crm-badge-${…}`, `proc-badge-${…}`, `sc-severity-${…}`, `mfg-prio-${…}`,
   `block-${status}`, `booking-status-${…}`). Deleting = silently unstyled status badges;
   jsdom stays green. The residual truly-dead set is too small to justify the verification cost.
2. **AccessDashboard ↔ UserManageTeam merge** (216 dup lines): same-looking onDragEnd calls
   DIFFERENT backends (moveUserNode vs moveNode), different narrowing semantics, different
   session kinds. Extraction = parameterized callbacks that mix admin/user auth surfaces.
   Premature coupling worse than duplication.
3. **exporters csv↔xlsx dedup** (68 lines, 2 copies): rule of three not met; formats genuinely
   diverge (dates, streaming).
4. **S1 auth-context relocation now**: correct but maximum-churn; propose for a solo window
   after this round if wanted.
5. **analytics/_supply-chain authz conformance rewrite**: behavioral (HTTP shapes); stays
   CONFORMANCE debt.

## Proposed phase-2 themes (one commit each, safest first)

| # | theme | est. impact | risk |
|---|---|---|---|
| T0 | fix tz-dependent supply-chain risk test (baseline → green) | 1 test | none (test-only) |
| T1 | S5: 2 authz files → @registry alias | hygiene | none |
| T2 | dead exports/types sweep (knip-verified, per-symbol) | ~200 lines | low |
| T3 | S2: normalizePhone → src/lib/phone.ts (3 consumers) | seam fix | low |
| T4 | V3+V4: files.ts + files-detail.ts tier-map collapse | ~24 lines | low (well-tested) |
| T5 | A2: workforce + pos RouteMounts adopt local gate() | ~140 lines | med (iron rule 2; jsdom tests) |
| T6 | V1+V2: workforce-asset-assignments collapse (+ characterization test FIRST) | ~93 lines | med (thin tests today) |
| T7 | A1: makeModuleAuthz factory, 13 plain files (+_pos/_workforce if trivial) | ~700 lines | HIGH (auth; do last; hostile-review) |
| T8 | A3 (optional): shared/api fetch-wrapper factory | ~100 lines | med — CUTTABLE |
| P3 | .claude/rules/code-style.md + CONFORMANCE/docs refresh | — | none |

Projected duplication after T5+T7: ~4.8% → ~2.5-3%.
