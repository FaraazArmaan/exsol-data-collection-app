# Contributing to ExSol

Read `CLAUDE.md` first — it is the compact law (10 iron rules, each bought with a prod failure).
This file covers the conventions you need to navigate and extend the repo. Detailed rules live in
`.claude/rules/`; generated inventories in `docs/reference/` (`npm run docs:reference`).

## Definition of done

`npm run typecheck` AND the FULL `npm test` suite, both green. Plus a real-browser check for
anything with a UI — jsdom cannot catch dark-theme CSS violations or Netlify routing mistakes.

## Repo layout

- `src/modules/<key>/` — one folder per module; canonical shape in
  `.claude/rules/module-pattern.md` (manifest + product entry + `_<key>-authz.ts` +
  RouteMount + `shared/{types,api,permissions}.ts` + namespaced CSS).
- `src/modules/registry/` — the source of truth: ModuleManifests (including nav via
  `hasDedicatedNav`/`navLinks`), ProductManifests, permission-key derivation.
- `netlify/functions/` — FLAT `.ts` files only; `_*` files are shared helpers, not functions.
- `db/migrations/` — forward-only numbered SQL.
- `docs/reference/` — GENERATED endpoint/permission/schema inventories + the hand-written
  CONFORMANCE.md debt ledger.

## Endpoint prefix conventions (documented AS-IS — do not rename, prod URLs are live)

| prefix | audience | auth |
|---|---|---|
| `admin-*`, `client-*`, `clients*`, `user-node*`, `onboard-*` | AMS admin console | `requireAdmin` |
| `auth-*`, `login`, `forgot-password` | admin session | public/session |
| `u-*` | workspace users (user portal) | `requireBucketUser` / `authenticateForPermission` |
| `pub-*`, `booking-public-*` | unauthenticated public/storefront | product-enable gate + rate limit |
| `<module>-*` | module endpoints | `require<Module>` from `_<module>-authz.ts` |

Routing gotchas (iron rule 5): the FILE NAME is the route; `config.path` overrides; two functions
sharing a path both need `config.method`. See `.claude/rules/api-conventions.md`.

## CSS namespacing (iron rule 9)

One class prefix per module (`.inv-*`, `.mfg-*`, `.wf-*`, `.pos-*`…), consuming ONLY the
dark-theme tokens from `src/lib/theme.css`. Never invent custom properties, never hardcode light
values — tests stay green while the UI ships white-on-white. Verify in a real browser.

## Migration allocation protocol (iron rule 1)

1. Ask the human coordinator for your migration number (parallel worktrees have collided before).
2. One SQL statement per line; comments on their own line, never after a `;`.
3. `npm run migrate` applies ALL pending migrations at the env's `DATABASE_URL`; dev and prod are
   separate Neon branches. Additive: migrate prod BEFORE promoting code. Destructive: deploy code
   first, THEN migrate. Details: `.claude/rules/migrations.md`.

## Permissions (iron rule 3)

Keys are `<module>.<bucket>.<verb>` over the manifest's declared buckets — the validator and the
Access Levels UI render nothing else. POS's `pos.<action>` keys are frozen legacy. L1 Owners
bypass the matrix everywhere (iron rule 2): enable-gate first, then Owner bypass, in the authz
file AND the RouteMount AND any UI gate.

## Git workflow

- Work in your own worktree on a `feat/<topic>-iso` branch; run `git branch --show-current`
  before your first commit (iron rule 8).
- Small commits, one theme per commit.
- NEVER `git push` (iron rule 7 — enforced by a PreToolUse hook in `.claude/settings.json`);
  the human pushes via the Main integration chat. No PRs — Netlify deploy previews burn credits.
- If your change touches endpoints, manifests, or migrations, rerun `npm run docs:reference`
  and commit the regenerated docs.
