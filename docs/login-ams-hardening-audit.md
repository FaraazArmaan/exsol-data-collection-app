# Login + AMS Hardening Audit

Status: M9 verified, handoff-ready
Branch: `feat/login-ams-hardening-iso`
Worktree: `worktrees/ExSol-Login-AMS-Hardening-WT`
Date: 2026-07-09

## Scope

This is a read-only baseline audit for the Login + AMS industry-standard hardening roadmap.
No runtime behavior is changed in M1. The goal is to identify the owned surfaces, current
strengths, gaps, test coverage, and safest milestone order before touching auth code.

Reviewed surfaces:

- Login/session endpoints: `auth-*`, `login`, `forgot-password`, `u-*`.
- Session and auth helpers: `_shared/session.ts`, `_shared/permissions.ts`,
  `_shared/rate-limit.ts`, `_shared/argon.ts`, `_shared/google-verifier.ts`.
- AMS endpoints: `admin-*`, `clients*`, `client-*`, `user-node*`, `user-nodes*`,
  `audit-log`, `workspace-export`, `onboard-*`.
- Frontend shells: `src/lib/auth-context.tsx`, `src/modules/login/`,
  `src/modules/ams/`, `src/modules/user-portal/`, `src/lib/router.tsx`.
- Coverage: auth, user-node auth/CRUD, permissions, impersonation, admin team,
  workspace export, access-level UI/nav tests.

## Current Architecture

### Authentication realms

| Realm | Cookie | TTL | Primary files | Authority source |
|---|---:|---:|---|---|
| Admin | `session` | 15 min | `_shared/session.ts`, `auth-login.ts`, `auth-google.ts`, `auth-me.ts` | `admins` row loaded by `requireAdmin()` |
| Workspace user | `bu_session` | 24 h | `_shared/session.ts`, `u-login.ts`, `u-me.ts`, `login.ts` | `user_node_credentials`, `user_nodes`, `client_levels` |
| Guest/public | none | n/a | booking/public, storefront, onboarding token endpoints | possession tokens and endpoint-local gates |

The split is sound. Admin and bucket-user tokens share the signing secret but bucket-user tokens
must carry `kind: 'bucket_user'` and `client_id`, so an admin token cannot authenticate as a
workspace token through `u-me`.

### AMS ownership model

AMS is both an admin console and the platform control plane for workspace identity:

- `admins`: platform operators.
- `clients`: workspaces/tenants.
- `client_roles`, `client_levels`, `client_cardinality_rules`: workspace structure.
- `user_nodes`: canonical people tree and authorization identity.
- `user_node_credentials`: workspace login credentials.
- `client_enabled_products`: product/module enablement.
- `audit_log`: append-only operational history.

This makes Login+AMS the highest-blast-radius surface in the repo. Milestones must stay small,
well-tested, and handoff-oriented.

## Endpoint Inventory

### Login/admin session

| Function | Path | Auth today | Notes |
|---|---|---|---|
| `auth-config.ts` | `/api/auth-config` | public | Exposes Google OAuth client id. |
| `auth-login.ts` | `/api/auth-login` | public | Admin password login, rate-limited, dummy hash timing protection, MFA challenge for enrolled admins. |
| `auth-google.ts` | `/api/auth-google` | public | Admin Google login, strict binding, no auto-provisioning, MFA challenge for enrolled admins. |
| `auth-mfa-enroll.ts` | `/api/auth-mfa-enroll` | admin | Starts admin TOTP enrollment; returns setup secret/URI. |
| `auth-mfa-confirm.ts` | `/api/auth-mfa-confirm` | admin | Confirms TOTP enrollment and returns one-time recovery codes. |
| `auth-mfa-challenge.ts` | `/api/auth-mfa-challenge` | public | Completes enrolled-admin MFA challenge before full session minting. |
| `auth-mfa-disable.ts` | `/api/auth-mfa-disable` | admin | Disables MFA after TOTP or recovery-code verification and writes audit row. |
| `auth-mfa-status.ts` | `/api/auth-mfa-status` | admin | Reports admin MFA enabled state and recovery-code count. |
| `auth-me.ts` | `/api/auth-me` | admin | Refreshes admin JWT near expiry. |
| `auth-logout.ts` | `/api/auth-logout` | public | Revokes current admin session row and clears cookie. |
| `auth-logout-all.ts` | `/api/auth-logout-all` | admin | Revokes all active admin sessions for the current admin. |
| `login.ts` | `/api/login` | public | Unified admin/workspace login with admin precedence, MFA challenge for enrolled admins, and workspace choice flow. |
| `forgot-password.ts` | `/api/forgot-password` | public | Admin-mediated workspace reset request; no self-serve token flow. |

