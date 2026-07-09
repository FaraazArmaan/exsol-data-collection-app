# Codex Module Terminal Start Guide

Read this file before starting any module terminal work. This repo has many active
worktrees; the goal is to let module work proceed in parallel without migration,
auth, nav, permission, or routing collisions.

## First Read

In this order:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `CONTRIBUTING.md`
4. `.claude/rules/module-pattern.md`
5. `.claude/rules/api-conventions.md`
6. `.claude/rules/testing.md`
7. `.claude/rules/migrations.md`
8. `.claude/rules/code-style.md`
9. `docs/reference/CONFORMANCE.md`
10. `docs/reference/endpoints.md`
11. `docs/reference/permissions.md`
12. `docs/reference/schema.md`
13. `docs/architecture-expansive.html`

For strategy context, read:

- `worktrees/ExSol-Strategy-WT/docs/strategy/2026-07-01-strategy-discussion.md`
- `worktrees/ExSol-Strategy-WT/docs/strategy/2026-07-06-depth-phase-plan.md`
- `worktrees/ExSol-Strategy-WT/docs/strategy/2026-07-08-cleanup-2-plan.md`

## Worktree Protocol

Use the pre-existing module worktree when one exists. Start from current `main`
unless the human explicitly gives a different base.

Before writing code:

```sh
git status --short
git branch --show-current
```

If the worktree is not already on the intended isolated branch, create one from
main:

```sh
git checkout main
git pull --ff-only
git checkout -b feat/<module-or-task>-iso
git branch --show-current
```

Never push. Commit locally only. The human/Main integration chat pushes.

## Non-Negotiable Rules

- Think before coding. If a clear solution takes 10-20 lines, do not write 30-50. Keep code
  compact, readable, typed, tested, and aligned with existing patterns.
- Isolate every change to the owning module/helper/surface. Do not introduce coupling where a
  manual edit in one section can crash an unrelated module, section, or site surface.
- Migration numbers come from the human coordinator. Never invent one.
- One SQL statement per line. Comments on their own line, never after a `;`.
- Module authz order is: session -> enable-gate -> L1 Owner bypass -> matrix check.
- L1 Owner bypass belongs in server authz and RouteMount/UI gating.
- Permission keys are bucket-by-verb only: `<module>.<bucket>.<verb>`.
- POS action keys are frozen legacy. Do not create new action-namespaced keys.
- A module needs both a `ModuleManifest` and a `ProductManifest` entry.
- Set `hasDedicatedNav: true` and `navLinks` in the module manifest when the
  module has dedicated nav or must stay out of the generic module rail.
- Netlify functions stay flat in `netlify/functions/`.
- Shared `config.path` requires `config.method` on every function sharing it.
- Module CSS must use `src/lib/theme.css` dark-theme tokens only.
- Tests use a persistent shared dev DB. Randomize unique literals.
- Mock `getStore()` in every test file whose handler touches Netlify Blobs.
- If endpoints, manifests, or migrations change, run `npm run docs:reference`.

## Module Pattern Checklist

For new or deep module work, check these files first:

- `src/modules/registry/manifests/<module>.ts`
- `src/modules/registry/products-list/<product>.ts`
- `src/modules/registry/modules.ts`
- `src/modules/registry/products.ts`
- `src/modules/<module>/<Module>RouteMounts.tsx`
- `src/modules/<module>/shared/types.ts`
- `src/modules/<module>/shared/api.ts`
- `src/modules/<module>/shared/permissions.ts`
- `src/modules/<module>/<module>.css`
- `netlify/functions/_<module>-authz.ts`
- `netlify/functions/<module>-*.ts`
- `scripts/seed-<module>.ts`
- module tests under `tests/` and `src/**/__tests__/`

Reference implementation: Inventory is the cleanest complete module pattern.

## Verification Bar

Before handoff:

```sh
npm run typecheck
npm test
```

Also run targeted tests while iterating. For UI/CSS changes, verify in a real
browser; jsdom will not catch dark-theme CSS variable mistakes or mobile layout
breakage.

## Handoff Format

End module work with:

```text
Work done.

Worktree:
Branch:
HEAD:
Migrations used:
New/changed functions and routes:
New/changed env vars:
Docs regenerated:
Tests run:
Summary:
Gotchas / review priority:
```

Flag anything touching auth, money, inventory/stock, payments, email delivery,
cross-client scope, or migration ordering as high-priority review.
