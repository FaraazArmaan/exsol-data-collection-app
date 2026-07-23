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

## Roadmap and Feature-Depth Standard

Before proposing module phases or writing implementation code, make a
production feature-completeness pass. A main page, endpoint, or happy-path test
does not mean a module is complete.

The roadmap is the human's system-design learning notes, not a management
summary or a bare implementation checklist. It must explain ownership,
trade-offs, lifecycle, data flow, failure handling, and why boundaries exist.
It must include a prominent annotated file-system tour: a readable terminal-style
tree of important current and recommended files/directories, why each belongs
there, and one real request traced through UI, typed API, handler, authz,
domain/helper logic, database, response, and tests.

Build a feature-completeness map before writing phases. For every relevant
actor—operator/front desk, manager/owner, customer/public user,
administrator, support/finance/downstream operator, and mobile/field user where
applicable—identify the complete job to be done. Go beyond CRUD and include:

- discovery, search, filter, sort, comparison, detail views, and saved views;
- creation, editing, duplication, archiving/restoring, bulk work, import/export,
  printing/sharing, and configuration;
- validation, loading, empty, error, offline/retry, conflict, exception, and
  recovery states;
- history/audit, notifications, accessibility, keyboard/scanner/touch use,
  responsive behaviour, permissions, and support context;
- customer-safe selection, pricing/availability/status messaging, stable public
  URLs where relevant, and consistent information through the next lifecycle
  step.

For each material feature, state its data owner, API contract, permission rule,
storage/integrity need, UI state, test evidence, downstream consumer, and why
it is in scope. Separate verified existing features, production gaps,
quality-of-life improvements, deliberately deferred capabilities, and explicit
non-goals. Use feature matrices and concrete examples; do not begin a phased
roadmap until this analysis is complete.

Every module roadmap must therefore include: current inventory; a
feature-completeness map; good/bad/missing assessment; domain/storage model;
click-to-database flow; platform dependency and ownership map; stable contracts;
annotated file-system tour; phased plan with acceptance/tests/migration rationale;
risks; handoff; and newcomer glossary/learning path. Use the established
Payment-roadmap design language unless the human provides another visual
reference, and preserve useful facts if a roadmap already exists.

## UI/UX Discovery and Decision-Efficiency Standard

Run UI/UX discovery only after the roadmap is approved or the human explicitly
requests it. First read `src/public/ExSol-UIUX-Guidelines.html`; accepted shared
platform decisions are binding and must not be repeatedly re-litigated in each
module. Research current production and accessibility practice from
authoritative sources, audit the actual module in a real local browser, and
include desktop, phone, keyboard, loading, empty, error, disabled, destructive,
conflict and recovery states relevant to the workflow.

Use efficient batched decisions by default:

- Automatically accept and record established, low-risk production conventions
  when they do not create a meaningful domain, commercial, operational,
  accessibility, security, privacy, cost, implementation-risk or cross-module
  ownership trade-off.
- Do not ask the human to approve obvious safety defaults individually. Examples
  include truthful availability/stock wording, no silent price or money change,
  visible loading/error/recovery states, accessible focus treatment, hosted
  payment-provider credential collection, and explicit pending-versus-complete
  language.
- Auto-acceptance is not permission to silently choose business policy, add
  schema, select a paid service, change data/consent behaviour, move ownership,
  or broaden scope. Those remain explicit human decisions.
- Ask only when two or more reasonable choices materially affect customer
  experience, workflow speed, business policy, data/consent, ownership,
  operations, cost, accessibility or implementation risk.
- Group related unresolved choices into one interactive batch: normally 3–5
  decisions and never more than 6. Each decision may have at most three clearly
  labelled options and must identify a recommendation, rationale, limits and
  practical implications.

Create or update `[Module]-UIUX-Options.html` as a learning and decision lab,
run it on localhost, and provide the exact URL. Each batch must clearly separate:

1. **Recorded production defaults** — automatically accepted conventions with
   a short reason and implementation consequence.
2. **Your decisions** — only consequential choices needing A/B/C input.

For every user decision, keep a realistic interactive desktop preview and a
real phone-sized preview visible side by side. Selecting an option must
immediately update both previews; static swatches, disconnected mock-ups and
unchanged reference previews are insufficient. Include relevant light/dark,
loading, empty, error, pending, conflict and recovery controls when they affect
the choice. Show consequences for dense data, money, schedules, scanners,
keyboard use, touch/mobile use, accessibility and cross-module reuse where
applicable.

After the human answers a batch, record all answers together, update the live
page once, verify every option control changes both previews, and present
another batch only when meaningful unresolved choices remain. Record accepted
defaults, selected options, rejected alternatives, rationale, accessibility
rules and implementation consequences in
`src/public/ExSol-UIUX-Guidelines.html`. Keep the live page current and avoid
terminal-only status stops between decision batches.

A human request for single-question, highly granular exploration overrides
batching for that module or decision. Otherwise, older tailored prompts that
require exactly one A/B/C decision per turn are superseded by this batched
policy.

Do not use browser-default controls as the proposed finished design. Use the
shared component language and semantic theme tokens, with accessible names,
visible focus, correct loading/disabled behaviour and responsive targets. Do
not implement application UI/CSS until the relevant decisions are approved;
after implementation, verify in the real browser as well as the required tests.

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
