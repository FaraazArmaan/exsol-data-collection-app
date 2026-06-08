# Edit User Modal — Role Change

**Date:** 2026-06-08
**Status:** Approved — implementation plan to follow
**Predecessors:**
- [2026-06-04-bulk-operations-design.md](./2026-06-04-bulk-operations-design.md) — the existing bulk role-change endpoint this feature mirrors
- [2026-06-03-manage-team-design.md](./2026-06-03-manage-team-design.md) — shared `EditUserModal` and `TeamMemberApi` contract

## 1. Goal

Let an admin or L1 Owner change a user's role from inside the existing Edit User modal, alongside identity and parent edits. The role change must propagate to the admin `/files` workspace tree (which groups users by role) without manual refresh.

## 2. Scope

**In scope**
- New form field in `src/modules/shared/team-modals/EditUserModal.tsx`: a role `<select>` populated from the levels-allowed-roles intersection.
- New endpoint `POST /api/user-nodes-role-change` (single-user variant of the existing bulk endpoint).
- New `_shared/role-change.ts` helpers, extracted from `user-nodes-bulk-role-change.ts` and consumed by both endpoints.
- New audit op `users.role_changed` (singular), wired through `src/modules/ams/components/audit/op-labels.ts` (registry + `summarize()`).
- Integration + unit tests as specified in §7.

