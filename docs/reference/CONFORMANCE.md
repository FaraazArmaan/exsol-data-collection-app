# Module-pattern conformance

Audited 2026-07-06 on `chore/systematize-iso` (every registry module × every element of the
canonical module pattern). Hand-written from a three-agent code audit; re-verify by reading the
cited files, not by trusting this table.

## The canonical pattern

Every registry module is expected to have:

| Element | Meaning |
|---|---|
| **E1 manifest** | `src/modules/registry/manifests/<key>.ts`, registered in `registry/modules.ts` |
| **E2 product** | a `ProductManifest` in `registry/products-list/` lists the module (iron rule 4) |
| **E3 authz** | `netlify/functions/_<key>-authz.ts` with enable-gate (412) FIRST, then `level_number === 1` Owner bypass (iron rule 2) |
| **E4 routemount** | `src/modules/<key>/*RouteMount*.tsx` applying the same enable-gate → Owner-bypass order client-side |
| **E5 shared** | `src/modules/<key>/shared/{types,api,permissions}.ts` |
| **E6 css** | namespaced module CSS consuming `src/lib/theme.css` dark-theme tokens (iron rule 9) |

Reference implementations: **inventory** (all six), **products** (E5), **booking/pos** (E3+E4).

## Matrix (post-sweep state)

| Module | E1 | E2 | E3 | E4 | E5 | E6 |
|---|---|---|---|---|---|---|
| analytics | ✓ | ✓ | ✓ (412 gate added) | ⚠ passthrough mount | ✓ (moved) | ✓ `.analytics-*` |
| booking | ✓ | ✓ | ✓ | ✓ | ✓ (moved; no permissions.ts) | n/a (no module css) |
| catalog | ✓ | ✓ | ⚠ inline in pub-catalog.ts (public 404 gate) | n/a public page | ✗ (page-only module) | ✓ `.cat-*` |
| crm | ✓ | ✓ | ✓ | ✓ | ✓ (moved; permissions.ts unwired) | n/a |
| data-collection | ✓ | ✓ | ✓ | n/a public token page | ✓ (no permissions.ts) | ✓ `.dc-*` |
| email | ✓ | ✓ (via pos + saloon-booking products) | ✓ | ✓ | ✓ (permissions.ts unwired) | n/a |
| finance | ✓ | ✓ | ✓ | ✓ | ✓ (permissions.ts created, wired both sides) | ✓ `.fin-*` |
| inventory | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ `.inv-*` |
| manufacturing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ `.mfg-*` |
| marketing | ✓ | ✓ | ✓ | ✓ | ✓ (moved; permissions.ts unwired) | n/a |
| payments | ✓ | ✓ | ✗ | ✗ | ✗ | n/a |
| portfolio | ✓ | ✓ (brand-portfolio.ts) | ✓ | ✓ | ✓ | n/a |
| pos | ✓ | ✓ | ✓ (also gates on products) | ✓ | ✓ (moved; no permissions.ts — POS uses legacy action keys) | ✓ `.pos-*` |
| procurement | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ `.proc-*` |
| products | ✓ | ✓ | ⚠ via `_shared/permissions.ts` | ⚠ direct pages + scope provider | ✓ (reference) | n/a |
| project-service | ✓ | ✓ (rides workforce.ts) | ✓ via _workforce-authz | ✓ via WorkforceRouteMounts | n/a (no src dir — intentional, lives in workforce) | n/a |
| supply-chain | ✓ | ✓ | ✓ (412 gate added) | ⚠ passthrough mount | ✓ (moved; gating.ts at root is the de-facto client perm layer) | ✓ `.sc-*` |
| warehouse | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ `.wh-*` |
| workforce | ✓ | ✓ (carries project-service) | ✓ | ✓ | ✓ (moved; no permissions.ts) | ✓ `.wf-*` |

CSS sweep result: **zero** violations of iron rule 9 anywhere (no `--color-*`/`--sc-*`/`--border:`/
`--muted-bg` invented vars, no hardcoded `#fff`/`#e5e7eb`/`#f3f4f6`).

## Fixed in this sweep (zero behavior change)

- Moved module-root `api.ts`/`types.ts` into `shared/` for booking, pos, analytics,
  supply-chain, workforce, crm, marketing (9 files, all importers rewritten — all were
  module-internal except `catalog/CatalogPage.tsx` → pos).
