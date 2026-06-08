# Levels / Roles Decoupling

**Date:** 2026-06-08
**Status:** Approved — implementation plan to follow
**Predecessors:**
- [2026-06-08-edit-modal-role-change-design.md](./2026-06-08-edit-modal-role-change-design.md) §11 — the "bandaid" that removed level-allows from the single-user role-change path; this refactor finishes the job.
- [2026-06-01-access-levels-design.md](./2026-06-01-access-levels-design.md) — the permissions matrix UI that becomes the only level-bound semantic surface after this refactor.

## 1. Goal

Decouple roles from levels in the data model and the UI. After this refactor, any role can be assigned to any user at any level. Levels become purely structural positions in the hierarchy (with permissions attached); roles become orthogonal tags applied to users.

## 2. Scope

**In scope**
- Drop `client_levels.allowed_role_ids` column in migration 033.
- Remove all backend reads and writes of that column (6 endpoints + 1 shared helper).
- Remove the level-allows-role validation everywhere it remains (bulk endpoints, onboarding endpoints).
- Simplify the `LevelEditor` UI (drop role-toggle grid, add "Edit permissions →" link).
- Simplify the onboarding wizard's `LevelsStep` (no more role-binding).
- Make all role pickers (`AddUserModal`, `BulkActionBar`, already-done `EditUserModal`) show every workspace role.
- Adjust `ClientFilesCard` role-ordering to derive primary level from actual user data.
- New helper `defaultPermissionsForLevel(levelNumber, modules)`: L1 = all keys true; L2+ = `{}`.
- Delete the orphaned `validateLevelAllowsRole` helper from `_shared/role-change.ts`.

**Out of scope**
- File ACL `allowed_role_ids` (`file_allowed_roles` table, `files.ts`, `files-detail.ts`, `UploadModal.tsx`). Same column name, completely different semantics (file-level access control, not level-level role binding). Unchanged.
- The `permissions` matrix UI at `/access-levels`. Existing surface; this refactor just makes it the only level-bound semantic surface, not a new one.
- Renaming `level_number` or introducing alternative hierarchy concepts. The field stays load-bearing for `user_nodes.level_number`, drag-drop, parent picker filtering, audit.
- Cardinality rules (`client_cardinality_rules`). Constrain how many of a child role can exist under a parent role; orthogonal to level/role coupling.
- Migration of existing workspace permission configurations. L1 levels in existing workspaces keep whatever they had (some may have empty `permissions` if pre-021); admins tune in `/access-levels` as needed.

## 3. Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Migration policy | Drop `allowed_role_ids` column entirely (migration 033) | Cleanest end state. Single push deploys both halves; no transitional state in production. |
| LevelEditor UI shape | Number + optional label + "Edit permissions →" link | Single-responsibility row. Label stays optional (matches "just Level 1, Level 2" with optional friendly names). Permissions live in the existing matrix UI. |
| Onboarding wizard | "How many levels?" + optional labels; permissions defaulted at create | Minimum onboarding friction. Admin tunes permissions in `/access-levels` post-creation. |
| All role pickers | Show all workspace roles (AddUser + Bulk + Edit) | Consistency across the team-modal surface. Backend constraint goes away symmetrically. |
| New-level permission defaults | L1 = all keys enabled; L2+ = `{}` | Principle of least privilege for new deeper levels. L1 (Owner) needs full grant for the workspace to be usable. |

## 4. Data model

### 4.1 Migration 033

```sql
-- db/migrations/033_drop_client_levels_allowed_role_ids.sql
--
-- The allowed_role_ids column was a level-binds-roles constraint that no
-- longer applies after the levels/roles decoupling refactor. Roles are now
-- orthogonal to levels. The permissions JSON column (migration 021) is the
-- only level-bound semantic field.
--
-- Code-deploy precedes this migration; all consumers have already stopped
-- reading or writing the column. See spec §7 for deploy ordering.

ALTER TABLE public.client_levels DROP COLUMN allowed_role_ids;
```

Single statement. No data backfill.

### 4.2 Effective shape after refactor

```
client_levels(
  id, client_id,
  level_number,    -- numeric hierarchy position (1 = top, load-bearing)
  label,           -- optional friendly name; UI renders "Level N" if null
  permissions,     -- sparse jsonb {permission_key: true}; only semantic field
  created_at
)

client_roles(   -- unchanged
  id, client_id, key, label, color, fields, bucket_family
)

user_nodes(     -- unchanged
  id, client_id, role_id, parent_id, level_number, ...
)

client_cardinality_rules(   -- unchanged; parent_role × child_role caps stay active
  client_id, parent_role_id, child_role_id, max_children
)
```

