# Manage Team — Design

**Date:** 2026-06-03
**Status:** Approved — implementation plan to follow
**Predecessors:** [2026-06-03-user-dashboard-design.md](./2026-06-03-user-dashboard-design.md) (dashboard surface), [2026-06-01-access-levels-design.md](./2026-06-01-access-levels-design.md) (`requirePermission` middleware + `_platform.users.*` permission keys)

## 1. Problem

The bucket-user dashboard (just shipped) renders a "Manage team" tile on the Owner's home that is a stub (`tile-disabled` with a "Coming soon" badge). The Owner has no way to add, edit, or remove users in their own workspace today — every team-management action must go through the ExSol admin, which is poor UX and doesn't scale.

The access-levels feature, also shipped, established `requirePermission(req, '_platform.users.<verb>')` as the auth gate for this surface. The matrix already enumerates `view/create/edit/delete` verbs on the `_platform.users` surface. L1 Owners automatically pass these checks via the matrix bypass.

## 2. Goal (v1)

Build a real Manage Team page reachable from the dashboard Owner-tile and the sidebar that lets the Owner:

1. **View** every user in their workspace, grouped by Level, in the same tree-of-chips layout the admin AMS uses.
2. **Add** a new user at any existing Level under any valid parent, with a temp password.
3. **Edit** display_name, email, phone, notes (NOT role/level/parent — those are workspace structure, see §2.1).
4. **Change role / level / parent** via drag-to-move (level/parent) and a role dropdown (role within current level).
5. **Manage credentials** — reset password (issue temp pw), peek temp pw if not yet used, unlink Google.
6. **Delete** a user (hard delete; cascades subtree per existing AMS rule).

L2+ users with the `_platform.users.*` permission keys granted can use the same UI; for v1 they see the full workspace (no subtree scoping).

### 2.1 Why role/level/parent IS in scope

