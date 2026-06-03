# Bucket-User Dashboard — Design

**Date:** 2026-06-03
**Status:** Draft — awaiting user review
**Author:** Claude (Opus 4.7) via brainstorming with project owner
**Predecessors:** `2026-06-01-access-levels-design.md` (matrix infra), `2026-05-27-ams-v3-hierarchy-design.md` (user/role model)

## 1. Problem

When a bucket-user (Owner or Level 2+) signs in at `/c/:slug/login`, the post-login landing is a thin identity card (`src/modules/user-portal/pages/UserAccount.tsx`) showing only profile fields, sign-in method controls, and a "Workspace features coming soon" line. There is no navigation, no surface for Modules, and no place for the Owner to reach team or settings affordances.

The access-levels feature (just shipped) gives every Level a permission matrix (Module × DataBucket × Verb). Nothing on the client currently consumes it, so an L2+ user has no way to see what they can do, and an Owner has no entry point to Module surfaces even when their client has Products enabled.

## 2. Goal (v1)

Replace the placeholder landing with a permission-aware **nav-shell dashboard** that:

1. Establishes the right structural layout (sidebar + topbar + content area) for all future bucket-user features to land in.
2. Renders Module entries the user has at least Read access to, based on their Level's permission matrix.
3. Provides Owner-only stub tiles for "Manage team" and "Settings" so the roadmap is visible.
4. Reuses the existing account-management content as a sub-page reachable from the sidebar.

Module UIs themselves are out of scope — each Module entry routes to a stub that proves the permission wiring works.

## 3. Non-goals

- Building any real Module UI (Booking, Payments, etc.).
- Implementing the Owner's "Manage team" UI (the tile is a stub).
- Implementing a "Settings" page (the tile is a stub).
- Customer-facing surfaces (PDF page 3 — out of scope, separate user type).
- Mobile-responsive polish beyond "doesn't break layout."
- Real-time data on the dashboard home (counters are placeholders).

## 4. Architecture

### 4.1 Routing

| Path | Component | Notes |
| --- | --- | --- |
| `/c/:slug/login` | `UserLogin` | Unchanged. Outside the dashboard layout. |
| `/c/:slug/change-password` | `UserChangePassword` | Unchanged. Reached via the `must_change_password` redirect; stays outside the dashboard layout so a forced password change is uncluttered. |
| `/c/:slug` | `UserDashboardHome` | NEW landing page, inside `UserDashboardLayout`. |
| `/c/:slug/m/:moduleKey` | `ModuleStub` | NEW. One route handles all Modules; the component reads the manifest from the registry. |
| `/c/:slug/account` | `UserAccount` | EXISTING content, moved here. Inside the layout. |

`UserPortalRoutes.tsx` is updated to nest the layout-bearing routes inside a new `UserDashboardLayout` element. `RequireBucketUser` continues to gate the layout root.

### 4.2 File layout

```
src/modules/user-portal/
  UserPortalRoutes.tsx          # EDIT: add layout + nested routes
  api.ts                        # EDIT: extend UserPortalUser type with level_number, permissions
  user-auth-context.tsx         # EDIT: surface level_number + permissions from u-me
  layout/                       # NEW dir
    UserDashboardLayout.tsx     # NEW: sidebar + topbar + <Outlet/>
    Sidebar.tsx                 # NEW: nav rail
    TopBar.tsx                  # NEW: client name + user menu
  nav/                          # NEW dir
    useNavItems.ts              # NEW: derives rail entries from auth state
    useNavItems.test.ts         # NEW: unit tests
  pages/
    UserAccount.tsx             # EDIT: drop the H1/identity heading and signout (now in layout); keep Your-account + Sign-in-methods + change-password link
    UserDashboardHome.tsx       # NEW
    ModuleStub.tsx              # NEW
    UserChangePassword.tsx      # unchanged
    UserLogin.tsx               # unchanged
```

### 4.3 Components

**`UserDashboardLayout.tsx`** — flex container; left = `Sidebar`; right = `<TopBar /> + <main><Outlet/></main>`. Provides the chrome shared by Dashboard / Module / Account pages.

**`Sidebar.tsx`** — vertical nav rail. Three sections:
1. Dashboard (always shown) → `/c/:slug`
2. Modules (dynamic) → one `NavLink` per entry from `useNavItems()`; each routes to `/c/:slug/m/:moduleKey`
3. Account (always shown) → `/c/:slug/account`

Uses react-router's `NavLink` for active-state styling. Width fixed at v1 (responsive collapse deferred).

**`TopBar.tsx`** — left: client display name; right: user menu (display_name → dropdown with "Account" link + "Sign out" action). Sign-out lives here (not in the Account sub-page) so it's always one click away.

**`UserDashboardHome.tsx`** — landing content:
- Welcome heading: `Welcome back, {display_name}`.
- Stat-tile row (3 read-only tiles): `Account role`, `Modules available` (count from `useNavItems`), `Workspace` (client display name). All three derive from current auth state — no new payload fields. See §8 for what was considered and deferred.
- Quick-actions section:
  - Owner-only tiles: "Manage team" and "Settings" (both render an info toast or alert saying "Coming soon" on click; no real navigation).
  - One tile per accessible Module → links to `/c/:slug/m/:moduleKey`.

**`ModuleStub.tsx`** — reads `:moduleKey` param, looks up the manifest from `src/modules/registry/modules.ts`. Renders:
- Module display name + (icon if present in manifest)
- "This Module's UI is coming soon."
- Permission summary derived from `permissions`: `Your permissions here: Read on N buckets, Create on M buckets…`
- If `moduleKey` is unknown or the user has no permissions on it, redirect to `/c/:slug` (defense-in-depth — the sidebar should never render unreachable entries).

