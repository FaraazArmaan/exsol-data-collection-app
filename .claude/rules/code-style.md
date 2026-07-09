# Code style — the cleanup-2 bar

Standards applied (and enforced by example) in the cleanup-2 round. New module code is expected
to meet this bar; the worked examples cited are the reference implementations.

## Shape of logic

- **Code economy is mandatory.** Think before coding. If the clear implementation is 10-20
  lines, do not expand it into 30-50 lines of scaffolding, indirection, or branch noise. Smaller
  is better only when it remains readable, typed, tested, and consistent with local patterns.
- **Isolate blast radius.** Put changes in the file/module/helper that owns the concern. Avoid
  broad shared abstractions or cross-module coupling unless they remove real 3+ copy duplication
  and are covered by tests. A manual edit in one section must not be able to crash an unrelated
  module or public surface.
- **Guard clauses over nesting.** Validate → early-return, then the happy path at top level.
  Handlers follow: parse/validate (400s) → authz (handled by `require<Module>`) → ownership
  checks (404/409) → the actual work.
- **Collapse branch matrices with bound parameters, not code.** If N branches differ only in
  which filters/values apply, prefer ONE SQL statement with null-tolerant predicates —
  `(${x}::uuid IS NULL OR col = ${x})`, `(NOT ${flag}::boolean OR pred)` — over an if/else
  matrix. Worked example: `workforce-asset-assignments.ts` (8-way GET + 4-way UPDATE → one
  query each).
- **Never interpolate SQL identifiers to deduplicate.** neon's tagged template binds VALUES
  only. If branches differ by table/column name, explicit branches are correct — do not reach
  for `sql.unsafe()` to save lines (rejected precedent: the files.ts tier triplets).
- **Load-bearing asymmetry stays.** Before merging "duplicate" branches, prove the asymmetry is
  accidental. Counts-vs-items filters, subtree-vs-flat queries, and 4xx precedence orders are
  usually intentional (see `.claude/rules/api-conventions.md` on error precedence).

## Duplication (rule of three)

- **2 copies: leave them.** Premature coupling is worse than duplication — especially across
  auth contexts (admin vs user-portal surfaces call different backends; keep them separate).
- **3+ copies: extract**, into the layer that owns the concern:
  - cross-seam helpers (used by src AND netlify/functions) → `src/lib/`
    (worked example: `src/lib/customer-dedupe.ts`)
  - function-side shared logic → `netlify/functions/_shared/`
    (worked example: `_shared/module-authz.ts` — iron rule 2's gate order lives in ONE place;
    per-module `_<key>-authz.ts` files are thin wrappers and MUST stay per-module files)
  - module-internal repetition → a LOCAL helper in that file/module
    (worked example: the per-module `gate()` in `*RouteMounts.tsx` — deliberately NOT a
    cross-module factory; each module owns its gate order visibly)
- **Modules never import other modules' internals.** Allowed cross-module imports: `@registry/*`,
  `src/modules/shared/*`, `src/lib/*`, and the user-portal auth context/api types (platform
  seam, relocation deferred). Anything else is a seam violation — extract to src/lib instead.

## Refactoring protocol (behavior-preserving changes)

- **Characterization tests FIRST** when touching thin-tested code: pin every branch/status
  code/error string against the CURRENT implementation, run them green, THEN refactor. If an
  expectation surprises you, fix the TEST to match reality — never the reverse mid-refactor.
  Worked examples: `tests/workforce/asset-assignments-branches.test.ts`,
  `tests/integration/module-authz-characterization.test.ts` (pins 412-vs-403 precedence,
  exact error bodies, L1 full-perm-set).
- **Wire stability is the definition of done**: same status codes, same error code strings,
  same JSON shapes, same header behavior. "Cleaner" 4xx codes are behavior changes.
- **Deletion needs proof, not tool output.** knip/depcheck/jscpd nominate; a per-symbol grep
  (including template-literal prefixes for CSS classes — `` `ord-badge-${status}` `` means
  `.ord-badge-*` is LIVE) convicts. The cleanup-2 CSS audit false-positive rate was ~90%:
  status-suffix class families are almost always dynamically composed.

## Verbosity bar

- One comment where the code can't say it (constraints, precedence, preserved quirks);
  no narration of the next line.
- Prefer the house handler skeleton over inventing structure: config export → zod/manual
  validation → `require<Module>` → tagged-template SQL → `jsonOk`/`jsonError`.
- Keep intentional one-liners intentional: `setField()` chains and explicit branch lists that
  READ clearly are not verbosity — line count is not the metric, re-read cost is.