### 4.3 Behavior change in one sentence

Roles and levels become orthogonal. Any role at any level. Hierarchy is parent-child only; `level_number` is a positional index, not a role gate.

## 5. Backend changes

### 5.1 Files modified

| File | Change |
|---|---|
| `netlify/functions/_shared/user-tree.ts` | Drop `allowed_role_ids` from `LevelRow` and the SELECT in `getClientStructure()`. |
| `netlify/functions/client-levels.ts` | POST stops accepting `allowed_role_ids`. New levels get `permissions = defaultPermissionsForLevel(level_number, modules)`. |
| `netlify/functions/client-levels-detail.ts` | PATCH stops accepting `allowed_role_ids`. |
| `netlify/functions/user-nodes-bulk.ts` | Remove level-allows fetch (~lines 62-65) and validation (~lines 126-129). Bulk invite no longer rejects "Role X not allowed at level N". |
| `netlify/functions/user-nodes-bulk-role-change.ts` | Remove the same level-allows check left untouched in the role-change feature. The `level_disallows_role` error code goes away from the bulk surface. |
| `netlify/functions/onboard-client.ts` | Stop writing `allowed_role_ids` in the levels INSERT. Set `permissions = defaultPermissionsForLevel(...)`. |
| `netlify/functions/onboard-client-bulk.ts` | Same change as `onboard-client.ts`. |

### 5.2 New helper — `netlify/functions/_shared/level-permissions.ts`

```typescript
// Default permissions JSON for a newly-created level.
// L1 = all permission keys enabled (workspace owner default).
// L2+ = empty object (admin explicitly grants in /access-levels).
//
// Permission keys are enumerated from the active Module manifests for
// the workspace — same source the /access-levels page reads.

import type { ModuleManifest } from './module-manifests';

export function defaultPermissionsForLevel(
  levelNumber: number,
  moduleManifests: ModuleManifest[],
): Record<string, boolean> {
  if (levelNumber !== 1) return {};
  const all: Record<string, boolean> = {};
  for (const manifest of moduleManifests) {
    for (const key of manifest.permissionKeys) all[key] = true;
  }
  return all;
}
```

The exact import path for `ModuleManifest` is determined during implementation — search where `/api/client-levels-permissions` reads them and reuse that source.

### 5.3 Helper removal — `netlify/functions/_shared/role-change.ts`

After `user-nodes-bulk.ts` and `user-nodes-bulk-role-change.ts` drop their level-allows calls, `validateLevelAllowsRole` has no callers. Delete the function and its result types (`LevelAllowsRoleOk`, `LevelAllowsRoleFail`, `LevelAllowsRoleResult`). `validateCardinality` and its types stay.

### 5.4 Audit

No new audit ops. Existing `level.created` and `level.updated` ops continue to fire. Audit detail shapes unchanged.

## 6. Frontend changes

### 6.1 Type changes — `src/modules/ams/api.ts`

```typescript
export interface ClientLevel {
  id: string;
  client_id: string;
  level_number: number;
  label: string | null;
  permissions: Record<string, boolean>;
  created_at: string;
  // allowed_role_ids removed
}
```

`createLevel(clientId, body)` and `patchLevel(levelId, body)` API wrappers stop accepting `allowed_role_ids` in their body parameter type. Typecheck flags every caller until updated.

### 6.2 LevelEditor — `src/modules/ams/components/LevelEditor.tsx`

**Before:** number + label + role-toggle grid (chips below each level row).
**After:** number + label + "Edit permissions →" link to `/clients/:id/access-levels?level=N`.

The `toggleRole()` function and the role-chip block disappear (~30 lines deleted). The "(no label)" placeholder span is removed — empty-label rows render as just "Level N". File net-shrinks.

### 6.3 ClientFilesCard — `src/modules/ams/components/files/ClientFilesCard.tsx`

Role-folder ordering currently derives from `level.allowed_role_ids` (lowest level where the role is permitted). After refactor:

```typescript
function primaryLevelFor(role: ClientRole, nodes: UserNode[]): number | null {
  const levels = nodes
    .filter((n) => n.role_id === role.id && n.level_number !== null)
    .map((n) => n.level_number as number);
  return levels.length === 0 ? null : Math.min(...levels);
}
```