### 4.4 Permission-derived nav

**`nav/useNavItems.ts`** — pure hook:

```ts
type NavModuleItem = {
  moduleKey: string;
  displayName: string;
  href: string; // `/c/${slug}/m/${moduleKey}`
};

function useNavItems(): { modules: NavModuleItem[] };
```

Internally pulls `level_number`, `permissions`, and the client's enabled Modules from auth context. Rules:

- **L1 (Owner):** every Module enabled on the client appears, regardless of whether the matrix grants a verb (Owner is implicitly all-verbs by `derivePermissionRows`).
- **L2+:** a Module appears iff `permissions` has at least one row for it where the Read (or "view") verb is true.

The hook returns a stable-ordered list (alphabetical by display name for v1; reordering is a later concern).

### 4.5 Data flow

The auth-context fetches `userMe()` on mount today. We extend the existing endpoint rather than adding a second round-trip.

**Server — `netlify/functions/u-me.ts`:**
- Look up `user.level_number` from the user's level FK.
- Compute permission rows via the existing `derivePermissionRows` helper (already used by `requirePermission` middleware) — scoped to the user's level only.
- Add to response:
  ```ts
  {
    user: { ...existing, level_number: number },
    client: { ...existing },
    permissions: PermissionRow[] // [{ module_key, bucket_key, verbs: { read, create, update, delete } }, ...]
  }
  ```
- Cap rows to Products currently enabled on the client (`derivePermissionRows` already does this).

**Client — `user-auth-context.tsx`:**
- Extend the context value with `permissions: PermissionRow[]` and `level_number: number` (the latter lives on `user`).
- `refresh()` updates all three in lockstep.

**Type plumbing — `src/modules/user-portal/api.ts`:**
- Extend `UserPortalUser` with `level_number: number`.
- Add `PermissionRow` type (re-export from a shared types module if one exists, otherwise define inline).
- Update `userMe()` return shape.

## 5. Error handling

- `u-me` permission lookup failure: log + return user/client with `permissions: []`. Client renders Account + Dashboard with no Modules in the rail (degraded but signed-in). This matches the existing pattern where a broken matrix doesn't lock anyone out of their identity surface.
- Unknown `:moduleKey` in URL: `ModuleStub` redirects to `/c/:slug`.
- User signs out mid-session: existing `RequireBucketUser` redirect to `/c/:slug/login` already covers this.

## 6. Testing

### 6.1 Server

- Extend `netlify/functions/u-me.test.ts` (or add a sibling):
  - L1 user → response includes `level_number: 1` and a non-empty `permissions` array covering all enabled Modules.
  - L2 user with restricted matrix → response includes only their permitted rows.
  - User on a client with no enabled Products → `permissions: []`.

### 6.2 Client

- `nav/useNavItems.test.ts` (unit, fixtures only — no DOM):
  - L1 fixture → all client Modules returned, alphabetical.
  - L2 fixture with read on Booking only → only Booking returned.
  - L2 fixture with no reads → empty array.
  - Module enabled on client but missing from `permissions` (L2) → not returned.

No new E2E tests in v1 (manual smoke covers the route wiring).

### 6.3 Manual smoke

After implementation:
1. Log in as an L1 bucket-user → land on `/c/:slug`, see sidebar with Dashboard / [enabled Modules] / Account.
2. Click a Module → see `ModuleStub` with permission summary.
3. Click Account → see the relocated identity card.
4. Click "Manage team" tile → see coming-soon affordance (toast/alert).
5. Log in as an L2 user with reduced permissions → sidebar only lists Modules they have Read on; "Manage team"/"Settings" tiles are not rendered.
6. Sign out from TopBar menu → redirected to login.

## 7. Migration / backwards-compat

- No DB migration. `users.level_id` already exists (per AMS v3).
- The `/c/:slug/account` route is new; any external link/bookmark to `/c/:slug` continues to work and now lands on the dashboard (different content, but the route resolves cleanly).
- `u-me` response shape gains fields; the type extension is additive. Existing clients (none beyond the user-portal in this repo) are unaffected.

## 8. Open questions deferred to implementation

- Visual style: reuse existing `.card`/`.btn` classes from the admin portal CSS, or introduce a user-portal-specific theme? **Decision deferred to plan/implementation:** start with the existing classes (zero new CSS), iterate visually as a follow-up.
- Stat-tile content: `Last sign-in` requires either a new field on the user payload or a derived value. **Decision:** for v1, the three tiles are `Account role`, `Modules available`, and `Workspace name` (all derivable from current auth state). `Last sign-in` is deferred.
- Settings/Manage-team coming-soon UX: toast vs. inline alert vs. disabled tile with tooltip. **Decision deferred to plan:** simplest is a `disabled` cursor + tooltip "Coming soon" — no toast infra needed.

## 9. Suggested next steps

1. User reviews this spec (review gate).
2. Invoke `superpowers:writing-plans` to break into implementation tasks. Anticipated task shape (3–5 tasks):
   - Server: extend `u-me` with `level_number` + `permissions` + tests.
   - Client types + auth context update.
   - Layout shell (`UserDashboardLayout` + `Sidebar` + `TopBar`).
   - Pages (`UserDashboardHome` + `ModuleStub`) + `useNavItems` hook + tests.
   - Routing wire-up + `UserAccount` trim + manual smoke.
3. Execute via `superpowers:subagent-driven-development` (same pattern that shipped access-levels).