**Out of scope**
- A combined identity+parent+role atomic-transaction endpoint. Partial-commit semantics match the existing modal — documented honestly in §5.
- Changes to `user-nodes-bulk-role-change.ts`'s wire behavior. The bulk endpoint is refactored to consume the shared helpers but its inputs, outputs, and permission gate are unchanged.
- The admin permission-roles surface (AMS backlog #6). Role-content editing remains under `/configure`.
- The `AccessDashboard.tsx:143` drag-drop first-parent default. Tracked separately.
- E2E / Playwright. No existing AMS modal has E2E tests; this one follows the same convention.

## 3. Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Who can change roles | Admin + L1 Owner only | Matches the existing `authorizeSubtreeScope` bypass at `permissions.ts:206-207`. Closes the L2→Owner promotion gap (`project_team_l2_promote_l1_gap.md`) by construction. |
| Picker contents | `client_levels.allowed_role_ids[target.level_number]` | A role that isn't allowed at the user's level can't appear. Owner role is never in an L2 level's allow-list, so even if scope is relaxed later, an L2 can't see "Owner" in the dropdown. |
| Save UX | Single Save button, inline confirm panel when role differs | Matches the existing password-reset confirm pattern (`EditUserModal.tsx:311`). One save action; explicit second-look on the higher-stakes change. |
| Self-role-change | Blocked (picker disabled with tooltip) | Prevents L1 Owners from accidentally demoting themselves below `users.edit` and losing access. The check is `target.id === session.user_node_id`. |
| Order of operations | identity → parent → role | Role last so its cardinality check sees the post-parent-move state. Identity first because it has no cross-dependencies. |
| Cross-page propagation | Existing 5s poll in `ClientFilesCard.fetchOnce()` | No new mechanism. Backend writes `user_nodes.role_id`; next `/files` poll picks it up. |

## 4. Architecture

```
EditUserModal (shared, src/modules/shared/team-modals/EditUserModal.tsx)
  ├─ identity edits        → PATCH /api/user-nodes/:id           (existing)
  ├─ parent reassignment   → POST  /api/user-nodes-move          (existing)
  └─ role change (NEW)     → POST  /api/user-nodes-role-change   (NEW)
                              └─ uses _shared/role-change.ts
                                  ├─ validateLevelAllowsRole()
                                  ├─ validateCardinality()
                                  └─ (audit body shape via logAudit)

netlify/functions/user-nodes-bulk-role-change.ts
  └─ refactored to consume the same _shared/role-change.ts helpers
     (behavior preserved, validated by existing 5 tests)
```

The shared helper module is a lift-and-shift of validation logic currently in `user-nodes-bulk-role-change.ts` lines 91–159. No new behavior is introduced in the bulk endpoint; the refactor is a prerequisite for the new single-user endpoint to share validation rather than duplicate it.

## 5. Modal UI

### 5.1 New form field

Insert a `<label>Role</label><select>...</select>` block between the existing parent picker (`EditUserModal.tsx:236-247`) and the Sign-in section. The header role chip + label (`:192-196`) stays as-is for context.

Options list is derived once per render from props:
```
levelAllowedRoles = roles.filter(r =>
  levels.find(l => l.level_number === node.level_number)?.allowed_role_ids.includes(r.id)
)
```

### 5.2 Visibility rules

| Condition | Picker state |
|---|---|
| Caller is L2+ bucket-user | Picker not rendered (hidden) |
| Target node has `level_number === null` (unassigned) | Picker not rendered |
| Target node is caller's own user_node | Picker rendered but `disabled` with `title="You can't change your own role"` |
| All other cases | Picker rendered, fully interactive |

If the level has exactly one allowed role and it matches the user's current role, the picker is still rendered — it just has one option and no role change is possible. No special-case handling.

Per-portal wiring of `canChangeRole`:
- Admin (`src/modules/ams/components/team-modal-api.ts`): always `true`.
- Owner (`src/modules/user-portal/team/team-modal-api.tsx`): `true` if the caller's own `level_number === 1`, else `false`.

### 5.3 Inline confirm panel

When `selectedRoleId !== node.role_id`, render a confirmation panel below the form fields (matching the password-reset confirm at `:311`):

```
You're changing {display_name} from {currentRole.label} to {newRole.label}.
This affects which views and bulk actions they appear in.

[ Confirm role change ]   [ Revert ]
```

The main Save button is disabled until the user clicks "Confirm role change" (sets a `roleChangeConfirmed` boolean) or reverts the picker to the original role.

### 5.4 Order of HTTP calls on Save

```javascript
if (identityDirty) {
  await api.updateNode(...)
  if (!ok) { setError(...); return; }
}
if (parentChanged) {
  await api.moveNode(...)
  if (!ok) { setError(...); return; }
}
if (roleChanged && roleChangeConfirmed) {
  await api.changeRole(node.id, selectedRoleId)
  if (!ok) { setError(...); return; }
}
onSaved();
```

**Partial-commit risk:** if step N fails, steps 1…N-1 stay committed. The modal surfaces the failure; the user fixes it manually. This matches the existing identity-then-parent behavior. A combined atomic endpoint is a tempting future refactor but out of scope here.

## 6. Endpoint: `POST /api/user-nodes-role-change`

### 6.1 Request

```typescript
{
  node_id: string,      // uuid
  new_role_id: string,  // uuid
}
```

### 6.2 Response codes

| Code | HTTP | When | Detail |
|---|---|---|---|
| `validation_failed` | 400 | Zod parse failed | Zod flatten output |
| `not_found` | 404 | `node_id` or `new_role_id` not found | — |
| `cross_client` | 400 | node or role belongs to a different client than caller's resolved scope | — |
| `forbidden_role_change_scope` | 403 | `session.kind === 'bucket_user' && session.level_number > 1` | — |
| `self_role_change_forbidden` | 403 | `target.id === session.user_node_id` | — |
| `unassigned_node` | 400 | target's `level_number IS NULL` | — |
| `level_disallows_role` | 400 | new role not in `client_levels.allowed_role_ids[level_number]` | — |
| `cardinality_exceeded` | 400 | post-change cardinality would exceed cap | `{ max: number }` |
| `no_change` (success body field) | 200 | `new_role_id === target.role_id` | `{ ok: true, no_change: true }`; no UPDATE, no audit row |
| (success) | 200 | committed | `{ ok: true, node: UserNode }` |

### 6.3 Server-side flow

1. `authenticateForPermission(req, '_platform.users.edit')` — same gate as the bulk endpoint.
2. `resolveClientIdOrRespond(session, req)`.
3. Zod parse.
4. If `session.kind === 'bucket_user' && session.level_number > 1` → 403 `forbidden_role_change_scope`.
5. SELECT target node + new role row; check existence, cross-client, unassigned.
6. If `target.id === session.user_node_id` → 403 `self_role_change_forbidden`.
7. If `new_role_id === target.role_id` → return `{ ok: true, no_change: true }`, no audit.
8. `validateLevelAllowsRole(sql, clientId, target.level_number, new_role_id)` — 400 on fail.
9. `validateCardinality(sql, clientId, target.parent_id, new_role_id, target.role_id)` — 400 on fail with `details.max`.
10. UPDATE `user_nodes SET role_id = $1, updated_at = now() WHERE id = $2`.
11. `logAudit(sql, { session, op: 'users.role_changed', clientId, targetType: 'user_node', targetId: target.id, detail: { from_role_key, to_role_key, target_id, level_number } })`.
12. Return updated `node` row.

### 6.4 Audit op-label registry

Add to `src/modules/ams/components/audit/op-labels.ts`:
- Registry entry: `'users.role_changed': { icon: '🔁', label: 'Role changed' }` (icon to match existing conventions).
- `summarize()` case: returns `"changed {target.display_name}'s role from {from_role_key} to {to_role_key}"` when the audit row's op matches.

## 7. Tests

### 7.1 Integration — `tests/integration/user-nodes-role-change.test.ts` (new)

Real Neon dev DB, fixture client via `tests/helpers/`. Mirrors `user-nodes-bulk-role-change.test.ts`'s style.

| # | Test | Asserts |
|---|---|---|
| 1 | Admin changes a Manager → Senior Manager (happy path) | `200`, `user_nodes.role_id` updated, exactly one `audit_log` row with op `users.role_changed`, detail keys `from_role_key/to_role_key/target_id/level_number` |
| 2 | L1 Owner changes a node in their workspace | `200`, same audit shape |
| 3 | L2+ bucket-user attempts role change | `403 forbidden_role_change_scope`, no UPDATE, no audit row |
| 4 | Caller targets their own `user_node_id` | `403 self_role_change_forbidden`, no UPDATE, no audit row |
| 5 | New role not in level's `allowed_role_ids` | `400 level_disallows_role`, no UPDATE |
| 6 | Role change would exceed cardinality cap | `400 cardinality_exceeded` with `details.max`, no UPDATE |
| 7 | Target node has `level_number IS NULL` | `400 unassigned_node`, no UPDATE |
| 8 | `new_role_id === current role_id` | `200 { no_change: true }`, no UPDATE, no audit row |

### 7.2 Unit — `tests/unit/role-change-helpers.test.ts` (new)

Pure-function tests on the shared helpers:
- `validateLevelAllowsRole` — returns `{ok: true}` when role is in `allowed_role_ids`; returns `{code: 'level_disallows_role'}` otherwise.
- `validateCardinality` — projects correct post-state count:
  - target moving INTO the new-role cohort (current `role_id ≠ new_role_id`) → projected = existing + 1
  - target already IN the new-role cohort (current `role_id === new_role_id`) → projected = existing (no double-count); this is the `wasCounted` arithmetic at `user-nodes-bulk-role-change.ts:151`
  - no cardinality rule for the role → returns `{ok: true}` regardless of count

These avoid a Neon hit and run fast.

### 7.3 Refactor-safety

The existing 5 tests in `tests/integration/user-nodes-bulk-role-change.test.ts` must continue to pass after the bulk endpoint refactors to consume `_shared/role-change.ts`. No changes to those test files.

### 7.4 Manual smoke (run before declaring done)

1. **Admin happy path:** Access Dashboard → click user → change role → confirm panel appears → Save → modal closes, dashboard refresh shows new role swatch + label.
2. **L1 Owner happy path:** Same flow signed in as Papa's Saloon Owner.
3. **Self-block:** Owner clicks their own user → picker is disabled with tooltip.
4. **L2 hidden:** Signed in as an L2 manager → picker absent from the form.
5. **Files-page propagation:** Open `/files` in one tab + Access Dashboard in another → change a user's role in modal → within 5s, user moves from old role-folder to new role-folder on Files page.

## 8. File touch list (implementation plan input)

**New files**
- `netlify/functions/user-nodes-role-change.ts`
- `netlify/functions/_shared/role-change.ts`
- `tests/integration/user-nodes-role-change.test.ts`
- `tests/unit/role-change-helpers.test.ts`

**Modified files**
- `src/modules/shared/team-modals/EditUserModal.tsx` — add role picker, confirm panel, save-flow extension
- `src/modules/shared/team-modals/types.ts` — add `changeRole` to `TeamMemberApi`; add `canChangeRole: boolean` to a new `TeamMemberCaps` bag (or extend `TeamMemberCopy`; decided in implementation plan)
- `src/modules/ams/components/team-modal-api.ts` — wire `changeRole`; set `canChangeRole = true`
- `src/modules/user-portal/team/team-modal-api.tsx` — wire `changeRole`; set `canChangeRole = (callerLevelNumber === 1)`
- `src/modules/ams/components/audit/op-labels.ts` — registry + `summarize()` entry for `users.role_changed`
- `netlify/functions/user-nodes-bulk-role-change.ts` — refactor to consume `_shared/role-change.ts` helpers; behavior unchanged

**No migration required.** The data model already supports this — `user_nodes.role_id` is mutable and the bulk endpoint already writes to it.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Refactor extraction breaks bulk endpoint behavior | The 5 existing bulk tests must still pass post-refactor. Unit tests on the helpers add a second layer. |
| Partial-commit confusion when identity+parent+role all change | Order is documented (§5.4). Error messages surface which step failed. |
| Admin accidentally demotes themselves via a different surface | Out of scope — this design only blocks self-change in the modal. A platform admin's role isn't a user_node role anyway (admin is a JWT kind). |
| 5s poll on `/files` feels slow | Cheap follow-up: drop `POLL_MS` from 5000 to 2000 in `ClientFilesCard.tsx`. Out of scope here — measure first. |
| L2+ removed from the picker but bulk endpoint still permits L2 bulk role change | Intentional. The new restriction is specific to single-user changes via the modal. Bulk via the multi-select bar continues to follow its existing subtree rule. |

## 10. Memory references

- `project_team_l2_promote_l1_gap.md` — partially mitigated by §3 (picker scope) and §6.3 step 4 (forbidden_role_change_scope). The underlying drag-drop variant of the gap is unchanged.
- `feedback_implementer_verify_typecheck.md` — `npm run typecheck` runs after every TS-touching commit in the implementation plan.
- `feedback_no_deploy_previews.md` and `feedback_no_push_without_approval.md` — feature branch is local-only until merged to `main` and pushed on explicit ask.
- `feedback_api_ui_error_precedence.md` — error precedence in §6.2: `forbidden_role_change_scope` is checked before `self_role_change_forbidden`, which is checked before validation errors. UI tooltips for picker disabled-state mirror this precedence.
