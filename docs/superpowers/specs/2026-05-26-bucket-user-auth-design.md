# Bucket-User Auth (Email/Password) — Design

**Date:** 2026-05-26
**Status:** Approved by user, in implementation
**Scope:** v1 of non-admin user authentication for bucket users (owners, managers, etc.)

## Goals

1. Bucket users (owners, employees, customers, etc. — i.e., the rows in `client_<id>.<role>` tables) can sign in with email + password.
2. Admin creates the credential with a temporary password. The temp password is visible to the admin on screen, up to 3 times OR until the user changes it.
3. First login forces password change.
4. After login the user lands on a placeholder "Account ready" page. Real workspace features come later.

Out of scope: GAuth (next phase), Resend email delivery of temp passwords (out-of-band for now), forgot-password flow, profile editing, rate-limit on user logins.

## Confirmed design decisions (from brainstorm)

1. **Post-login scope:** placeholder + force-change-password only.
2. **Routing:** client-scoped URL `/c/<slug>/login`. Each client gets a slug (auto-generated from name on create; backfilled for existing clients).
3. **Credential storage:** new `public.bucket_user_credentials` table — zero migration to existing per-client schemas.
4. **Temp password delivery:** admin sees plaintext on screen; reveal counter starts at 3; wiped on user-change-pwd OR when counter hits 0. After wipe, admin can reset to issue a new temp pwd.
5. **Multi-role:** one credential per email per client. If admin tries to create a second credential for the same email in the same client → 409 `email_already_has_login_in_this_client`.

## Schema

**Migration `008_bucket_user_credentials.sql`:**

```sql
CREATE TABLE public.bucket_user_credentials (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  role_key                    text NOT NULL,
  bucket_user_id              uuid NOT NULL,            -- logical FK to client_<id>.<role_key>.id
  email                       citext NOT NULL,
  password_hash               text NOT NULL,
  must_change_password        boolean NOT NULL DEFAULT true,
  temp_password_plain         text,                     -- NULL once changed by user OR views exhausted
  temp_password_views_left    integer,                  -- decremented per admin reveal
  last_login_at               timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_admin            uuid NOT NULL REFERENCES public.admins(id),
  UNIQUE (client_id, email),
  UNIQUE (client_id, role_key, bucket_user_id)
);

CREATE INDEX bucket_user_credentials_email_idx ON public.bucket_user_credentials (client_id, email);
CREATE TRIGGER bucket_user_credentials_set_updated_at
  BEFORE UPDATE ON public.bucket_user_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

**Migration `009_clients_slug.sql`:**

```sql
ALTER TABLE public.clients ADD COLUMN slug text;

UPDATE public.clients
SET slug = lower(regexp_replace(name, '[^A-Za-z0-9]+', '-', 'g'))
WHERE slug IS NULL;

-- Trim leading/trailing hyphens left by regex
UPDATE public.clients SET slug = regexp_replace(slug, '^-+|-+$', '', 'g');

-- If any collisions exist after backfill, append a suffix. For 0-3 existing
-- clients we expect no collision but this is defensive.
UPDATE public.clients c1
SET slug = c1.slug || '-' || substring(c1.id::text, 1, 4)
WHERE EXISTS (
  SELECT 1 FROM public.clients c2
  WHERE c2.slug = c1.slug AND c2.id <> c1.id AND c2.created_at < c1.created_at
);