### Login/workspace session

| Function | Path | Auth today | Notes |
|---|---|---|---|
| `u-client-by-slug.ts` | `/api/u-client-by-slug` | public | Client lookup for workspace login. |
| `u-login.ts` | `/api/u-login` | public | Workspace password login scoped by client slug. |
| `u-me.ts` | `/api/u-me` | bucket-user | Returns identity, permissions, enabled modules; refreshes cookie. |
| `u-logout.ts` | `/api/u-logout` | public | Revokes current workspace session row and clears cookie. |
| `u-logout-all.ts` | `/api/u-logout-all` | bucket-user | Revokes all active workspace sessions for the current user/client. |
| `u-change-password.ts` | `/api/u-change-password` | bucket-user | Clears `must_change_password` and plaintext temp password fields. |
| `u-link-google.ts` | `/api/u-link-google` | bucket-user | First-bind Google identity; email must match credential. |
| `u-unlink-google.ts` | `/api/u-unlink-google` | bucket-user | Refuses unlink if Google is the only credential. |

### AMS/admin console

| Function group | Auth today | Notes |
|---|---|---|
| `admin-team*`, `admin-self` | admin | Admin creation/deletion/self profile. No platform-admin RBAC yet. |
| `clients*`, `onboard-client*` | admin | Workspace lifecycle and onboarding. |
| `admin-client-products` | admin | Product enablement and module visibility. |
| `client-levels*`, `client-roles*`, `client-cardinality` | admin | Workspace structure and permission matrix. |
| `audit-log`, `client-audit` UI | admin | Read operational history. |
| `admin-impersonate` | admin | Mints Owner `bu_session`; initial impersonation is audited. |

### AMS/workspace user management

| Function group | Auth today | Notes |
|---|---|---|
| `user-nodes*` | bucket-user or admin-through-permission helper | Uses `_platform.users.*`; supports L1 owner bypass and L2 subtree scope. |
| `user-node-credential` | bucket-user or admin-through-permission helper | Password reset/reveal/delete for workspace credentials. |
| `client-structure` | bucket-user or admin-through-permission helper | Reads roles/levels/cardinality for team UI. |
| `client-settings-*` | bucket-user or admin-through-permission helper | Workspace brand/settings updates. |
| `workspace-export` | bucket-user or admin-through-permission helper | High-risk export path; has redaction tests. |

## Strengths To Preserve

1. **Argon2 and timing equalization.** Password verify paths use a dummy hash when no credential
   exists, reducing account-enumeration timing leaks.
2. **Strict Google binding.** Google sign-in does not auto-provision and first-binds without
   silently replacing an existing Google subject.
3. **DB-backed authority.** JWTs name a user; permissions, levels, and client scope are loaded
   from the database on protected calls.
4. **Realm separation.** Admin cookies cannot authenticate `u-me`, and bucket-user cookies cannot
   authenticate `auth-me`.
5. **Impersonation session priority is fixed on current main.** Valid `bu_session` wins when both
   cookies exist, preventing admin fallback during workspace impersonation.
6. **Subtree scoping exists.** L2+ workspace users cannot inspect or mutate sibling branches in
   core user-node operations.
7. **Reference docs exist.** Endpoint, permission, and schema inventories give a clear review
   baseline.
8. **Tests are broad.** Auth, user-node CRUD, permission middleware, impersonation, workspace export,
   and access-level matrix tests already cover many high-risk paths.

## Gaps Against Industry Standard