Roles with no users sort to a "no level yet" bucket at the bottom (same place orphan roles previously sorted). For workspaces with users, ordering is unchanged in practice (a role used only at L2 still primarily sorts at L2). For empty workspaces the visible ordering is more honest — roles surface where their users actually are, not where they were permitted to be.

### 6.4 Modal pickers

`src/modules/shared/team-modals/AddUserModal.tsx` and `src/modules/shared/team-modals/BulkActionBar.tsx` — both currently filter role `<select>` options by the target level's `allowed_role_ids`. After: show all workspace roles. `AddUserModal` keeps its level `<select>` (different question); picking a level no longer narrows role options.

`EditUserModal` was already updated in Pass A of the role-change feature — no further change needed here.

### 6.5 Onboarding wizard — `src/modules/ams/components/onboarding/state.ts` + `steps/LevelsStep.tsx`

Step today: each level row has toggle-chips for roles allowed there.
Step after: each level row is just **number + optional label** with "+ Add level" / "Remove" affordances.

L1 is locked (not removable; workspace needs an owner level). L2+ are addable/removable. State shape loses `allowed_role_ids` from level entries.

```tsx
{levels.map((l) => (
  <div key={l.level_number}>
    <strong>Level {l.level_number}</strong>
    <input
      type="text"
      placeholder="Optional label (e.g. Owner, Manager)"
      value={l.label ?? ''}
      onChange={(e) => updateLabel(l.level_number, e.target.value)}
    />
    {l.level_number > 1 && <button onClick={() => removeLevel(l.level_number)}>Remove</button>}
  </div>
))}
<button onClick={addLevel}>+ Add level</button>
```

Helper text above the list: "Levels are positions in your org chart. L1 is the top (Owner). Permissions are configured after onboarding in Access Levels."

## 7. Migration sequencing

**Inverts the standing memory** `feedback_migration_before_deploy.md`. That guidance is correct for ADDITIVE migrations (adding columns before code reads them). This migration is DESTRUCTIVE (dropping a column with live readers); order must flip.

### 7.1 Safe order (code-first)

```
1. Feature branch with ALL code changes — no consumer reads or writes allowed_role_ids.
2. Run migration 033 against DEV Neon. Verify local tests pass.
3. Local merge to main → push → Netlify deploys new code.
   ↓
   Intermediate state: new code is live on prod; prod DB still has the
   allowed_role_ids column with orphan data. New code does not touch it.
   Harmless presence.
4. Run migration 033 against PROD Neon (drops the orphan column).
5. Probe + restoreSiteDeploy if needed (per feedback_netlify_new_function_404).
```

### 7.2 Why not migration-first

If the column dropped before code-deploy, the live `_shared/user-tree.ts` SELECT (which names `allowed_role_ids` explicitly) would 500 for the ~3-5 minute Netlify build window. Prod would be broken. Code-first ensures prod is never in a state where live code reads a missing column.

### 7.3 Implementer responsibility

The implementation plan MUST call out the deploy order in its task list and explicitly state that the migration step comes AFTER the code-deploy step, contradicting the additive-migration memory. Spec readers shouldn't have to re-derive this.

## 8. Testing

### 8.1 Existing test changes