The earlier "edit details" capability was framed as separable from "change role/level/parent." On reflection: the drag-to-move UX (changing level/parent by dragging a chip between rows) is the most intuitive part of the admin AMS, and excluding it would force every reorg through the ExSol admin. Role change within the current level (via the edit modal's role dropdown) is similarly cheap. So all three structural changes ship in v1; cardinality validation already runs server-side and gates errors naturally.

## 3. Non-goals

- Adding, removing, or renaming **Levels** themselves (workspace-structure decision; stays admin-only via the Configure Structure page).
- Toggling enabled **Products** for the workspace (admin-only).
- Editing the **permission matrix** for a Level (Owner can already do this in the Access Level Dashboard, which is a separate page).
- L2+ **subtree scoping** — when an L2 user has `_platform.users.*` perms, they see every user in the workspace, not just their direct/indirect reports. Scoping to subtree is a future enhancement (the `subtreeOf` helper exists; the UI just doesn't filter yet).
- **Google link/unlink on behalf of another user** — risky surface, defer.
- **Bulk operations** (invite many at once, bulk role change).
- **Audit log** of who changed what.
- **Soft delete / deactivate** — hard delete only, matches existing AMS.
- A separate **Settings** page (separately tracked).

## 4. Architecture

### 4.1 Endpoint widening (server)

Replace `requireAdmin(req)` with `requirePermission(req, '_platform.users.<verb>')` on these existing endpoints:

| File | Method | Verb |
|---|---|---|
| `netlify/functions/user-nodes.ts` | GET | view |
| `netlify/functions/user-nodes.ts` | POST | create |
| `netlify/functions/user-nodes-detail.ts` | GET | view |
| `netlify/functions/user-nodes-detail.ts` | PUT | edit |
| `netlify/functions/user-nodes-detail.ts` | DELETE | delete |
| `netlify/functions/user-nodes-move.ts` | POST | edit |
| `netlify/functions/user-node-credential.ts` | GET | edit *(peeking the temp pw is privileged; not a `view`)* |
| `netlify/functions/user-node-credential.ts` | POST | edit |
| `netlify/functions/user-node-credential.ts` | DELETE | edit |

`requirePermission` already grants admin a blanket bypass and grants L1 bucket-users a matrix-free bypass. For L2+, it consults `client_levels.permissions`. Endpoints retain their existing business logic; only the auth gate changes.

### 4.2 `resolveClientId` helper

New utility in `netlify/functions/_shared/permissions.ts`:

```typescript
export function resolveClientId(
  session: AnySession,
  req: Request,
): { clientId: string } | { error: 'missing_client' | 'forbidden_cross_client' } {
  if (session.kind === 'admin') {
    const param = new URL(req.url).searchParams.get('client');
    if (!param) return { error: 'missing_client' };
    return { clientId: param };
  }
  // bucket_user
  const param = new URL(req.url).searchParams.get('client');
  if (param && param !== session.client_id) {
    return { error: 'forbidden_cross_client' };
  }
  return { clientId: session.client_id };
}
```

Each widened endpoint calls `resolveClientId` and 400s `missing_client` (admin without `?client=`) or 403s `forbidden_cross_client` (bucket-user trying to escalate to another client). The latter is a security boundary — without this check, a bucket-user could pass `?client=<other-id>` to enumerate or mutate another workspace's users.

### 4.3 Frontend

**New page:** `src/modules/user-portal/pages/UserManageTeam.tsx` (~150 LOC).
- Reads `client` from `useUserAuth()`.
- Fetches `/api/user-nodes` (no `?client=` param) + `/api/client-roles` (no param) + `/api/client-levels` (no param) — same endpoints, scoped by JWT.
- Renders the same level-rows-of-chips layout the admin AccessDashboard uses, **minus** the Configure Structure link, Products section, and Permission Matrix link.
- Owns the dnd-kit `DndContext` for chip drag-to-move.
- Mounts `AddTeamMemberModal` and `EditTeamMemberModal` from the new owner-team subdirectory.

**Reused subcomponents** (no changes):
- `src/modules/ams/components/UserNodeChip.tsx`
- `src/modules/ams/components/LevelRow.tsx` (props-driven, auth-agnostic)

**New owner-scoped components:**
- `src/modules/user-portal/team/AddTeamMemberModal.tsx` — mirrors `AddUserNodeModal` JSX/UX but binds to bucket-user API wrappers.
- `src/modules/user-portal/team/EditTeamMemberModal.tsx` — mirrors `EditUserNodeModal`.
- `src/modules/user-portal/team/LoginManageDrawer.tsx` — mirrors `LoginManageModal` (credential reset, peek, Google unlink).

These three are intentional forks. The admin versions are deeply coupled to admin context (`useAuth()`, admin API wrappers, URL `:clientId` param) and refactoring them to be auth-agnostic was judged a too-large secondary change. Each owner-scoped file carries a header comment: `// Mirrors src/modules/ams/components/<X>.tsx — consolidate when modals stabilize.`

**New API wrappers:** `src/modules/user-portal/team/api.ts`.
- Mirrors `src/modules/ams/api.ts`'s team-mgmt-related functions (`listUserNodes`, `createUserNode`, `updateUserNode`, `moveUserNode`, `deleteUserNode`, `getCredential`, `resetCredential`, `deleteCredential`, `listRoles`, `listLevels`).
- Reads `client_id` from the user-portal auth context — but in practice, doesn't need to pass it: the server resolves from JWT.
- Wraps the same fetch helpers (`apiFetch` from `src/lib/api-client.ts`).

**Router update** (`src/lib/router.tsx`):
```typescript
// New route under UserDashboardLayout's children:
{ path: 'team', element: <UserManageTeam /> },
```

**Sidebar update** (`src/modules/user-portal/layout/Sidebar.tsx`):
- Read `user.level_number` from `useUserAuth()`.
- If `level_number === 1 || level_number == null`, render a "Team" `NavLink` under the Modules group (or in its own group label "Workspace").
- **Asymmetry with the page gate is deliberate:** the sidebar entry is L1-only in v1 (UI affordance), but the page itself works for any caller that `requirePermission` admits — so an L2+ user granted `_platform.users.view` can still reach the page via direct URL. This keeps the v1 sidebar simple while leaving the door open: the day an Owner actually grants `_platform.users.*` to a sub-manager, we change one boolean in the sidebar gate from `level_number === 1` to a permission check, with no other code changes.

**Dashboard home update** (`src/modules/user-portal/pages/UserDashboardHome.tsx`):
- The "Manage team" Owner-only `StubTile` becomes a real `Link` to `/c/:slug/team` styled the same as the Module tiles. The `tile-disabled` class and `Coming soon` badge drop; the title and description stay.

## 5. Error handling

- **`requirePermission` denies:** 401 unauthorized (no session) or 403 forbidden (session OK, permission missing). Front-end shows a friendly "You don't have permission to view team management" message and a Dashboard back-link.
- **`resolveClientId` returns `missing_client`:** 400 with `validation_failed` body — only reachable by admin callers; bucket-user always has `session.client_id`.
- **`resolveClientId` returns `forbidden_cross_client`:** 403 with code `forbidden_cross_client` — bucket-user attempted to operate on another workspace.
- **Cardinality violation on add:** server already returns 409 with code `cardinality_violation`; front-end surfaces the message in the AddTeamMember modal.
- **Delete cascades** — modal confirms with "This will also delete N reports" message before submit, same as the admin EditUserNodeModal does today.

## 6. Testing

### 6.1 Server

- Extend each widened endpoint's existing integration test:
  - Admin path: still works (regression guard).
  - L1 Owner path: works without `?client=` param.
  - L2 without `_platform.users.*` perm: 403.
  - L2 WITH `_platform.users.view` perm: GET works; PUT (without `edit`) returns 403.
  - Bucket-user passing `?client=<other-id>`: 403 `forbidden_cross_client`.
- New test file `tests/integration/manage-team-bucket-user.test.ts` for the cross-cutting bucket-user flow (create → list → edit → move → reset pw → delete).

### 6.2 Unit

- `_shared/permissions.ts` — `resolveClientId` cases: admin with/without param; bucket-user with/without matching param; bucket-user with mismatched param.

### 6.3 Manual smoke (Task 5 of the plan)

- Log in as Joe (L1 Owner). Click "Manage team" tile → land on `/c/joe-s-hardware/team`. See the org tree with Joe as the only chip in L1.
- Click "Add user" in an L2 row → modal → create user → tree updates.
- Click a chip → edit modal → change display_name → save → chip label updates.
- Drag a chip from L2 to L3 → confirm modal → tree updates and parent_id is set on the server.
- Click "Manage login" on the chip → reset password → see new temp pw → close.
- Click "Delete" on a chip → confirm → chip disappears.
- Sign out + log in as the L2 user with no `_platform.users.*` perms → "Team" nav entry does not appear in the sidebar; direct visit to `/c/joe-s-hardware/team` shows a friendly 403 page.

## 7. Migration / backwards-compat

- **No DB migration.** All required tables and columns exist.
- **Endpoint contract:** the widened endpoints continue to accept the same admin-side query params, body shapes, and response shapes — they just additionally accept bucket-user sessions. Existing admin UI is unaffected.
- **Frontend route addition:** `/c/:slug/team` is new; nothing else moves.

## 8. Open questions deferred to implementation

- **Empty-state copy** when the Owner is the only user in their workspace.
- **Whether the "Manage team" sidebar group needs a dedicated header** (alongside `MODULES`) or just sits between Modules and Account without ceremony. Suggest the latter for visual simplicity in v1.
- **Audit/activity feed** — explicitly out of scope, but the schema supports it via `schema_ops_log`; design a follow-up if needed.

## 9. Suggested next steps

1. User reviews this spec.
2. `superpowers:writing-plans` → implementation plan (~5–7 tasks: endpoint widening + tests, `resolveClientId` helper + tests, owner-team API + components, page + router + sidebar wiring, smoke).
3. `superpowers:subagent-driven-development` to execute, same pattern that shipped the dashboard.