- Created `finance/shared/permissions.ts`; `_finance-authz.ts` and `FinanceRouteMounts.tsx`
  now import the previously-duplicated `ALL_FINANCE_PERMS` from it.

## Known debt — NOT fixed here (behavioral; needs its own reviewed change)

1. ~~**analytics + supply-chain lack the 412 enable-gate**~~ — **FIXED** (2026-07-06): the 412
   `<module>_module_not_enabled` enable-gate now runs BEFORE the Owner bypass in both
   `_analytics-authz.ts` and `_supply-chain-authz.ts` (admin + bucket-user branches), mirroring
   `_procurement-authz.ts`. Remaining (unchanged): both still use thin passthrough RouteMounts with
   section-level gating in the dashboard instead of a route-level redirect — client-side only, no
   HTTP-response impact; deferred.
2. **payments is a registry-only stub** — manifest + product entry, no module dir, no authz, no
   routes. Either intentional placeholder or dead registry weight; decide before building on it.
3. **Unwired `shared/permissions.ts` scaffolds** exist in crm, email, inventory, marketing,
   procurement, warehouse (knip flags them as unused files). They were kept as
   pattern-conformance scaffolding; wiring RouteMounts/pages through them is editorial churn
   deferred to module owners. Empty scaffolds were NOT added to modules lacking the file
   (booking, pos, workforce, data-collection) — a scaffold nothing imports is dead code.
4. **POS legacy action-namespaced keys** (`pos.menu.view`, `pos.sale.*`, `pos.history.*`) are
   FROZEN legacy (iron rule 3). Documented, not migrated.
5. **products/catalog use platform-level auth** (`_shared/permissions.ts` /
   inline pub gate) rather than a dedicated `_<key>-authz.ts` — long-standing pattern for the
   two oldest surfaces; conforming them is a behavior-risk refactor with no current bug.

## Cleanup-2 round (2026-07-08, chore/cleanup-2-iso)

Structural changes (all wire-behavior-preserving, char-tested):

- **E3 is now factory-backed**: 14 `_<module>-authz.ts` files are ~25-line thin wrappers over
  `_shared/module-authz.ts` (`makeModuleAuthz`) — iron rule 2's gate order lives in ONE
  implementation. Excluded by design: _pos (gates on PRODUCT keys), _analytics, _supply-chain
  (custom shapes). Wire behavior pinned by
  `tests/integration/module-authz-characterization.test.ts` (3 modules deep + all-14 412-code
  table).
- workforce + pos RouteMounts adopted the per-module local `gate()` (every module now conforms).
- `normalizePhone`/`dedupeKey` moved to `src/lib/customer-dedupe.ts` (was a cross-module
  internals import: crm → booking/lib).
- orders' authz perm list deduped into `orders/shared/permissions.ts` (finance/hr pattern).

Debt changes:
- RESOLVED: crm→booking internals import; workforce/pos RouteMount nonconformance; orders
  authz/shared perm-list duplication.
- UNCHANGED: unwired shared/permissions.ts scaffolds (crm, email, inventory, marketing,
  procurement, warehouse); payments stub; products/catalog platform auth; analytics/supply-chain
  passthrough RouteMounts.
- NEW (documented, deferred): `user-portal/user-auth-context` + api types are a platform seam
  imported by 20+ modules from inside the user-portal folder — relocation to src/lib is correct
  but maximum-churn (~30 files); needs its own solo window.
- Full audit + metrics: docs/reference/CLEANUP-2-AUDIT.md.

## tsconfig strictness

Already on: `strict`, `noUncheckedIndexedAccess`. Enabled in this sweep at zero cost (0 new
errors): `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`.

Remaining flags = debt (error counts measured 2026-07-06):

| flag | errors | note |
|---|---|---|
| `noUnusedLocals` | 20 | overlaps eslint `no-unused-vars` (warn-level in the lint baseline) |
| `noUnusedParameters` | 5 | same |
| `exactOptionalPropertyTypes` | 72 | mostly `prop?: T` assigned `undefined` explicitly; mechanical but wide |
| `noPropertyAccessFromIndexSignature` | 306 | permission-matrix `permissions[key]` style access everywhere; NOT recommended — the codebase's index-signature access is idiomatic |
