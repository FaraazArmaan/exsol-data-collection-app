# Bulk Operations (invite + role change) — Design

**Date:** 2026-06-04
**Status:** Approved — implementation plan to follow
**Predecessors:** [2026-06-03-onboarding-wizard-design.md](./2026-06-03-onboarding-wizard-design.md), [2026-06-03-manage-team-design.md](./2026-06-03-manage-team-design.md), [2026-06-01-access-levels-design.md](./2026-06-01-access-levels-design.md)

## 1. Problem

Single-user create and single-user role change scale poorly when an admin or shop owner is onboarding a real team. A typical bakery franchise rollout has 20–100 staff across 3–5 levels per workspace; doing them one at a time through `EditUserNodeModal` is ~3 minutes per user and is error-prone (forgotten parents, level mismatches caught one-modal-at-a-time). Bulk role-change has the same shape: when a shop is reorganised (e.g., promoting 4 staff to managers) the current UI requires 4 separate edits with no way to validate cardinality across the whole change before committing.

## 2. Goal

Ship two related bulk workflows behind the same `_platform.users.*` permission gates that already protect single-user operations:

1. **Bulk invite** — paste CSV, preview + edit, submit; one atomic transaction creates all `user_nodes` (and optional `user_node_credentials`).
2. **Bulk role change** — multi-select chips in the team tree; choose a new role; one atomic transaction updates all `user_nodes.role_id`.

Both flows reuse the same code on both the admin AccessDashboard and the Owner-facing UserManageTeam page (different mount points, identical components and endpoints).

## 3. Non-goals

- **Bulk move (re-parent)** — drag-to-move on a single chip already works; queue for a later spec if demand appears.
- **Bulk delete** — destructive; deferred. Single-delete remains the only delete path.
- **CSV import of *existing* users for editing** — only invite (create) supports CSV. The next AMS feature (Workspace data export) covers the read side.
- **CSV download/export of current state** — same as above; that's the export feature.
- **Async / background processing for >500-row imports** — v1 is synchronous; the 500-row cap is sized to stay safely under Netlify's 26 s function timeout.
- **Per-row "generate temp password" UX** — for v1 the CSV either provides `temp_password` explicitly or sets `create_login=false`. Auto-generate is a polish-pass enhancement.
- **Bulk role-change cardinality dry-run preview** — server returns per-rejection errors after the user submits; we do not preflight-query the server before the click.
- **Rate-limiting bulk endpoints separately** — these are permission-gated admin/owner-only operations, not unauthenticated public endpoints; the existing `requirePermission` gate is the throttle.
- **New permission keys** — reuses `_platform.users.create` (bulk invite) and `_platform.users.edit` (bulk role change). No new role/permission grants.

## 4. Architecture

### 4.1 Two endpoints, not one discriminator

**Decision:** ship two separate endpoints (`user-nodes-bulk` and `user-nodes-bulk-role-change`) rather than one polymorphic `bulk-ops` endpoint.

Rationale: the body shapes are completely different (rows of new-user data vs. `{node_ids, new_role_id}`); the validation rules are different (cardinality + level/parent compat vs. role-allowed-at-level + cardinality-after-change); the audit operations are different (`users.bulk_invited` vs. `users.bulk_role_changed`). Collapsing them into one endpoint with a discriminator would mean a Zod union, two disjoint validation paths under one function, and harder-to-read integration tests. Two functions stay small and each mirrors its single-user analogue closely.

### 4.2 Bulk invite — `POST /api/user-nodes-bulk`

**Body shape:**

```typescript
{
  rows: Array<{
    display_name: string;            // required
    email?: string | null;
    role_key: string;                // required; resolved to role_id server-side
    level_number: number | null;     // null = workspace-root
    parent_email?: string | null;    // resolved to parent_id server-side via this client's users
    phone?: string | null;
    notes?: string | null;
    create_login?: boolean;          // default false
    temp_password?: string;          // required iff create_login === true
  }>;
}
```

**Server flow:**