| Priority | Gap | Why it matters | Suggested milestone |
|---|---|---|---|
| P0 | No server-side session revocation | Logout only clears cookies; stolen JWTs remain valid until expiry. | M3 |
| P0 | No MFA/WebAuthn | Platform admin access is single-factor. | M4 |
| P0 | Plaintext temporary passwords | `temp_password_plain` is stored until reveal/change; this is below SaaS credential-handling norms. | M6 |
| P0 | Impersonation attribution is incomplete | Downstream writes during impersonation attribute to Owner session unless additional context is carried. | M5 |
| P1 | No CSRF/origin guard on cookie-authenticated mutations | `SameSite=Lax` helps but should not be the only control for high-risk POST/PATCH/DELETE. | M2 |
| P1 | No security headers block | No CSP, HSTS, frame policy, or permissions policy in `netlify.toml`. | M2 |
| P1 | Platform admin has no least-privilege roles | Any admin can perform broad platform operations. | M7 |
| P1 | Account disabled/locked lifecycle is missing | No first-class disable, lockout, password-changed-at, or revoke-on-disable behavior. | M8 |
| P2 | Unified login verifies at most five matching workspace credentials | Same email across more than five clients can produce incomplete discovery unless client is supplied. | M8 or follow-up |
| P2 | CSP rollout may break Google/sign-in/assets | Needs report-only/browser pass before enforcement. | M2 |

## Test Coverage Map

Existing high-value tests:

- `tests/integration/auth.test.ts`
  - Admin login/me/logout, wrong-password/nonexistent-email, timing oracle check, email/IP rate
    limit, tampered cookie, Google strict binding.
- `tests/integration/user-node-auth.test.ts`
  - Workspace login, reset request, temp password reveal semantics, realm separation, unified
    login, Google workspace login, `u-me` permissions/enabled modules, credential subtree scope.
- `tests/integration/permissions-middleware.test.ts`
  - Matrix check, L1 bypass, admin bypass, no-session behavior.
- `tests/integration/user-nodes-crud.test.ts`
  - User tree CRUD, cardinality, concurrent cap behavior, cross-client denial, L2 subtree scope,
    L1 owner widening.
- `tests/integration/client-levels-permissions.test.ts`
  - Permission matrix derivation, validation, POS action keys, L1 immutability.
- `tests/integration/admin-team.test.ts`
  - Admin team CRUD, bootstrap/self delete protections, admin-self validation.
- `tests/integration/admin-impersonate.test.ts`
  - Admin-only impersonation, Owner token minting, initial audit row.
- `tests/integration/impersonation-session-priority.test.ts`
  - Both-cookie precedence and stale-bucket fallthrough.
- `tests/integration/workspace-export.test.ts`
  - Export auth gates, redaction, cross-tenant safety, audit row, bucket-user boundary.
- UI tests:
  - `src/modules/ams/components/PermissionMatrixCard.test.tsx`
  - `src/modules/user-portal/nav/useNavItems.test.ts`
  - `src/modules/user-portal/layout/Sidebar.test.tsx`
  - `src/modules/user-portal/layout/storefront-nav.test.tsx`

Coverage gaps to fill before behavior changes:

- CSRF/origin rejection tests for representative mutating endpoints.
- Session revocation tests at both helper and endpoint levels.
- Impersonated downstream write audit tests, not only `admin.impersonate`.
- Invite/reset token lifecycle tests.
- Admin RBAC denial tests for each sensitive operation group.

## Recommended Implementation Order

Keep the roadmap order:

1. M2 security headers + CSRF/origin guard. This is low schema risk and improves every later step.
2. M3 server-side session revocation. This creates the substrate for disable, logout-all, and
   impersonation timeout.
3. M4 admin MFA. Build admin first; workspace MFA can be optional after admin is stable.
4. M5 impersonation attribution. Depends naturally on session metadata/revocation.
5. M6 invite/reset tokens. Removes plaintext temp password debt.
6. M7 admin RBAC. Large AMS behavior change, should come after auth/session primitives are strong.
7. M8 account lifecycle. Uses revocation and admin RBAC.
8. M9 final UX/docs/browser pass.

## M2 Design Notes

Security headers should start conservative and testable:

- Add `[[headers]]` in `netlify.toml` for all paths.
- Include HSTS only for production-safe hosts if local/dev behavior is not affected.
- CSP needs specific allowances for Google Sign-In, app assets, blobs/data images where used, and
  Netlify/Vite dev differences. Consider `Content-Security-Policy-Report-Only` during browser
  tuning if needed.

CSRF/origin guard should be small and reusable:

- Implement a tiny `_shared/csrf.ts` helper.
- Guard only unsafe methods: `POST`, `PUT`, `PATCH`, `DELETE`.
- Allow no-origin same-site tool/test calls only when explicitly needed by tests, not broadly in
  production behavior.
- Apply first to highest-risk AMS/session mutation endpoints, then expand by group.

