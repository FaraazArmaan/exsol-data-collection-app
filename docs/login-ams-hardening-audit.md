# Login + AMS Hardening Audit

Status: M1 verified, handoff-ready
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
| `auth-login.ts` | `/api/auth-login` | public | Admin password login, rate-limited, dummy hash timing protection. |
| `auth-google.ts` | `/api/auth-google` | public | Admin Google login, strict binding, no auto-provisioning. |
| `auth-me.ts` | `/api/auth-me` | admin | Refreshes admin JWT near expiry. |
| `auth-logout.ts` | `/api/auth-logout` | public | Clears cookie only; no server revocation. |
| `login.ts` | `/api/login` | public | Unified admin/workspace login with admin precedence and workspace choice flow. |
| `forgot-password.ts` | `/api/forgot-password` | public | Admin-mediated workspace reset request; no self-serve token flow. |

### Login/workspace session

| Function | Path | Auth today | Notes |
|---|---|---|---|
| `u-client-by-slug.ts` | `/api/u-client-by-slug` | public | Client lookup for workspace login. |
| `u-login.ts` | `/api/u-login` | public | Workspace password login scoped by client slug. |
| `u-me.ts` | `/api/u-me` | bucket-user | Returns identity, permissions, enabled modules; refreshes cookie. |
| `u-logout.ts` | `/api/u-logout` | public | Clears cookie only; no server revocation. |
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
- MFA login-state tests before and after session minting.
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

- `db/migrations/<allocated>_sessions.sql`
- `netlify/functions/_shared/session.ts`
- `netlify/functions/_shared/permissions.ts`
- `auth-logout.ts`, `u-logout.ts`, `auth-me.ts`, `u-me.ts`
- Session tests.

M4:

- `db/migrations/<allocated>_mfa.sql`
- `netlify/functions/auth-login.ts`, `auth-google.ts`, `login.ts`
- New `auth-mfa-*` endpoints or a compact equivalent.
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

1. Migration numbers for M3, M4, M5, M6, M7, and M8.
2. MFA preference: WebAuthn-first or TOTP-first.
3. Whether CSP should be report-only in production for one deploy before enforcement.
4. Whether platform support admins should be allowed to impersonate by default.
5. Whether invite/reset emails are in scope now or token-link generation remains copy/manual.

## M1 Verification

Commands run before handoff:

```sh
npm run typecheck
npm test -- tests/integration/auth.test.ts tests/integration/user-node-auth.test.ts tests/integration/permissions-middleware.test.ts tests/integration/admin-impersonate.test.ts tests/integration/impersonation-session-priority.test.ts
```

Results:

- `npm run typecheck`: green.
- Targeted auth/AMS suite: 5 files passed, 72 tests passed.
- First targeted run failed because the new worktree had no local `.env`; copied the root `.env`
  into this worktree as an ignored local file.
- Second targeted run failed under sandboxed network because Neon was unreachable; reran the exact
  command with approved network escalation and it passed.

Full suite was not run for this read-only audit milestone. It is required before any
behavior-changing milestone handoff.