1. `requirePermission('_platform.users.create')` + `resolveClientId` (mirror single-user POST `user-nodes.ts`).
2. Zod-parse body. Enforce `rows.length >= 1 && rows.length <= 500`; reject with `400 too_many_rows` or `400 empty_payload`.
3. **Pre-validate all rows in one pass before any DB write.** For each row:
   - `role_key` resolves to a role in this client.
   - `level_number` is valid (exists in this client's level matrix, or is `null` for root).
   - `parent_email` (if provided) resolves to a `user_node` in this client. Permitted to reference another row's email in the same submission — resolve in two passes: first index by email all incoming rows + existing rows, then resolve parents.
   - `role_key` is allowed at `level_number` per the role-level matrix.
   - `create_login=true` requires `temp_password` (basic length validation per `_shared/passwords.ts`).
   - Per-row cardinality: counting existing siblings + same-submission siblings under each parent, the role's max-per-parent is not exceeded.
4. If any row fails → `400 bulk_validation_failed` with body `{ errors: [{ row_index, errors: string[] }] }`. **No DB writes.** UI surfaces these inline in the preview table.
5. If all rows pass → pre-generate `crypto.randomUUID()` for every `user_node` (and for every `user_node_credentials` row where `create_login=true`). This is the pattern from `onboard-client.ts` — IDs known upfront allow child rows to reference parents created in the same transaction.
6. Build the SQL statement list and submit one `sql.transaction([...])`:
   - INSERT into `user_nodes` for all rows (ordered: roots first, then by depth via the pre-resolved parent map).
   - INSERT into `user_node_credentials` for rows with `create_login=true` (argon2-hashed via `_shared/passwords.ts`).
7. After successful commit, write **one** `logAudit({op: 'users.bulk_invited', ...})` audit row with detail `{count, role_keys: [...unique], login_count, has_temp_passwords: boolean}`. **Do not log the temp passwords themselves** (per saved feedback memory).
8. Return `201 { nodes: UserNode[], login_count: N }`.

### 4.3 Bulk role change — `POST /api/user-nodes-bulk-role-change`

**Body shape:**

```typescript
{
  node_ids: string[];   // 1..500
  new_role_id: string;
}
```

**Server flow:**

1. `requirePermission('_platform.users.edit')` + `resolveClientId`.
2. Zod-parse body. Cap at 500 `node_ids`.
3. For bucket-user callers at L2 or deeper (i.e., not workspace-root): `authorizeSubtreeScope(session.user_node_id, node_ids)` — assert every target is within the caller's subtree (extends the F1 subtree-on-detail discipline that shipped with access-levels). L1 workspace-root callers see all clients-scoped nodes and skip the subtree check.
4. Fetch all target `user_nodes`. Assert they all belong to the resolved client (defence in depth against cross-client IDs).
5. Fetch the new role; assert it exists in this client.
6. **Per-target validation pass before any DB write:**
   - The new role is in `allowed_role_ids` for the target's level.
   - Cardinality after the change is not exceeded (count siblings already at the new role under the same parent, + targets in this submission moving to the new role).
7. If any target fails → `400 bulk_validation_failed` with body `{ errors: [{ node_id, reason: string }] }`. **No DB writes.**
8. If all pass → `sql.transaction([...])` running one `UPDATE user_nodes SET role_id = $1 WHERE id = $2` per target.
9. Write **one** `logAudit({op: 'users.bulk_role_changed', ...})` audit row with detail `{count, from_role_keys: [...unique], to_role_key, target_ids: [...]}`.
10. Return `200 { updated: N }`.

### 4.4 Shared `login_attempts` table — N/A

Neither endpoint touches `login_attempts`. Rate-limiting bulk endpoints separately is non-goal §3; the `requirePermission` gate is the throttle (callers must be authenticated admins or owners).

### 4.5 Error shape

Both endpoints follow the existing convention from `auth-login.ts` / `user-nodes.ts`:

```json
{ "error": { "code": "bulk_validation_failed", "details": { "errors": [...] } } }
```

Codes used:
- `unauthorized` (401) — no session
- `forbidden` (403) — wrong permission, or out-of-subtree for L2+
- `empty_payload` (400) — `rows` or `node_ids` is empty
- `too_many_rows` (400) — exceeds 500-row cap
- `bulk_validation_failed` (400) — pre-validation failed; details contain per-row or per-node errors
- `cross_client` (400) — `node_ids` includes IDs from another client (bulk role change only)
- `not_found` (404) — `new_role_id` doesn't exist (bulk role change only)

### 4.6 Frontend — bulk invite

**Shared component:** `src/modules/shared/team-modals/BulkInviteModal.tsx`. Used by both admin AccessDashboard and Owner UserManageTeam.

UX flow:

1. Header button on the page: `Bulk invite` (next to the existing `+ Add user`).
2. Modal opens with a textarea for pasting CSV (header row required).
3. **Parse** button → run the pure `csv-parser.ts` helper → render an editable preview table.
4. Preview rows are inline-editable (display_name, email, role_key, level_number, parent_email, phone, notes, create_login, temp_password). Each row has a delete `×` button. An `+ Add row` button appends a blank row.
5. Client-side fast-fail validation flags obvious problems (missing required fields, unknown role_key, out-of-range level_number). Server is the source of truth.
6. **Create N users** button submits to `POST /api/user-nodes-bulk`.
   - On success: show summary toast (`Created N users, M with logins`), close modal, refresh tree.
   - On `bulk_validation_failed`: highlight failing rows with server `errors[]` inline; user fixes and resubmits.
7. Helper link: `Download CSV template` produces a one-row example file. Pure client-side `Blob` download — no server roundtrip.

**CSV helper:** `src/modules/shared/team-modals/csv-parser.ts` — a pure function `parseCsv(text: string): { rows: ParsedRow[], parseErrors: ParseError[] }`. Headers detected from the first row. Values quoted with `"` and escaped with `""`. Trims whitespace. Required columns: `display_name`, `role_key`. Optional columns: the rest of the schema. Extra unknown columns → ignored with a soft warning. Unit-tested (no DOM, no React).

### 4.7 Frontend — bulk role change

**Select mode:** new state on AccessDashboard + UserManageTeam:

- `selectMode: boolean`
- `selectedIds: Set<string>`

**Header controls:**
- Toggle button: `Select` ↔ `Cancel selection`. When on, the existing `+ Add user` button is disabled (or hidden), and `Bulk invite` is hidden.

**Component changes:**
- `src/modules/ams/components/UserNodeChip.tsx` — add `selected?: boolean` and `selectMode?: boolean` props. When `selectMode` is true, render a checkbox overlay (✓ filled / ☐ empty) on top of the chip. Click while in select mode → calls `onToggleSelect(id)` and does NOT open the edit modal.
- `src/modules/ams/components/LevelRow.tsx` — pass `selectMode`, `selectedIds`, `onToggleSelect` through to chips.

**Action bar:** `src/modules/shared/team-modals/BulkActionBar.tsx` — fixed-position bottom bar, shown when `selectedIds.size > 0`. Contents: `{N} selected → [Change role to ▾] [Clear]`.

**Change-role dropdown:** lists roles whose `allowed_levels` is a superset of (or equal to) the set of levels in the current selection. If the selection spans L1 + L2, only roles allowed at both levels appear. On choice:

1. POST `/api/user-nodes-bulk-role-change` with `{node_ids: [...selectedIds], new_role_id}`.
2. On success: toast `Updated N users`, clear selection, exit select mode, refresh tree.
3. On `bulk_validation_failed`: per-target errors are surfaced as a list in the toast with `node_id` → `display_name` resolution from the in-memory tree; selection is preserved so the user can deselect the rejected ones and retry.

## 5. Error handling

| Scenario | Behavior |
|---|---|
| Caller lacks `_platform.users.create` (bulk invite) | 403 `forbidden`; UI shows generic permission error |
| Caller lacks `_platform.users.edit` (bulk role change) | 403 `forbidden`; UI shows generic permission error |
| L2+ caller includes nodes outside their subtree (bulk role change) | 403 `forbidden`; UI shows "Some selections are outside your scope" |
| `rows.length === 0` or `node_ids.length === 0` | 400 `empty_payload`; UI shouldn't allow submit when empty (defence in depth) |
| Submission exceeds 500 rows | 400 `too_many_rows`; UI fast-fails before sending |
| Any row's `role_key` doesn't resolve | 400 `bulk_validation_failed`; row highlighted with "Role not found" |
| Any row's `parent_email` doesn't resolve | 400 `bulk_validation_failed`; row highlighted with "Parent email not found" |
| Cardinality would be exceeded post-submission | 400 `bulk_validation_failed`; row(s) highlighted with "Too many users at this level under {parent}" |
| Transaction fails mid-commit (e.g., Neon timeout) | Postgres rolls back the whole transaction atomically; UI shows generic error; user retries (no partial writes possible by design — pre-validation + single txn) |
| `logAudit` call fails after successful txn | Currently the call is awaited and an error would propagate up. Same behaviour as `user-nodes.ts` POST. Acceptable trade-off (DB-down means the audit log is also down). |

## 6. Testing

**New integration tests:**

`tests/integration/user-nodes-bulk.test.ts` (~6 cases):

1. Happy path: 3 rows including one with `create_login=true`; assert all 3 `user_nodes` rows exist, 1 `user_node_credentials` row exists, 1 audit row written with op `users.bulk_invited`.
2. Pre-validation: 1 row with an unknown `role_key` → 400 `bulk_validation_failed`, no DB writes (verify by row count before/after).
3. Cross-row parent: row A creates a manager, row B references row A by `parent_email` → both created, B has A as parent.
4. Cardinality violation: 3 incoming rows would push past the role's max-per-parent → 400 `bulk_validation_failed`, no DB writes.
5. Cap enforcement: 501 rows → 400 `too_many_rows`.
6. Permission gate: caller without `_platform.users.create` → 403.

`tests/integration/user-nodes-bulk-role-change.test.ts` (~5 cases):

1. Happy path: 3 node_ids → role X; assert all 3 `role_id` columns updated, 1 audit row written with op `users.bulk_role_changed`.
2. Pre-validation: target node is at a level where new role is not allowed → 400 `bulk_validation_failed`, no UPDATEs.
3. Subtree scoping: L2 caller submits a node_id outside their subtree → 403.
4. Cross-client: caller submits a node_id from another client → 400 `cross_client`, no UPDATEs.
5. Cardinality: change would create N+1 managers under one parent where max is N → 400 `bulk_validation_failed`.

**Audit assertions** must filter by `(op, target_id)` not just `LIMIT 1` (per saved feedback memory — parallel runners can interleave audit rows).

**Test emails** must use a unique-per-test pattern (e.g., `bulk-${Date.now()}-${i}@example.com`) to avoid pollution across parallel runs.

**New unit tests:**

`tests/unit/csv-parser.test.ts` (~6 cases):

1. Happy path: header + 3 rows → 3 parsed objects.
2. Quoted field with embedded comma: `"Smith, John"` → single value `Smith, John`.
3. Quoted field with escaped quote: `"She said ""hi"""` → `She said "hi"`.
4. Missing required column (`display_name`) → parse error per row.
5. Trailing comma / trailing blank line → ignored, no spurious row.
6. Unknown extra column → soft-warned, not fatal.

**Test count goal:** baseline 233 → ~250 (+6 csv-parser + ~6 bulk-invite + ~5 bulk-role-change).

## 7. Migration / backwards-compat

- **No DB migration.** Both endpoints write to existing tables (`user_nodes`, `user_node_credentials`, `audit_log`).
- **New endpoint URLs** — clients without the new UI just won't call them; no breakage.
- **`UserNodeChip` prop addition** — `selected?` and `selectMode?` are both optional with safe defaults (chip behaves exactly as before when omitted). Existing callers untouched.
- **Audit log dashboard** picks up the new `users.bulk_invited` / `users.bulk_role_changed` ops via the label registry. Add human-readable labels to wherever the audit-log polish PR's label map lives (verify location during implementation; likely `src/modules/ams/audit/labels.ts` or similar — implementer checks).

## 8. Out of scope (v1)

- Bulk move (re-parent).
- Bulk delete.
- Bulk credential reset (force-change-password across N users).
- Bulk Google-link / unlink.
- CSV export of existing users (covered by the next AMS feature: Workspace data export).
- Async / background job processing for >500-row payloads.
- Per-row auto-generated temp passwords with a results table the admin copies out.
- Bulk role-change dry-run preview API (pre-flight cardinality check before clicking submit).
- Saved CSV templates per client.
- Undo / rollback after successful commit.

## 9. Suggested next steps

1. User reviews this spec.
2. `superpowers:writing-plans` → ~10-task plan (server endpoint × 2, csv-parser + unit tests, BulkInviteModal, mount in 2 pages, select-mode chip plumbing, BulkActionBar, mount in 2 pages, smoke).
3. `superpowers:subagent-driven-development` to execute. First task is `git checkout -b feat/bulk-operations` (don't start on main per saved feedback).
4. After push: probe both new endpoints; if 404 run `netlify api restoreSiteDeploy` per the saved `feedback-netlify-new-function-404` memory.