## M3 Design Notes

Session revocation should not overcomplicate the JWT shape:

- Add a generated session id / `jti`.
- Store hash or id, realm, subject id, client id when relevant, created_at, expires_at, revoked_at,
  user agent/ip metadata if available.
- `requireAdmin` and `requireBucketUser` should verify JWT first, then active session row.
- Logout should revoke the current row and clear the cookie.
- `sign out all` should revoke by subject/realm/client as appropriate.

## M4 Verification

M4 adds admin-first TOTP MFA without locking out non-enrolled admins during rollout. Enrolled
admins must complete a second factor before an admin session cookie is minted.

Implemented:

- `db/migrations/139_login_ams_mfa.sql` with `admin_mfa` and short-lived
  `admin_mfa_challenges`.
- Compact TOTP/recovery-code helper in `netlify/functions/_shared/mfa.ts`.
- New MFA endpoints for status, enrollment, confirmation, challenge completion, and disable.
- Admin password, admin Google, and unified login paths now return an MFA challenge instead of a
  session cookie when the admin has MFA enabled.
- Login UI MFA challenge screen with authenticator-code and recovery-code modes.
- AMS Settings MFA panel for setup, confirmation, recovery-code display, status, and disable.
- Reference docs regenerated for the new endpoints and schema tables.

Verification:

- `npm run migrate`: applied `139_login_ams_mfa`.
- `npm run typecheck`: green.
- `npm test -- tests/integration/auth.test.ts`: green, 1 file passed, 13 tests passed.
- Adjacent auth/session subset
  `npm test -- tests/integration/user-node-auth.test.ts tests/integration/permissions-middleware.test.ts tests/integration/admin-impersonate.test.ts tests/integration/impersonation-session-priority.test.ts`:
  green, 4 files passed, 64 tests passed.
- `npm run docs:reference`: regenerated `docs/reference/{endpoints,permissions,schema}.md`.
- Full suite final run: `npm test` green, 324 files passed, 1940 tests passed.

## M5 Verification

M5 makes impersonation attributable past the initial "start impersonating" audit row.

Implemented:

- `db/migrations/140_login_ams_impersonation_audit.sql` with impersonation metadata on
  `auth_sessions` and `audit_log`.
- `admin-impersonate` now requires a reason, writes impersonation session metadata, and issues
  one-hour bucket-user cookies.
- Bucket-user session refresh preserves impersonation claims.
- `logAudit()` records `impersonated_by_admin` automatically for impersonated bucket-user sessions.
- Audit log filters/responses expose the impersonating admin.

Verification:

- `npm run migrate`: applied `140_login_ams_impersonation_audit`.
- `npm run typecheck`: green.
- `npm test -- tests/integration/admin-impersonate.test.ts tests/integration/impersonation-session-priority.test.ts tests/integration/audit-log.test.ts`:
  green, 3 files passed, 23 tests passed.

## M6 Verification

M6 replaces new plaintext temporary-password issuance with expiring set-password links while
leaving legacy temp-password fields intact for compatibility.

Implemented:

- `db/migrations/141_login_ams_invite_reset_tokens.sql` with hashed, single-use credential tokens.
- `_shared/credential-tokens.ts` and public `u-credential-token.ts` validation/consume endpoint.
- Public `/set-password/:token` route and page.
- AMS/admin and owner-scoped team modal flows now issue copyable links instead of generated temp
  passwords.
- Token consumption sets the password, clears reset state, and updates `password_changed_at`.

Verification:

- `npm run migrate`: applied `141_login_ams_invite_reset_tokens`.
- `npm run typecheck`: green.
- `npm test -- tests/integration/user-node-auth.test.ts`: green, 45 tests passed at the M6 point.

## M7 Verification

M7 adds platform-admin least privilege for high-blast-radius AMS operations.

Implemented:

- `db/migrations/142_login_ams_admin_rbac.sql` with `admins.role`.
- Admin roles/capabilities in `_shared/permissions.ts`.
- Gates for admin management, impersonation, workspace export, client delete, product enablement,
  and permission/structure edits.
- New admins created through the API default to Support.

Verification:

