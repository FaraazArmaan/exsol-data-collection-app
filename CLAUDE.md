# ExSol — project conventions for Claude Code sessions

## Commands
- Done = `npm run typecheck` AND the FULL vitest suite, both green. No exceptions.
- `npm run migrate` applies ALL pending migrations (dev/prod Neon branches are separate DBs).

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
7. NEVER `git push` — commit locally; the human pushes via the Main integration chat.
8. Run `git branch --show-current` before your first commit — confirm you're in your own
   feat/<module>-iso worktree.