ALTER TABLE public.clients ALTER COLUMN slug SET NOT NULL;
ALTER TABLE public.clients ADD CONSTRAINT clients_slug_unique UNIQUE (slug);
ALTER TABLE public.clients ADD CONSTRAINT clients_slug_format
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$');
```

## Endpoints

### User-facing (use a separate `bu_session` cookie)

| Method | Path | Purpose |
| --- | --- | --- |
| GET    | `/api/u-client-by-slug?slug=` | Public — returns `{client: {id, slug, name}}` or 404. Used by the login page to verify the slug exists. |
| POST   | `/api/u-login?client=<slug>`  | Public — body `{email, password}` → sets `bu_session` cookie, returns `{user, client, must_change_password}`. |
| POST   | `/api/u-logout`               | Clears `bu_session`. |
| GET    | `/api/u-me`                   | Returns current bucket user from cookie. 401 if not logged in. |
| POST   | `/api/u-change-password`      | Body `{current_password, new_password}` → updates hash, clears `must_change_password`, wipes temp plaintext. |

### Admin-facing (use existing admin `session` cookie)

| Method | Path | Purpose |
| --- | --- | --- |
| POST   | `/api/clients-bucket-users` (extended) | Body adds optional `{create_login: true, temp_password: string}`. If set, also writes a `bucket_user_credentials` row. |
| GET    | `/api/bucket-user-credential?client=&role=&user=` | Returns credential status. If `temp_password_plain` is non-null AND `views_left > 0`, decrements views and includes the plaintext. |
| POST   | `/api/bucket-user-credential?client=&role=&user=` | Body `{temp_password}` → resets credential; stores new plain, sets `must_change_password=true`, `views_left=3`. |
| DELETE | `/api/bucket-user-credential?client=&role=&user=` | Removes the credential row (bucket user row stays). |

The existing `DELETE /api/clients-bucket-user-detail` cascades to credentials via FK ON DELETE — actually wait, the FK is `client_id`, not `bucket_user_id`. The handler must explicitly delete the credential row before/after removing the bucket user row.

### Session shape

- Cookie name: `bu_session` (admin keeps `session`).
- JWT claims: `{ sub: <bucket_user_id>, kind: 'bucket_user', client_id, role_key, email }`.
- Same `JWT_SIGNING_SECRET`, same `mintSession`/`verifySession` helpers — they get an optional `kind` parameter; verifier rejects token if requested `kind` doesn't match.
- New `requireBucketUser(req)` helper in `_shared/permissions.ts` that verifies `bu_session` cookie + loads credential row.

## Admin UI changes

**`AddUserModal.tsx`:**

When the bucket has an `email` column populated by the admin:
- New checkbox: "Create login for this user".
- When checked, show a temp-password input (with a "Generate" button → 12-char random).
- Help text: "User will be prompted to change this on first login. You'll be able to view it up to 3 times after creating the account."

When the bucket does NOT have an email column (e.g., `customers` in the shop template — wait, shared core gives every role an `email` column, so this is always available). Skip this caveat.

**`BucketPanel.tsx` UserRow:**

New compact "Login" action button per row:
- If no credential and email is set → "Create login" → opens a small modal with `temp_password` field + Save.
- If credential exists, plaintext available, views left > 0 → "Reveal password" → modal shows `https://exsoldatacollectionapp.netlify.app/c/<slug>/login`, email, temp pwd, "Views remaining: N". A copy button per field.
- If credential exists, plaintext wiped (user changed pwd OR views exhausted) → "Reset password" → modal with new temp pwd input + Save.
- If credential exists → also a "Remove login" action (smaller, confirmation required).

**`ClientDashboard.tsx`:** show the client slug + login URL prominently for copy-paste.

## User-facing UI

New module `src/modules/user-portal/`:

**`pages/UserLogin.tsx`** (route `/c/:slug/login`)
- On mount: GET `/api/u-client-by-slug?slug=:slug`. If 404, render "No client found at this URL."
- Email + password form. On submit → POST `/api/u-login?client=:slug`.
- 200 + `must_change_password=true` → navigate `/c/:slug/change-password`.
- 200 + `must_change_password=false` → navigate `/c/:slug/`.
- 401 → "Email or password incorrect."

**`pages/UserChangePassword.tsx`** (route `/c/:slug/change-password`)
- Requires authenticated bucket user. If `must_change_password=false`, can still access (voluntary change).
- Fields: current password, new password (≥ 8), confirm new password.
- On success → navigate `/c/:slug/`.

**`pages/UserAccount.tsx`** (route `/c/:slug/`)
- Requires authenticated bucket user.
- Shows: client name + role label + "Hello {display_name}", their email, "Workspace features coming soon." paragraph, change-password link, sign-out button.

**Router:**
- `/c/:slug/login` is public (allowed without `bu_session`).
- `/c/:slug/*` other paths are guarded by a `RequireBucketUser` wrapper analogous to admin's `RequireAdmin`.
- Admin and bucket-user sessions are independent — having both cookies set is allowed (admin can be browsing both surfaces).

## Slug generation

On client create (`netlify/functions/clients.ts`):
1. Derive slug from name: `lower(regexp_replace(name, '[^A-Za-z0-9]+', '-', 'g'))`, trim hyphens.
2. Check uniqueness against `public.clients.slug`.
3. If taken, append `-2`, `-3`, etc.
4. Store in `clients.slug`.

(No UI for editing slug in v1. Raw SQL UPDATE if needed.)

## Tests

Integration:
- `bucket-user-credentials` admin CRUD: create on bucket-user POST; reveal decrements views; reveal returns plaintext only when allowed; reset clears views; delete works; cascade on bucket-user-delete.
- `u-login`: happy path; wrong pwd → 401; wrong client slug → 404; user with `must_change_password=true` returns flag.
- `u-change-password`: happy path; wrong current pwd → 401; clears `must_change_password`; wipes `temp_password_plain`.
- Session kind enforcement: admin `session` cookie cannot auth `/api/u-me`; `bu_session` cannot auth `/api/auth-me`.
- Duplicate-email-per-client: creating a second credential with same email in same client → 409 `email_already_has_login_in_this_client`.

## Implementation order

1. Migrations 008 + 009. Apply to dev. Apply to prod after ship-check.
2. `_shared/session.ts` accepts a `kind` field; `_shared/permissions.ts` adds `requireBucketUser`.
3. Endpoints in order: u-client-by-slug, u-login, u-me, u-logout, u-change-password, bucket-user-credential (GET/POST/DELETE), extend clients-bucket-users POST + clients-bucket-user-detail DELETE.
4. Admin UI extensions: AddUserModal + BucketPanel row action + ClientDashboard slug display.
5. User portal: 3 pages + router + `RequireBucketUser` guard + a thin `user-api.ts`.
6. Tests.
7. Typecheck + tests + commit + push + apply prod migrations + verify deploy.
