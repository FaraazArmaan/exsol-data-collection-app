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
- Module authz: `_<module>-authz.ts` — thin wrapper over `_shared/module-authz.ts`
  (`makeModuleAuthz`), which owns the enable-gate → L1-bypass order; see
  `.claude/rules/module-pattern.md`. Wire behavior pinned by
  `tests/integration/module-authz-characterization.test.ts`.
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

## Signed webhook receivers

Inbound third-party webhooks (payment providers, calendar syncs, external systems) are
authenticated by an HMAC signature over the request body, not by a session. The pattern —
reference impl `netlify/functions/webhook-example.ts`, helper `_shared/webhook.ts`, original
`_booking-razorpay.ts`:

1. **Read the RAW body** (`await req.text()`). Verification is over the exact bytes — NEVER
   `req.json()` first (re-serialising reorders keys / changes whitespace and breaks the MAC).
2. **Verify in constant time**: `verifyHmacSignature(rawBody, header, secret)` from
   `_shared/webhook.ts` (`createHmac` + `timingSafeEqual`; returns false, never throws). Options:
   `{ algorithm = 'sha256', encoding = 'hex' | 'base64' }` per the provider's scheme.
3. **`401` on missing/invalid signature; parse + act only after it passes.** Missing secret →
   `500 <name>_not_configured` (mirror the Razorpay guard).

The shared secret is a `process.env.<NAME>_SECRET` (like `RAZORPAY_WEBHOOK_SECRET`), never in the
zod env schema — absent in dev is fine, the receiver just 500s until configured. Integration tests
sign a body with the same secret and call the handler directly (no live provider needed).
