# ExSol — project conventions for Claude Code sessions

This file is the compact law. The detail lives in `.claude/rules/` ({module-pattern,
api-conventions, testing, migrations}.md), the generated `docs/reference/` (endpoints,
permissions, schema — regenerate with `npm run docs:reference`; CONFORMANCE.md tracks pattern
debt), and CONTRIBUTING.md. Slash commands: /new-module, /handoff, /hostile-review.
Iron rule 7 is ENFORCED: a PreToolUse hook blocks `git push` unless the human explicitly
asked the agent to push.

## Commands
- Done = `npm run typecheck` AND the FULL vitest suite, both green. No exceptions.
- `npm run migrate` applies ALL pending migrations (dev/prod Neon branches are separate DBs).

## Code economy and isolation
- Think before coding. If a clear solution takes 10-20 lines, do not write 30-50. Prefer the
  smallest readable, tested change that fits the existing pattern.
- Keep changes isolated to the owning file/module/helper. Manual edits must not create wide
  coupling where one local mistake can crash an unrelated section, module, or public surface.

## Architecture
- React 18 + Vite SPA in src/ (modules under src/modules/), Netlify Functions v2 in
  netlify/functions/ (FLAT .ts files only — a subfolder becomes ONE function), Neon Postgres,
  forward-only numbered migrations in db/migrations/. Full map: docs/architecture.html.
- New module = registry ModuleManifest + ProductManifest in products-list/ + migration +
  `_<module>-authz.ts` + RouteMount + Sidebar entry. Mirror the Booking / Product Manager
  pattern; namespaced CSS (`.pm-*` style).

## Iron rules (each one has already caused a prod failure)
1. Migration numbers are allocated by the human coordinator — NEVER pick your own. One SQL
   statement per line; comments on their own line, never after a `;`.
2. Module authz = enable-gate THEN `level_number === 1` Owner bypass — in the authz file AND
   Sidebar AND RouteMount. Strict matrix-only checks blank out the Owner's UI.
3. Permission keys are bucket×verb (`<module>.<bucket>.<verb>`) ONLY. Never add new
   action-namespaced keys (POS's are legacy).
4. A ModuleManifest without a ProductManifest entry is invisible — keys won't validate, nav
   won't render.
5. `/api/foo/:id` routes to `foo.ts` by NAME. Two functions sharing config.path MUST both set
   config.method.
6. Tests share one persistent dev DB (no teardown): randomize unique-constrained literals;
   mock `getStore()` in EVERY test file whose handler touches Blobs.
7. Never `git push` from an agent session unless the human explicitly asked the agent to push.
8. Run `git branch --show-current` before your first commit — confirm you're in your own
   feat/<module>-iso worktree.
9. Module CSS MUST consume the dark-theme tokens from `src/lib/theme.css`
   (`--bg-base/-surface/-elevated`, `--text-primary/-secondary/-muted`, `--border-subtle/-default`,
   `--accent` + `--text-on-accent`, `--danger`/`--success`). NEVER invent your own (`--color-*`,
   `--sc-*`, `--border`, `--muted-bg`) or hardcode light values (`#fff`, `#e5e7eb`, `#f3f4f6`) —
   they fall back to a light theme = white cards + invisible text on the dark platform. jsdom
   doesn't evaluate CSS vars, so tests stay green; verify in a REAL browser. (Shipped broken 5×.)
10. Set `hasDedicatedNav: true` (+ `navLinks` for the sidebar link) in the module's registry
    manifest — the registry now drives BOTH Sidebar.tsx and the generic `/m/:key` rail
    (useNavItems.ts); the old hand-synced MODULES_WITH_DEDICATED_NAV set is gone. Miss the flag
    and the module renders a DUPLICATE nav link (or a dead ModuleStub for surface-less modules
    like catalog/data-collection). Set it even if the module has no dashboard page. (Recurred 5×
    under the old hand-synced-set design.)
