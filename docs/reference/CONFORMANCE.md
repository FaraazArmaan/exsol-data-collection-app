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
| analytics | ✓ | ✓ | ⚠ no enable-gate | ⚠ passthrough mount | ✓ (moved) | ✓ `.analytics-*` |
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
| supply-chain | ✓ | ✓ | ⚠ no enable-gate | ⚠ passthrough mount | ✓ (moved; gating.ts at root is the de-facto client perm layer) | ✓ `.sc-*` |
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

1. **analytics + supply-chain lack the 412 enable-gate** in their authz files. A disabled-module
   workspace can still hit their endpoints if the caller holds (or is Owner and bypasses) the
   permission check. Both also use thin passthrough RouteMounts with section-level gating in the
   dashboard instead of a route-level redirect. Fixing changes HTTP responses → deferred.
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