- `npm run migrate`: applied `142_login_ams_admin_rbac`.
- `npm run typecheck`: green.
- `npm test -- tests/integration/admin-team.test.ts`: green, 12 tests passed.
- RBAC subset
  `npm test -- tests/integration/admin-client-products.test.ts tests/integration/client-levels-permissions.test.ts tests/integration/admin-impersonate.test.ts tests/integration/workspace-export.test.ts tests/integration/clients-lifecycle.test.ts`:
  green, 5 files passed, 40 tests passed.

## M8 Verification

M8 adds first-class disabled/locked/password lifecycle metadata for platform admins and workspace
credentials.

Implemented:

- `db/migrations/143_login_ams_account_lifecycle.sql` with disabled/locked/password lifecycle
  columns and disabled-account indexes.
- `requireAdmin()` and `requireBucketUser()` reject disabled or currently locked accounts.
- Password and Google login paths return generic unauthorized responses for disabled/locked
  accounts and stamp failed-login metadata.
- Admin disable/enable revokes active admin sessions and protects bootstrap/self-disable.
- Workspace credential disable/enable revokes active bucket-user sessions and audits the change.
- Password changes and token consumes update `password_changed_at`.

Verification:

- `npm run migrate`: applied `143_login_ams_account_lifecycle`.
- `npm run typecheck`: green.
- `npm test -- tests/integration/admin-team.test.ts tests/integration/auth.test.ts tests/integration/user-node-auth.test.ts`:
  green, 3 files passed, 72 tests passed.
- `npm test -- tests/integration/user-node-auth.test.ts`: rerun after semantic cleanup, green,
  46 tests passed.

## M9 Verification

M9 adds the final least-privilege UX and documentation pass.

Implemented:

- Permission matrix warning labels for high-risk grants such as user delete, settings edit,
  workspace export/file read, all-sales visibility, and refund.
- Existing Level 1 Owner full-access banner remains read-only and explicit.
- `docs/reference/{endpoints,schema}.md` regenerated after M5-M8 endpoint/schema changes.

Verification:

- `npm run typecheck`: green.
- `npm test -- src/modules/ams/components/PermissionMatrixCard.test.tsx`: green, 3 tests passed.
- Local HTTP smoke with `npm run dev -- --port 8899`: `/login` and `/api/auth-config` returned
  200 with the security header block present.
- In-app browser smoke could not run because the browser plugin reported no available browser
  backends for this session (`agent.browsers.list()` returned `[]`).
- Full suite final run: `npm test` green, 324 files passed, 1947 tests passed.

## M3 Verification

M3 adds server-side revocation for admin and workspace-user sessions. JWTs remain the browser
transport, but each token now carries a `jti` and realm metadata, and every protected request must
match an active `auth_sessions` row.

Implemented:

- `db/migrations/138_login_ams_sessions.sql` with shared `auth_sessions` rows for admin and
  bucket-user realms.
- Session row creation from `mintSession()` and `mintBucketUserSession()`, with IP/user-agent
  metadata when login handlers have it.
- Active session checks in `requireAdmin()`, `requireBucketUser()`, and the bucket-user branch of
  `requirePermission()`.
- Current-session revocation in `auth-logout.ts` and `u-logout.ts`.
- New `auth-logout-all.ts` and `u-logout-all.ts` endpoints for subject-scoped revocation.
- Reference docs regenerated for the new endpoints and schema table.

Verification:

- `npm run migrate`: applied `138_login_ams_sessions`.
- `npm run typecheck`: green.
- `npm test -- tests/unit/session.test.ts tests/integration/auth.test.ts tests/integration/user-node-auth.test.ts`:
  3 files passed, 58 tests passed.
- `npm test -- tests/integration/permissions-middleware.test.ts tests/integration/admin-impersonate.test.ts tests/integration/impersonation-session-priority.test.ts tests/integration/module-authz-characterization.test.ts`:
  first run hit two transient Neon `fetch failed` errors; escalated rerun passed, 4 files and 52
  tests.
- `npm run docs:reference`: regenerated `docs/reference/{endpoints,permissions,schema}.md`.
- Full suite final run: `npm test` green, 324 files passed, 1939 tests passed.

## M2 Verification

M2 adds Netlify-wide security headers and a scoped same-origin guard for Login+AMS unsafe
methods. The guard is intentionally wired into owned handlers instead of the shared permission
middleware so Product/File/module endpoints do not receive an unreviewed behavior change.

Implemented:

- `netlify.toml` `[[headers]]` block for CSP, HSTS, frame-ancestors, nosniff,
  referrer policy, and permissions policy.
