# API conventions (Netlify Functions v2)

Full generated endpoint inventory: `docs/reference/endpoints.md` (`npm run docs:reference`).

## Routing — the file NAME is the route

- `netlify/functions/` holds FLAT `.ts` files only. A subfolder becomes ONE function
  (`folder/folder.ts`); sibling files inside become silent helpers that deploy nowhere.
- Without `config.path`, the function is reachable at `/api/<filename>` via the netlify.toml
  redirect. `/api/foo/:id` routes to `foo.ts` BY NAME — a `foo-detail.ts` needs its own
  `/api/foo-detail/:id` style path or an explicit `config.path` (iron rule 5). Integration tests
  call handlers directly and DO NOT catch routing mistakes.
- Two functions may share a `config.path` ONLY if both set `config.method` — otherwise one
  silently 405s in prod while tests stay green.
- Don't put literal sub-paths under `:param` routes; they collide.

## Endpoint name prefixes (documented AS-IS — renaming is a prod-breaking change)

| prefix | meaning | auth |
|---|---|---|
| `admin-*`, `clients*`, `client-*`, `user-node*`, `onboard-*`, `audit-log`, `workspace-export` | AMS console | `requireAdmin` (some also accept bucket-user) |
| `auth-*`, `login`, `forgot-password` | admin session lifecycle | public/session |
| `u-*` | user-portal (workspace user) | `requireBucketUser` / `authenticateForPermission` |
| `pub-*`, `booking-public-*` | unauthenticated storefront/public | none; product-enable gate inline; rate-limited |
| `<module>-*` (e.g. `finance-*`, `crm-*`) | module endpoints | `require<Module>` from `_<module>-authz.ts` |
| `_*` | NOT functions — shared helpers/authz, skipped by the bundler | — |

## Auth building blocks (`_shared/`)

- `requireAdmin(req)` / `requireBucketUser(req)` / `authenticateForPermission(req, key)` in
  `_shared/permissions.ts` (throws `UnauthorizedError`/`ForbiddenError`).
- Module authz: `_<module>-authz.ts` — enable-gate then L1 bypass; see
  `.claude/rules/module-pattern.md`.
- Registry imports use the `@registry/*` alias (tsconfig paths; esbuild resolves it when bundling).

## Hard-won runtime facts

- **Functions don't share memory.** Never coordinate via module-level state; use JWT, Blobs, or
  Postgres.
- **Neon serialization:** BIGINT comes back as a string (`Number()` it); DATE shifts a day through
  local-midnight → use `to_char(col, 'YYYY-MM-DD')` in the SELECT.
- **Email:** `sendMail` is template-locked (2 templates + an `email_outbox` CHECK). Arbitrary email
  goes through low-level `deliver()` in `_shared/resend.ts` (dev fallback logs without
  RESEND_API_KEY).
- **Native modules** (`sharp`, `@node-rs/argon2`) must be in `external_node_modules` in
  netlify.toml. jimp has no WebP encoder — use sharp.
- **Error precedence:** when two 4xx codes can both apply, match the UI tooltip precedence and test
  the collision case explicitly.
- New functions can deploy successfully yet fail to register at the Edge (404) —
  `netlify api restoreSiteDeploy` fixes it; always probe a new endpoint after deploy.