| Category | Files | Change |
|---|---|---|
| Drop from fixture setup | `tests/integration/client-structure.test.ts`, `permissions-middleware.test.ts`, `user-node-auth.test.ts`, `user-nodes-crud.test.ts`, `user-nodes-move.test.ts`, `client-levels-permissions.test.ts` | Remove `allowed_role_ids: [roleId]` from level POST bodies in fixture setup. |
| Delete level-allows rejection tests | `tests/integration/user-nodes-bulk.test.ts` | Delete the "role not allowed at level" rejection test. |
| | `tests/integration/user-nodes-bulk-role-change.test.ts` | Delete the "level disallows role" rejection test. |
| Update helper unit tests | `tests/unit/role-change-helpers.test.ts` | Delete the 3 `validateLevelAllowsRole` tests; keep the 4 `validateCardinality` tests. |
| Unaffected | `tests/integration/user-nodes-role-change.test.ts` | 8 tests, all stay (test #5 already verifies the new behavior from Pass A). |

### 8.2 New tests

1. **`tests/unit/level-permissions-default.test.ts`** — three tests:
   - `defaultPermissionsForLevel(1, manifests)` returns all keys true.
   - `defaultPermissionsForLevel(2, manifests)` returns `{}`.
   - `defaultPermissionsForLevel(5, manifests)` returns `{}` (any level ≥ 2).

2. **`tests/integration/client-levels-create.test.ts`** (new file, or extend existing client-levels tests) — two tests:
   - POST `/api/client-levels` with `level_number: 1` returns a level whose `permissions` includes every key from the active module manifests, all `true`.
   - POST `/api/client-levels` with `level_number: 2` returns a level whose `permissions` is `{}`.

### 8.3 Manual smoke after deploy

1. Wizard a new workspace. Verify L1 has full permissions in `/access-levels`; verify L2 has empty.
2. Edit an existing user's role to a previously-blocked role (e.g., assign a workspace's "Doctor" to an L1 user where Doctor was previously L2-only). Should succeed.
3. AddUserModal at any level → role picker shows every workspace role.
4. BulkActionBar role change → picker shows every workspace role.
5. `/configure` → Levels: role-toggle grid is gone; "Edit permissions →" link present.
6. `/files` — role-folder ordering still sensible for workspaces with users; roles with no users at bottom.
7. Prod migration verification:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'client_levels';
   ```
   `allowed_role_ids` absent.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Existing workspaces have role/level configurations that depended on the constraint to limit user accidents | The constraint never prevented intentional misassignments via direct DB writes; existing user-nodes keep their roles unchanged. Admins regain control via `/access-levels` permissions matrix going forward. |
| Module manifest changes after this lands give new L1 levels MORE permissions than expected | Intentional — new permissions added to modules should flow to L1 by default; existing L1 levels in existing workspaces are unchanged (no retroactive grant). |
| `permissions` jsonb column exists but is empty on pre-021 levels | Out of scope for this refactor. Those levels were already broken under the access-levels feature; admins must populate via `/access-levels`. |
| The L2→Owner promotion gap (`project_team_l2_promote_l1_gap.md`) becomes a real concern again with no level-allows guard | Picker scope is admin/L1-only (locked in the role-change feature). The L2→Owner promotion gap is fixable orthogonally via the picker scope rule, NOT the level-allows guard. Memory updated accordingly. |
| Files page ordering for very empty workspaces changes visually | Documented in §6.3. Roles with no users sort to a "no level yet" bucket. Same place orphan roles already went; no new bucket. |

## 10. Memory references

- `feedback_migration_before_deploy.md` — INVERTED for this destructive migration; see §7.
- `feedback_netlify_new_function_404.md` — probe + restoreSiteDeploy after push if any new endpoint is added (none in this refactor, but Module manifest path may change).
- `feedback_implementer_verify_typecheck.md` — `npm run typecheck` after every TS-touching commit.
- `feedback_no_push_without_approval.md` — single push at end after local merge.
- `project_team_l2_promote_l1_gap.md` — now fully mitigated by picker scope rule (admin/L1 only), no longer needs the level-allows defense in depth.

## 11. File touch summary

**New files**
- `db/migrations/033_drop_client_levels_allowed_role_ids.sql`
- `netlify/functions/_shared/level-permissions.ts`
- `tests/unit/level-permissions-default.test.ts`
- `tests/integration/client-levels-create.test.ts` (or extend existing)

**Modified files (backend)**
- `netlify/functions/_shared/user-tree.ts`
- `netlify/functions/_shared/role-change.ts` (delete `validateLevelAllowsRole`)
- `netlify/functions/client-levels.ts`
- `netlify/functions/client-levels-detail.ts`
- `netlify/functions/user-nodes-bulk.ts`
- `netlify/functions/user-nodes-bulk-role-change.ts`
- `netlify/functions/onboard-client.ts`
- `netlify/functions/onboard-client-bulk.ts`

**Modified files (frontend)**
- `src/modules/ams/api.ts`
- `src/modules/ams/components/LevelEditor.tsx`
- `src/modules/ams/components/files/ClientFilesCard.tsx`
- `src/modules/shared/team-modals/AddUserModal.tsx`
- `src/modules/shared/team-modals/BulkActionBar.tsx`
- `src/modules/ams/components/onboarding/state.ts`
- `src/modules/ams/components/onboarding/steps/LevelsStep.tsx`

**Modified test files** (drop fixture column or delete tests)
- `tests/integration/client-structure.test.ts`
- `tests/integration/permissions-middleware.test.ts`
- `tests/integration/user-node-auth.test.ts`
- `tests/integration/user-nodes-crud.test.ts`
- `tests/integration/user-nodes-move.test.ts`
- `tests/integration/client-levels-permissions.test.ts`
- `tests/integration/user-nodes-bulk.test.ts`
- `tests/integration/user-nodes-bulk-role-change.test.ts`
- `tests/unit/role-change-helpers.test.ts`