- `netlify/functions/_shared/csrf.ts` with unsafe-method origin checks.
- Guard wiring for Login/session mutation endpoints, AMS admin/team/client structure endpoints,
  client settings, user-node/team mutation endpoints, credential reset/delete, impersonation,
  onboarding, and onboarding-link generation.
- Unit coverage for same-origin, cross-origin, forwarded host/proto, and production-style missing
  Origin behavior.
- Header coverage for the Netlify security header block and Google Sign-In CSP allowance.
- Integration coverage proving `auth-login` rejects a cross-site POST with
  `csrf_origin_mismatch`.

Verification:

- `npm run typecheck`: green.
- `npm test -- tests/unit/csrf.test.ts tests/unit/netlify-security-headers.test.ts tests/integration/auth.test.ts`:
  3 files passed, 18 tests passed.
- Broader AMS/auth subset: 17 files, 182 tests; first run had one transient
  `user-nodes-crud` timeout, and rerunning that file passed 33/33.
- Full suite final run: `npm test` green, 324 files passed, 1936 tests passed.
- Test isolation note: `tests/integration/u-products-image-thumb.test.ts` now seeds the cached
  thumbnail directly in the delete-cleanup test, so full-suite verification no longer depends on
  an unrelated `sharp` resize/cache-warm path.

## M5 Design Notes

Impersonation should become explicit session state:

- `admin-impersonate` should write impersonation metadata into the session row or token claims.
- `logAudit()` should be able to record both `actor_user_node` and `impersonated_by_admin`.
- UI banner should remain visible for the entire impersonated session.
- Exiting impersonation should revoke the impersonated session.

## M6 Design Notes

Replace plaintext temp passwords without a risky destructive migration:

- Add new token table first.
- Start new flows using tokens.
- Leave old `temp_password_plain` columns in place temporarily for backwards compatibility.
- Stop writing plaintext in new reset/invite paths.
- Drop old columns only in a later cleanup migration after no code reads them.

## Files Most Likely To Change

M2:

- `netlify.toml`
- `netlify/functions/_shared/csrf.ts`
- Mutating AMS/login endpoint files.
- New CSRF/origin tests.

M3:

- `db/migrations/138_login_ams_sessions.sql`
- `netlify/functions/_shared/session.ts`
- `netlify/functions/_shared/permissions.ts`
- `auth-logout.ts`, `u-logout.ts`, `auth-logout-all.ts`, `u-logout-all.ts`, `auth-me.ts`, `u-me.ts`
- Session tests.

M4:

- `db/migrations/139_login_ams_mfa.sql`
- `netlify/functions/_shared/mfa.ts`
- `netlify/functions/auth-login.ts`, `auth-google.ts`, `login.ts`
- New `auth-mfa-*` endpoints.
- Admin settings UI.

M5:

- `admin-impersonate.ts`
- `_shared/session.ts`
- `_shared/audit.ts`
- `audit-log.ts` and audit UI components.
- One representative module write test under impersonation.

M6:

- `user-node-credential.ts`
- `forgot-password.ts`
- `u-change-password.ts`
- Login/manage modal components.
- New public reset/invite route.

M7/M8:

- `admins` schema and admin endpoints.
- `requireAdmin` helper.
- AMS sidebar/pages and action buttons.
- Admin team tests.

## Open Questions For Human Coordinator

1. Whether platform support admins should be allowed to impersonate by default.
2. Whether invite/reset emails are in scope now or token-link generation remains copy/manual.
3. When to move from enrolled-admin MFA enforcement to org-wide admin MFA requirement.
4. Whether WebAuthn should be added later as a stronger second-factor option.

## M1 Verification

Commands run before handoff:

```sh
npm run typecheck
npm test -- tests/integration/auth.test.ts tests/integration/user-node-auth.test.ts tests/integration/permissions-middleware.test.ts tests/integration/admin-impersonate.test.ts tests/integration/impersonation-session-priority.test.ts
npm test
```

Results:

- `npm run typecheck`: green.
- Targeted auth/AMS suite: 5 files passed, 72 tests passed.
- Full vitest suite: 322 files passed, 1928 tests passed.
- First targeted run failed because the new worktree had no local `.env`; copied the root `.env`
  into this worktree as an ignored local file.
- Second targeted run failed under sandboxed network because Neon was unreachable; reran the exact
  command with approved network escalation and it passed.
