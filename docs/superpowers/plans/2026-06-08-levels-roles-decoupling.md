# Levels / Roles Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop `client_levels.allowed_role_ids`, make any role assignable at any level, simplify the LevelEditor + onboarding wizard, and inline permission defaults at level-create time (L1 = all, L2+ = none).

**Architecture:** Single feature branch, code-first deploy ordering. All backend writes/reads of `allowed_role_ids` go away in one push; migration 033 drops the column on prod Neon AFTER deploy is ready (inverts the additive-migration memory — see Task 13). New helper `defaultPermissionsForLevel(levelNumber, enabledProductKeys)` derives permission defaults from the workspace's enabled modules.

**Tech Stack:** Netlify Functions (TS), Neon Postgres, Vitest, React/Vite frontend, existing `src/modules/registry/` for module manifests, existing `_shared/permission-keys.ts` for key validation.

**Spec:** [`docs/superpowers/specs/2026-06-08-levels-roles-decoupling-design.md`](../specs/2026-06-08-levels-roles-decoupling-design.md)

**Standing rules:**
- After any TypeScript change: run `npm run typecheck`.
- Never `git push` without explicit user approval. Local commits are fine.
- Never run `npm test` casually — it hits the real Neon dev DB and takes ~135s. Each task scopes test runs to specific files.
- Migration 033 runs against PROD Neon AFTER code-deploy completes — opposite of the usual order. See Task 13.
- Co-author trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

---

## File Structure

**New files (4):**
- `db/migrations/033_drop_client_levels_allowed_role_ids.sql` — single ALTER TABLE
- `netlify/functions/_shared/level-permissions.ts` — `defaultPermissionsForLevel()` helper
- `tests/unit/level-permissions-default.test.ts` — 3 tests for the new helper
- `tests/integration/client-levels-create-defaults.test.ts` — 2 tests for endpoint defaults

**Modified backend (8):**
- `netlify/functions/_shared/user-tree.ts` — drop `allowed_role_ids` from `LevelRow` + SELECT
- `netlify/functions/_shared/role-change.ts` — delete `validateLevelAllowsRole` helper + types
- `netlify/functions/client-levels.ts` — POST: drop body field + write defaults
- `netlify/functions/client-levels-detail.ts` — PATCH: drop body field
- `netlify/functions/user-nodes-bulk.ts` — drop level-allows fetch + validation
- `netlify/functions/user-nodes-bulk-role-change.ts` — same
- `netlify/functions/onboard-client.ts` — drop `allowed_role_ids`; use defaults helper
- `netlify/functions/onboard-client-bulk.ts` — same

**Modified frontend (7):**
- `src/modules/ams/api.ts` — `ClientLevel` type loses `allowed_role_ids`
- `src/modules/ams/components/LevelEditor.tsx` — drop role-toggle grid + "(no label)" placeholder
- `src/modules/ams/components/files/ClientFilesCard.tsx` — derive primary level from data
- `src/modules/shared/team-modals/AddUserModal.tsx` — picker shows all roles
- `src/modules/shared/team-modals/BulkActionBar.tsx` — picker shows all roles
- `src/modules/ams/components/onboarding/state.ts` — drop `allowed_role_ids` from level shape
- `src/modules/ams/components/onboarding/steps/LevelsStep.tsx` — drop role-binding UI

**Modified tests (9):** fixtures drop the field; two tests get deleted entirely. See Task 12.

---

## Task 1: Helper unit tests (TDD red)

**Files:**
- Create: `tests/unit/level-permissions-default.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/level-permissions-default.test.ts
//
// Unit tests for defaultPermissionsForLevel — the level-create defaults
// helper. L1 = all valid permission keys true; L2+ = empty.

import { defaultPermissionsForLevel } from '../../netlify/functions/_shared/level-permissions';

describe('defaultPermissionsForLevel', () => {
  test('L1 with no enabled products returns ONLY platform keys, all true', () => {
    const result = defaultPermissionsForLevel(1, []);
    // 4 platform surfaces × 4 verbs = 16 keys
    const keys = Object.keys(result);
    expect(keys.length).toBe(16);
    for (const k of keys) {
      expect(k.startsWith('_platform.')).toBe(true);
      expect(result[k]).toBe(true);
    }
  });

  test('L1 with a product enabled includes that module\'s buckets and verbs', () => {
    // 'products' product brings in the 'products' module (per registry).
    const result = defaultPermissionsForLevel(1, ['products']);
    // Should include at least one module-scoped key.
    const moduleKeys = Object.keys(result).filter((k) => !k.startsWith('_platform.'));
    expect(moduleKeys.length).toBeGreaterThan(0);
    for (const k of moduleKeys) expect(result[k]).toBe(true);
  });

  test('L2 returns empty regardless of enabled products', () => {
    expect(defaultPermissionsForLevel(2, [])).toEqual({});
    expect(defaultPermissionsForLevel(2, ['products', 'booking'])).toEqual({});
  });

  test('L5 returns empty (any level ≥ 2)', () => {
    expect(defaultPermissionsForLevel(5, ['products'])).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `npx vitest run tests/unit/level-permissions-default.test.ts --no-coverage`
Expected: FAIL with `Cannot find module '../../netlify/functions/_shared/level-permissions'`.

- [ ] **Step 3: Commit (red phase)**

```bash
git add tests/unit/level-permissions-default.test.ts
git commit -m "$(cat <<'EOF'
test(level-permissions): failing unit tests for defaults helper

Red phase. Helper not implemented yet. Task 2 will green these.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Implement defaultPermissionsForLevel helper

**Files:**
- Create: `netlify/functions/_shared/level-permissions.ts`

- [ ] **Step 1: Inspect the existing permission-keys infrastructure**

Run: `sed -n '1,80p' netlify/functions/_shared/permission-keys.ts`

Note: `isValidPermissionKey(key, enabledProductKeys)` already validates a key. We can enumerate all valid keys by iterating modules × buckets × verbs + platform surfaces × verbs.

Also: `getProduct(key)` from `src/modules/registry/products` returns a product's modules. `getModule(key)` returns a module's `data_buckets` and `verbs`.

- [ ] **Step 2: Create the helper**

Create `netlify/functions/_shared/level-permissions.ts`:

```typescript
// Default permissions JSON for a newly-created level.
// L1 = all valid permission keys for the workspace's enabled products, true.
// L2+ = empty (admin explicitly grants in /access-levels).
//
// Permission keys enumerate from the active module manifests for the
// workspace's enabled products — same source the /access-levels page reads.

import { PLATFORM_SURFACES, VERBS } from '../../../src/modules/registry/types';
import { getModule, getProduct } from '../../../src/modules/registry/modules';

export function defaultPermissionsForLevel(
  levelNumber: number,
  enabledProductKeys: readonly string[],
): Record<string, boolean> {
  if (levelNumber !== 1) return {};

  const all: Record<string, boolean> = {};

  // Platform surfaces × verbs (always present, independent of products).
  for (const surface of PLATFORM_SURFACES) {
    for (const verb of VERBS) {
      all[`_platform.${surface}.${verb}`] = true;
    }
  }

  // Modules brought in by enabled products.
  const enabledModules = new Set<string>();
  for (const pKey of enabledProductKeys) {
    const product = getProduct(pKey);
    if (!product) continue;
    for (const ref of product.modules) enabledModules.add(ref.module);
  }

  for (const mKey of enabledModules) {
    const m = getModule(mKey);
    if (!m) continue;
    for (const bucket of m.data_buckets) {
      for (const verb of m.verbs) {
        all[`${m.key}.${bucket}.${verb}`] = true;
      }
    }
  }

  return all;
}
```

Note: the import path `'../../../src/modules/registry/modules'` mirrors the existing `_shared/permission-keys.ts` import style. Verify by running typecheck — if the path is wrong, look at how `permission-keys.ts:11-13` imports `getModule` and `getProduct` and match.

If `getProduct` is exported from a different file than this path implies, fix the import. The actual export location is `src/modules/registry/products.ts` (verify with `grep -n "export function getProduct" src/modules/registry/products.ts`).

- [ ] **Step 3: Run the unit tests — expect PASS**

Run: `npx vitest run tests/unit/level-permissions-default.test.ts --no-coverage`
Expected: 4 tests pass.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/level-permissions.ts
git commit -m "$(cat <<'EOF'
feat(level-permissions): defaultPermissionsForLevel helper

L1 gets all valid permission keys (platform surfaces + enabled-module
buckets, all verbs) set to true. L2+ gets {}. Drives the new-level
permission defaults via wizard, onboard endpoints, and direct POST
to /api/client-levels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Drop column reads from user-tree, client-levels, client-levels-detail

**Files:**
- Modify: `netlify/functions/_shared/user-tree.ts`
- Modify: `netlify/functions/client-levels.ts`
- Modify: `netlify/functions/client-levels-detail.ts`

The migration still hasn't run; column is present in dev Neon. After this commit, code stops reading the column but the column data is harmlessly there. This is intentional.

- [ ] **Step 1: Update user-tree.ts**

In `netlify/functions/_shared/user-tree.ts`, find the `LevelRow` interface (around line 28-33) and remove `allowed_role_ids`:

```typescript
// Before
export interface LevelRow {
  id: string;
  client_id: string;
  level_number: number;
  label: string | null;
  allowed_role_ids: string[];
  created_at: string;
}

// After
export interface LevelRow {
  id: string;
  client_id: string;
  level_number: number;
  label: string | null;
  created_at: string;
}
```

Then find the SELECT in `getClientStructure()` (around line 76-80) and remove the column:

```typescript
// Before
const levels = (await sql`
  SELECT id, client_id, level_number, label, allowed_role_ids, created_at
  FROM public.client_levels WHERE client_id = ${clientId}::uuid
  ORDER BY level_number
`) as LevelRow[];

// After
const levels = (await sql`
  SELECT id, client_id, level_number, label, created_at
  FROM public.client_levels WHERE client_id = ${clientId}::uuid
  ORDER BY level_number
`) as LevelRow[];
```

- [ ] **Step 2: Update client-levels.ts POST handler**

In `netlify/functions/client-levels.ts`, modify the Zod body schema and the INSERT.

Find the `CreateBody` definition:

```typescript
// Before
const CreateBody = z.object({
  level_number: z.number().int().positive(),
  label: z.string().min(1).max(100).optional(),
  allowed_role_ids: z.array(z.string().uuid()).default([]),
});
```

Replace with:

```typescript
const CreateBody = z.object({
  level_number: z.number().int().positive(),
  label: z.string().min(1).max(100).optional(),
});
```

Add at the top of the file (with other imports):

```typescript
import { defaultPermissionsForLevel } from './_shared/level-permissions';
```

Find the "Friendly default" block (around lines 34-43) that pre-populates `allowed_role_ids` and DELETE it entirely (the entire `if (effectiveAllowedRoleIds.length === 0)` block and the `let effectiveAllowedRoleIds = ...` line).

Then find the INSERT and replace it. The current INSERT looks like:

```typescript
const rows = (await sql`
  INSERT INTO public.client_levels (client_id, level_number, label, allowed_role_ids)
  VALUES (${clientId}::uuid, ${parsed.data.level_number},
          ${parsed.data.label ?? null}, ${effectiveAllowedRoleIds}::uuid[])
  RETURNING id, client_id, level_number, label, allowed_role_ids, created_at
`) as Array<{ id: string }>;
```

Replace with:

```typescript
// Fetch enabled product keys for this client (drives module-scoped permission defaults).
const products = (await sql`
  SELECT product_key FROM public.client_products WHERE client_id = ${clientId}::uuid AND enabled = true
`) as { product_key: string }[];
const enabledProductKeys = products.map((p) => p.product_key);
const permissions = defaultPermissionsForLevel(parsed.data.level_number, enabledProductKeys);

const rows = (await sql`
  INSERT INTO public.client_levels (client_id, level_number, label, permissions)
  VALUES (${clientId}::uuid, ${parsed.data.level_number},
          ${parsed.data.label ?? null}, ${JSON.stringify(permissions)}::jsonb)
  RETURNING id, client_id, level_number, label, permissions, created_at
`) as Array<{ id: string }>;
```

**Verify the products table:** if `public.client_products` doesn't exist with columns `(client_id, product_key, enabled)`, find the actual shape with:
```
grep -rn "client_products\|enabled_products" netlify/functions/ db/migrations/
```
…and adjust the SELECT accordingly. The intent is "which product keys are enabled for this client."

- [ ] **Step 3: Update client-levels-detail.ts PATCH handler**

In `netlify/functions/client-levels-detail.ts`, find the Zod patch body schema. It will have `allowed_role_ids` in it. Remove that field.

The current code likely looks something like:

```typescript
const PatchBody = z.object({
  label: z.string().min(1).max(100).optional(),
  allowed_role_ids: z.array(z.string().uuid()).optional(),
});
```

Replace with:

```typescript
const PatchBody = z.object({
  label: z.string().min(1).max(100).optional(),
});
```

Then find any UPDATE statement that references `allowed_role_ids` and remove that branch. Also remove any SELECT that includes `allowed_role_ids` in the columns list. After your edits, the file should have NO references to `allowed_role_ids`.

Verify with:
```
grep -n "allowed_role_ids" netlify/functions/client-levels-detail.ts
```
Should return empty.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. Frontend code may break because `ClientLevel` type still has `allowed_role_ids` — that's fine, we update it in Task 8. For now, ONLY backend files were changed; if frontend typecheck breaks, that's a sign you accidentally regenerated types from a tool. Check `git status` — only the three backend files should be modified.

- [ ] **Step 5: Run a quick smoke against an existing test that touches these endpoints**

Run: `npx vitest run tests/integration/client-structure.test.ts --no-coverage`
Expected: PASS (the test reads the structure; LevelRow no longer has allowed_role_ids but the test fixture still inserts it via direct SQL — the SELECT side just doesn't read it). If the test FAILS because of an assertion that checks `levels[0].allowed_role_ids`, note the failure but don't fix yet — Task 12 cleans up test fixtures.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/user-tree.ts netlify/functions/client-levels.ts netlify/functions/client-levels-detail.ts
git commit -m "$(cat <<'EOF'
refactor(client-levels): stop reading/writing allowed_role_ids

POST /api/client-levels now writes permissions defaults via the
defaultPermissionsForLevel helper (L1 = all keys; L2+ = {}). PATCH
no longer accepts allowed_role_ids. user-tree's getClientStructure
stops selecting the column. The column itself stays in the DB until
the prod migration in Task 13.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Drop level-allows check from user-nodes-bulk.ts

**Files:**
- Modify: `netlify/functions/user-nodes-bulk.ts`
- Modify: `tests/integration/user-nodes-bulk.test.ts` (delete the "role not allowed at level" test)

- [ ] **Step 1: Remove the level-allows fetch and validation**

In `netlify/functions/user-nodes-bulk.ts`, find this fetch block (around lines 62-65):

```typescript
const levels = (await sql`
  SELECT level_number, allowed_role_ids FROM public.client_levels WHERE client_id = ${clientId}::uuid
`) as { level_number: number; allowed_role_ids: string[] }[];
const levelByNumber = new Map(levels.map((l) => [l.level_number, l]));
```

…and DELETE it entirely.

Then find the per-row validation block (around lines 122-130):

```typescript
if (row.level_number !== null && row.level_number !== undefined) {
  const lv = levelByNumber.get(row.level_number);
  if (!lv) rowErrors.push(`Level ${row.level_number} not configured`);
  else if (roleId && !lv.allowed_role_ids.includes(roleId)) {
    rowErrors.push(`Role "${row.role_key}" not allowed at level ${row.level_number}`);
  }
}
```

Replace with a simpler "is this level number configured?" check using a fresh fetch:

```typescript
// Verify the level exists for the workspace; role-level coupling has been
// removed (any role can exist at any level). See
// docs/superpowers/specs/2026-06-08-levels-roles-decoupling-design.md.
if (row.level_number !== null && row.level_number !== undefined) {
  if (!configuredLevelNumbers.has(row.level_number)) {
    rowErrors.push(`Level ${row.level_number} not configured`);
  }
}
```

And add a fetch for configured level numbers right after the role-id-by-key map construction (in place of the deleted block):

```typescript
const configuredLevelNumbersRows = (await sql`
  SELECT level_number FROM public.client_levels WHERE client_id = ${clientId}::uuid
`) as { level_number: number }[];
const configuredLevelNumbers = new Set(configuredLevelNumbersRows.map((l) => l.level_number));
```

- [ ] **Step 2: Delete the "role not allowed at level" test**

In `tests/integration/user-nodes-bulk.test.ts`, find the test whose name contains "not allowed at level" (search: `grep -n "not allowed at level" tests/integration/user-nodes-bulk.test.ts`). Delete the entire `test(...)` block.

If multiple tests reference this rejection, delete each. The remaining bulk-invite tests stay.

- [ ] **Step 3: Run the bulk-invite tests**

Run: `npx vitest run tests/integration/user-nodes-bulk.test.ts --no-coverage`
Expected: PASS (one fewer test).

If a different test fails because its fixture inserts levels with `allowed_role_ids: [roleId]` and the column is still present (we haven't migrated yet) — that's fine, the fixture should still work since the column accepts the value. If the failure is about `allowed_role_ids` somewhere else, investigate and report.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/user-nodes-bulk.ts tests/integration/user-nodes-bulk.test.ts
git commit -m "$(cat <<'EOF'
refactor(user-nodes-bulk): drop level-allows-role validation

Bulk invite no longer rejects 'Role X not allowed at level N'. Roles
are now orthogonal to levels. The level-number existence check stays
(an invite at level 99 still fails with 'Level 99 not configured').

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Drop level-allows check from user-nodes-bulk-role-change.ts

**Files:**
- Modify: `netlify/functions/user-nodes-bulk-role-change.ts`
- Modify: `tests/integration/user-nodes-bulk-role-change.test.ts` (delete the "level disallows" test)

- [ ] **Step 1: Inspect the current shape**

Run: `sed -n '85,170p' netlify/functions/user-nodes-bulk-role-change.ts`

Expected: see the level allowed-roles fetch, level-by-number map, the per-target validation that checks `lv.allowed_role_ids.includes(new_role_id)`.

- [ ] **Step 2: Remove the level-allows fetch and validation**

Find this fetch block:

```typescript
const distinctLevels = Array.from(new Set(targets.map((t) => t.level_number).filter((n): n is number => n !== null)));
const levels = distinctLevels.length === 0 ? [] : (await sql`
  SELECT level_number, allowed_role_ids FROM public.client_levels
  WHERE client_id = ${clientId}::uuid AND level_number = ANY(${distinctLevels}::int[])
`) as { level_number: number; allowed_role_ids: string[] }[];
const levelByNumber = new Map(levels.map((l) => [l.level_number, l]));
```

…and DELETE it entirely.

Then find the per-target validation that uses `levelByNumber`:

```typescript
// Level allows the new role?
if (t.level_number !== null) {
  const lv = levelByNumber.get(t.level_number);
  if (!lv || !lv.allowed_role_ids.includes(new_role_id)) {
    errors.push({ node_id: t.id, reason: `Role not allowed at level ${t.level_number}` });
    continue;
  }
}
```

…and DELETE it (the `if (t.level_number !== null)` block and its contents).

Also find and remove the NOTE comment that was added for level-allows mirroring (from the role-change refactor):

```typescript
// Per-target validation pass.
// NOTE: semantics here MUST mirror _shared/role-change.ts's validateLevelAllowsRole
// and validateCardinality (used by user-nodes-role-change.ts). If you tighten one,
// tighten the other — they encode the same business rule.
```

Replace with just:

```typescript
// Per-target validation pass.
// Cardinality only — role-level coupling has been removed.
```

- [ ] **Step 3: Delete the "level disallows" rejection test**

In `tests/integration/user-nodes-bulk-role-change.test.ts`, find the test:

```typescript
test('pre-validation: target at level where new role is disallowed → 400, no UPDATEs', ...
```

Delete the entire `test(...)` block.

- [ ] **Step 4: Run the bulk-role-change tests**

Run: `npx vitest run tests/integration/user-nodes-bulk-role-change.test.ts --no-coverage`
Expected: PASS (one fewer test; happy path, cross-client, cardinality, cap-enforcement still green).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/user-nodes-bulk-role-change.ts tests/integration/user-nodes-bulk-role-change.test.ts
git commit -m "$(cat <<'EOF'
refactor(user-nodes-bulk-role-change): drop level-allows validation

Symmetric with the single-user endpoint's earlier removal of the same
check (in the role-change feature). Cardinality enforcement stays.
The level-disallows rejection test is deleted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update onboard-client.ts and onboard-client-bulk.ts

**Files:**
- Modify: `netlify/functions/onboard-client.ts`
- Modify: `netlify/functions/onboard-client-bulk.ts`

- [ ] **Step 1: Update onboard-client.ts**

In `netlify/functions/onboard-client.ts`, find the levels write loop (around lines 175-184):

```typescript
// 4. levels
for (const lv of levels) {
  const allowedIds = lv.allowed_role_keys.map((k) => roleIdByKey.get(k)!);
  queries.push(sql`
    INSERT INTO public.client_levels (client_id, level_number, label, allowed_role_ids)
    VALUES (${clientId}::uuid, ${lv.level_number}, ${lv.label ?? null},
            ${allowedIds}::uuid[])
  `);
}
```

Replace with:

```typescript
// 4. levels — permissions default via helper (L1 = all keys for enabled products; L2+ = {}).
const enabledProductKeys: string[] = data.enabled_products ?? [];
for (const lv of levels) {
  const permissions = defaultPermissionsForLevel(lv.level_number, enabledProductKeys);
  queries.push(sql`
    INSERT INTO public.client_levels (client_id, level_number, label, permissions)
    VALUES (${clientId}::uuid, ${lv.level_number}, ${lv.label ?? null},
            ${JSON.stringify(permissions)}::jsonb)
  `);
}
```

Add the import near the top:

```typescript
import { defaultPermissionsForLevel } from './_shared/level-permissions';
```

Also: the body's Zod schema for levels currently expects `allowed_role_keys` per level. Find that schema (search: `grep -n "allowed_role_keys" netlify/functions/onboard-client.ts`) and remove the `allowed_role_keys` field from the level item schema.

If `data.enabled_products` doesn't exist in the current body schema, look at how the existing code computes enabled products (search for `enabled_products` in the file). Use the same source.

- [ ] **Step 2: Update onboard-client-bulk.ts**

Mirror the same change in `netlify/functions/onboard-client-bulk.ts`. The structure is similar — find the levels INSERT loop and the body schema's level item. The bulk variant likely loops over per-client level data inside an outer client loop.

Same import + same INSERT replacement pattern.

- [ ] **Step 3: Run the onboarding tests**

Run: `npx vitest run tests/integration/onboard-client.test.ts tests/integration/onboard-client-bulk.test.ts --no-coverage` (the test files may have different names — find them with `ls tests/integration/ | grep -i onboard`).

Expected: PASS. If the tests pass `allowed_role_keys` in their fixture bodies and the new schema rejects unknown fields, the tests need updating. Read the Zod schema's behavior — if it uses `.strict()` it rejects extra; if not, extra fields are silently accepted. Default Zod is to allow extra silently; check.

If tests fail with "unrecognized_keys", update the test fixtures to drop `allowed_role_keys`.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/onboard-client.ts netlify/functions/onboard-client-bulk.ts
git commit -m "$(cat <<'EOF'
refactor(onboard): write permissions defaults instead of allowed_role_ids

Wizard-driven onboarding and XLSX bulk onboarding both stop accepting
allowed_role_keys per level. New levels get permissions via
defaultPermissionsForLevel (L1 = all keys for enabled products; L2+ = {}).
Admins tune in /access-levels after onboarding.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Delete validateLevelAllowsRole helper + its unit tests

**Files:**
- Modify: `netlify/functions/_shared/role-change.ts`
- Modify: `tests/unit/role-change-helpers.test.ts`

- [ ] **Step 1: Verify no callers remain**

Run: `grep -rn "validateLevelAllowsRole" netlify/functions/ src/ tests/`

Expected: ONLY the definition site (`netlify/functions/_shared/role-change.ts`) and its test file (`tests/unit/role-change-helpers.test.ts`). If any other file appears, fix that first — it should have been changed in Tasks 4-6.

- [ ] **Step 2: Delete the function and types from role-change.ts**

In `netlify/functions/_shared/role-change.ts`, delete:
- The interfaces `LevelAllowsRoleOk`, `LevelAllowsRoleFail`, `LevelAllowsRoleResult`.
- The function `validateLevelAllowsRole` and its docstring.

Keep `validateCardinality`, its types, and the file-header comment.

- [ ] **Step 3: Delete validateLevelAllowsRole tests**

In `tests/unit/role-change-helpers.test.ts`, find the `describe('validateLevelAllowsRole', ...)` block and delete it entirely (the describe block plus all 3 tests inside).

Also remove `validateLevelAllowsRole` from the imports at the top of the file.

- [ ] **Step 4: Run the remaining unit tests**

Run: `npx vitest run tests/unit/role-change-helpers.test.ts --no-coverage`
Expected: 4 tests pass (just the `validateCardinality` block).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/role-change.ts tests/unit/role-change-helpers.test.ts
git commit -m "$(cat <<'EOF'
chore(role-change): remove orphaned validateLevelAllowsRole helper

No callers after the bulk endpoints stopped enforcing level-allows.
validateCardinality stays — cardinality rules are still active.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Frontend type + LevelEditor changes

**Files:**
- Modify: `src/modules/ams/api.ts`
- Modify: `src/modules/ams/components/LevelEditor.tsx`

This is where the frontend typecheck breaks until both files are updated together.

- [ ] **Step 1: Update the ClientLevel type**

In `src/modules/ams/api.ts`, find the `ClientLevel` interface (search: `grep -n "interface ClientLevel\b\|type ClientLevel" src/modules/ams/api.ts`).

Remove the `allowed_role_ids: string[];` field. Also find the `createLevel(...)` and `patchLevel(...)` API wrapper functions and remove `allowed_role_ids` from their body parameter types.

Run typecheck — many frontend files will fail. That's expected. We fix them in this and the following tasks.

- [ ] **Step 2: Update LevelEditor.tsx — remove the toggle-grid block**

In `src/modules/ams/components/LevelEditor.tsx`:

Delete the `toggleRole` function (around lines 41-46):

```typescript
async function toggleRole(level: ClientLevel, roleId: string) {
  const next = level.allowed_role_ids.includes(roleId)
    ? level.allowed_role_ids.filter((id) => id !== roleId)
    : [...level.allowed_role_ids, roleId];
  const r = await patchLevel(level.id, { allowed_role_ids: next });
  if (!r.ok) alert(`Failed (${r.error.code})`);
  onChange();
}
```

Find the role-toggle JSX block at the bottom of each `<li>` (the `<div style={{ marginTop: 4, ... }}>` containing role chips). Delete that block entirely. Also delete the line that renders the `<span style={{ flex: 1 }} className="muted">{l.label ?? '(no label)'}</span>` — replace with:

```typescript
<span style={{ flex: 1 }} className="muted">{l.label ?? ''}</span>
```

- [ ] **Step 3: Add the "Edit permissions →" link**

In the same `<li>` block, between the label span and the edit/delete buttons, add:

```tsx
<a
  href={`/clients/${clientId}/access-levels?level=${l.level_number}`}
  className="btn btn-ghost"
  style={{ fontSize: 12 }}
>
  Edit permissions →
</a>
```

(Use `<a href>` matching surrounding routing patterns. If the file uses React Router's `<Link>`, switch to `<Link to={...}>` — check the file's imports.)

- [ ] **Step 4: Update the createLevel call**

Find:

```typescript
const r = await createLevel(clientId, { level_number, label, allowed_role_ids: [] });
```

Replace with:

```typescript
const r = await createLevel(clientId, { level_number, label });
```

- [ ] **Step 5: Remove unused `roles` prop usage**

The `roles` prop is currently used by the toggle-grid. After this task it may be unused. Check with: `grep -n "roles" src/modules/ams/components/LevelEditor.tsx`.

If `roles` is only used for the toggle grid, remove it from `Props`:

```typescript
interface Props {
  clientId: string;
  levels: ClientLevel[];
  onChange: () => void;
}
```

And then find every caller of LevelEditor (`grep -rn "<LevelEditor" src/`) and remove the `roles={roles}` prop. The caller files will need a small follow-up commit step here, OR the typecheck failure flags them.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. If any frontend file errors about `allowed_role_ids`, fix that file in this commit (it likely consumed the field for some derived UI; the new pattern is "ignore the field"). Common offenders to scan: `BulkInviteModal.tsx`, `AddUserModal.tsx`, `BulkActionBar.tsx`, `ClientFilesCard.tsx`. We update these in Tasks 9-10 — for typecheck purposes here, just stub out the reads with `[]` or remove the references.

- [ ] **Step 7: Commit**

```bash
git add src/modules/ams/api.ts src/modules/ams/components/LevelEditor.tsx
# Add any caller files you had to touch for typecheck:
# git add src/modules/ams/pages/<wherever LevelEditor is used>.tsx
git commit -m "$(cat <<'EOF'
feat(level-editor): drop role-toggle grid; add Edit permissions link

ClientLevel type loses allowed_role_ids. LevelEditor row collapses to
'Level N + optional label + Edit permissions →'. The chip toggles
disappear; permissions are tuned in the existing /access-levels matrix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: ClientFilesCard role-ordering refactor

**Files:**
- Modify: `src/modules/ams/components/files/ClientFilesCard.tsx`

- [ ] **Step 1: Locate the existing primary-level derivation**

Run: `grep -n "allowed_role_ids\|primaryLevel" src/modules/ams/components/files/ClientFilesCard.tsx`

Note where roles are sorted/grouped and how `allowed_role_ids` is used.

- [ ] **Step 2: Replace with data-driven derivation**

Find any code that maps a role to "its primary level" via `level.allowed_role_ids.includes(role.id)`. Replace the derivation with a function that looks at actual user nodes:

```typescript
// Primary level for a role = lowest level_number where a user has that role.
// Returns null if no users have this role yet — those roles fall to the bottom.
function primaryLevelFor(role: ClientRole, nodes: UserNode[]): number | null {
  let min: number | null = null;
  for (const n of nodes) {
    if (n.role_id !== role.id || n.level_number === null) continue;
    if (min === null || n.level_number < min) min = n.level_number;
  }
  return min;
}
```

Replace the role-sort/grouping code that previously read `allowed_role_ids` with a call to `primaryLevelFor(role, nodes)`. Roles with `primaryLevel === null` go to the "no level yet" bucket at the bottom (or whatever the existing "orphan" bucket is — match the existing pattern).

The `allowedLevels` field on `RoleGroup` (multiple levels a role can appear at, used for the spanning badge "(also L2)") — derive from data the same way:

```typescript
function allowedLevelsFor(role: ClientRole, nodes: UserNode[]): number[] {
  const set = new Set<number>();
  for (const n of nodes) {
    if (n.role_id === role.id && n.level_number !== null) set.add(n.level_number);
  }
  return Array.from(set).sort((a, b) => a - b);
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/ams/components/files/ClientFilesCard.tsx
git commit -m "$(cat <<'EOF'
refactor(files-card): derive role primary level from user data

allowed_role_ids is gone. The Files page now sorts roles by the
lowest level_number where a user with that role lives. Roles with
no users fall to the existing 'no level yet' bucket.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: AddUserModal + BulkActionBar — drop level filter on role pickers

**Files:**
- Modify: `src/modules/shared/team-modals/AddUserModal.tsx`
- Modify: `src/modules/shared/team-modals/BulkActionBar.tsx`

- [ ] **Step 1: Update AddUserModal**

In `src/modules/shared/team-modals/AddUserModal.tsx`, find the code that filters roles by `level.allowed_role_ids`. Pattern likely:

```typescript
const allowedRoleIds = levels.find((l) => l.level_number === selectedLevel)?.allowed_role_ids ?? [];
const pickableRoles = roles.filter((r) => allowedRoleIds.includes(r.id));
```

Replace with:

```typescript
// Any role can be assigned at any level. See
// docs/superpowers/specs/2026-06-08-levels-roles-decoupling-design.md.
const pickableRoles = roles;
```

If the role `<select>` previously rendered an empty list when no level was selected (because `allowedRoleIds` was empty), that behavior should now show all roles regardless. Verify the JSX maps from `pickableRoles`.

Also clean up any unused imports or props that came from the level filter (e.g., a `levels` prop the modal received only to derive `allowedRoleIds`). If `levels` is still used for the level picker itself (the "what level is the new user at?" question), keep it; only the filter derivation goes away.

- [ ] **Step 2: Update BulkActionBar**

In `src/modules/shared/team-modals/BulkActionBar.tsx`, find the role picker for bulk role-change. It will have a similar level-filter pattern. Replace with showing all roles.

If the bulk action bar's role picker was rendered only when all selected nodes had the same `level_number` (to know which level to filter by), that gating logic is no longer needed — the picker should show in all cases where at least one node is selected. Simplify accordingly.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/shared/team-modals/AddUserModal.tsx src/modules/shared/team-modals/BulkActionBar.tsx
git commit -m "$(cat <<'EOF'
feat(team-modals): role pickers show all workspace roles

AddUserModal and BulkActionBar stop filtering the role picker by
the target level's allowed_role_ids. EditUserModal already shipped
this in the role-change feature; the surface is now consistent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Onboarding wizard — simplify LevelsStep

**Files:**
- Modify: `src/modules/ams/components/onboarding/state.ts`
- Modify: `src/modules/ams/components/onboarding/steps/LevelsStep.tsx`

- [ ] **Step 1: Update wizard state shape**

In `src/modules/ams/components/onboarding/state.ts`, find the level entry type. It will have something like:

```typescript
interface WizardLevel {
  level_number: number;
  label: string | null;
  allowed_role_keys: string[];
}
```

Remove `allowed_role_keys`:

```typescript
interface WizardLevel {
  level_number: number;
  label: string | null;
}
```

Also find any reducer/action that mutates `allowed_role_keys` (e.g., `TOGGLE_ROLE_AT_LEVEL`) and delete it.

- [ ] **Step 2: Simplify LevelsStep.tsx**

In `src/modules/ams/components/onboarding/steps/LevelsStep.tsx`, locate the role-toggle UI for each level row. Delete it entirely.

Replace the level-row body with just the level number + optional label input:

```tsx
{levels.map((l) => (
  <div key={l.level_number} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
    <strong style={{ flex: '0 0 80px' }}>Level {l.level_number}</strong>
    <input
      type="text"
      placeholder="Optional label (e.g. Owner, Manager)"
      value={l.label ?? ''}
      onChange={(e) => updateLabel(l.level_number, e.target.value || null)}
      style={{ flex: 1 }}
    />
    {l.level_number > 1 && (
      <button className="btn btn-ghost" onClick={() => removeLevel(l.level_number)} title="Remove">
        ×
      </button>
    )}
  </div>
))}
<button className="btn btn-secondary" onClick={addLevel}>+ Add level</button>
```

(Adjust to match the file's actual style/component imports.)

Also add a helper text at the top of the step:

```tsx
<p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
  Levels are positions in your org chart. L1 is the top (Owner). Permissions are
  configured after onboarding in Access Levels.
</p>
```

L1 must always exist; the "Remove" button is hidden for `level_number === 1`. The "Add level" button creates a new level at `max(levels) + 1`.

- [ ] **Step 3: Update the wizard's submit payload**

If the wizard's submit handler serializes levels with `allowed_role_keys: lv.allowed_role_keys` for the onboard-client POST body, remove that field from the serialization. The new onboard-client.ts body schema doesn't accept it (per Task 6).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ams/components/onboarding/state.ts src/modules/ams/components/onboarding/steps/LevelsStep.tsx
# Add the wizard step orchestrator if its serialization needed updating:
# git add src/modules/ams/components/onboarding/<orchestrator>.tsx
git commit -m "$(cat <<'EOF'
feat(onboarding-wizard): drop role-binding from LevelsStep

LevelsStep collapses to 'how many levels + optional labels'. The
role-toggle chips are gone. Permissions get sensible defaults at
create time via defaultPermissionsForLevel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Test fixture cleanup

**Files:**
- Modify: `tests/integration/client-structure.test.ts`
- Modify: `tests/integration/permissions-middleware.test.ts`
- Modify: `tests/integration/user-node-auth.test.ts`
- Modify: `tests/integration/user-nodes-crud.test.ts`
- Modify: `tests/integration/user-nodes-move.test.ts`
- Modify: `tests/integration/client-levels-permissions.test.ts`

These tests' fixtures POST to `/api/client-levels` with `allowed_role_ids: [roleId]` in the body. The endpoint no longer accepts that field, AND the migration will drop the column. We drop it from every fixture now (before the migration runs locally).

- [ ] **Step 1: Locate and remove the field from every fixture**

For each file in the list above, find every POST to `/api/client-levels` and remove the `allowed_role_ids` field from the JSON body. Pattern to find:

```
grep -n "allowed_role_ids" tests/integration/client-structure.test.ts tests/integration/permissions-middleware.test.ts tests/integration/user-node-auth.test.ts tests/integration/user-nodes-crud.test.ts tests/integration/user-nodes-move.test.ts tests/integration/client-levels-permissions.test.ts
```

For each hit, edit the JSON body string and remove the field. Example:

```typescript
// Before
body: JSON.stringify({ level_number: 1, label: 'Top', allowed_role_ids: [roleShop] }),

// After
body: JSON.stringify({ level_number: 1, label: 'Top' }),
```

Repeat for every match.

Also check for any assertions that READ `level.allowed_role_ids` from a response (`expect(level.allowed_role_ids).toBe(...)`). Those assertions should be deleted — the field is gone from the response.

- [ ] **Step 2: Run each updated test file**

```bash
npx vitest run \
  tests/integration/client-structure.test.ts \
  tests/integration/permissions-middleware.test.ts \
  tests/integration/user-node-auth.test.ts \
  tests/integration/user-nodes-crud.test.ts \
  tests/integration/user-nodes-move.test.ts \
  tests/integration/client-levels-permissions.test.ts \
  --no-coverage
```

Expected: all pass. If any fail because they assert on `allowed_role_ids`, finish removing those assertions and re-run.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/client-structure.test.ts tests/integration/permissions-middleware.test.ts tests/integration/user-node-auth.test.ts tests/integration/user-nodes-crud.test.ts tests/integration/user-nodes-move.test.ts tests/integration/client-levels-permissions.test.ts
git commit -m "$(cat <<'EOF'
test: drop allowed_role_ids from level fixtures

Six integration test files updated to stop sending allowed_role_ids
in their POST /api/client-levels fixture bodies. Endpoint no longer
accepts the field; migration 033 will drop the column.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Integration test for new-level defaults + migration file

**Files:**
- Create: `tests/integration/client-levels-create-defaults.test.ts`
- Create: `db/migrations/033_drop_client_levels_allowed_role_ids.sql`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/client-levels-create-defaults.test.ts`:

```typescript
// tests/integration/client-levels-create-defaults.test.ts
//
// Verify POST /api/client-levels writes permission defaults correctly:
// L1 = all keys for enabled products true; L2+ = empty {}.

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientLevelsHandler from '../../netlify/functions/client-levels';

const ADMIN_EMAIL = `level-defaults-test-${Date.now()}@example.com`;
const ADMIN_PASSWORD = 'level-defaults-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let clientId: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Level Defaults Test', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  cookie = lr.headers.get('set-cookie')!.split(';')[0]!;
  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `Level Defaults ${Date.now()}-${Math.random()}` }),
    }), CTX,
  );
  clientId = (await cr.json() as { client: { id: string } }).client.id;
  created.push(clientId);
});

afterAll(async () => {
  for (const id of created) { try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ } }
});

describe('POST /api/client-levels — permission defaults', () => {
  test('L1 returns a level with all platform keys true (no products enabled)', async () => {
    const r = await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 1, label: 'Top' }),
      }), CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { level: { permissions: Record<string, boolean> } };
    const keys = Object.keys(body.level.permissions);
    // At minimum, platform surfaces × verbs = 16 keys, all true.
    expect(keys.length).toBeGreaterThanOrEqual(16);
    for (const k of keys) {
      expect(body.level.permissions[k]).toBe(true);
    }
    // All platform keys present.
    expect(keys).toContain('_platform.users.edit');
    expect(keys).toContain('_platform.users.view');
    expect(keys).toContain('_platform.structure.view');
    expect(keys).toContain('_platform.files.view');
  });

  test('L2 returns a level with empty permissions {}', async () => {
    const r = await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 2, label: 'Manager' }),
      }), CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { level: { permissions: Record<string, boolean> } };
    expect(body.level.permissions).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test — expect PASS already**

Run: `npx vitest run tests/integration/client-levels-create-defaults.test.ts --no-coverage`
Expected: PASS (the endpoint was already updated in Task 3 to write the defaults).

If the test FAILS because the existing column `allowed_role_ids` requires a non-null value, you have two paths:
- Run the migration on dev Neon NOW (next step) and re-run the test.
- Or skip this test until after the migration runs locally.

Recommended: run the migration first, then this test.

- [ ] **Step 3: Create the migration file**

Create `db/migrations/033_drop_client_levels_allowed_role_ids.sql`:

```sql
-- 033_drop_client_levels_allowed_role_ids.sql
--
-- The allowed_role_ids column was a level-binds-roles constraint that no
-- longer applies after the 2026-06-08 levels/roles decoupling refactor.
-- Roles are now orthogonal to levels — any role can be assigned at any
-- level. The permissions JSON column (added in migration 021) is the only
-- level-bound semantic field.
--
-- Code-deploy precedes this migration; all consumers have already stopped
-- reading or writing the column.

ALTER TABLE public.client_levels DROP COLUMN allowed_role_ids;
```

- [ ] **Step 4: Run the migration against DEV Neon**

```bash
npm run migrate
```

Expected: migration 033 applied. Verify with:

```bash
npm run migrate -- --status
```

Should show 033 as applied. Or query the schema directly:

```bash
DATABASE_URL=$(grep -E '^DATABASE_URL' .env | cut -d= -f2-) psql "$DATABASE_URL" -c "\d public.client_levels"
```

Expected: `allowed_role_ids` absent from the column list.

- [ ] **Step 5: Re-run the defaults test against the migrated dev DB**

Run: `npx vitest run tests/integration/client-levels-create-defaults.test.ts --no-coverage`
Expected: 2 tests pass.

- [ ] **Step 6: Run the full role-change integration suite to verify no regressions**

Run: `npx vitest run tests/integration/user-nodes-role-change.test.ts tests/integration/user-nodes-bulk-role-change.test.ts tests/integration/user-nodes-bulk.test.ts --no-coverage`

Expected: all green.

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit the test + migration together**

```bash
git add tests/integration/client-levels-create-defaults.test.ts db/migrations/033_drop_client_levels_allowed_role_ids.sql
git commit -m "$(cat <<'EOF'
feat(levels): drop allowed_role_ids column (migration 033)

Migration 033 drops the column on prod Neon AFTER this branch's
code-deploy is ready. Locally the migration ran against dev Neon
before this commit. Two integration tests pin the L1/L2 permission
defaults behavior on the create endpoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Deploy sequence (manual; runs after all prior tasks)

**Files:** none changed.

This task is the manual deploy step. The implementer (or controller) executes it AFTER all preceding tasks are committed.

- [ ] **Step 1: Sanity-check local state**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol Data Collection App"
git status                                # clean working tree
git branch --show-current                 # feat/levels-roles-decoupling
git log --oneline main..HEAD             # 13 commits (Tasks 1-13)
npm run typecheck                         # PASS
```

- [ ] **Step 2: Run the full targeted test suite once locally**

```bash
npx vitest run \
  tests/unit/level-permissions-default.test.ts \
  tests/unit/role-change-helpers.test.ts \
  tests/integration/client-levels-create-defaults.test.ts \
  tests/integration/client-structure.test.ts \
  tests/integration/client-levels-permissions.test.ts \
  tests/integration/user-nodes-bulk.test.ts \
  tests/integration/user-nodes-bulk-role-change.test.ts \
  tests/integration/user-nodes-role-change.test.ts \
  tests/integration/user-nodes-crud.test.ts \
  tests/integration/user-nodes-move.test.ts \
  tests/integration/user-node-auth.test.ts \
  tests/integration/permissions-middleware.test.ts \
  --no-coverage
```

All green required before proceeding.

- [ ] **Step 3: Local merge into main**

```bash
git checkout main
git pull origin main --ff-only            # ensure local main is fresh
git merge --no-ff feat/levels-roles-decoupling -m "$(cat <<'EOF'
Merge branch 'feat/levels-roles-decoupling' into main

Drops client_levels.allowed_role_ids (migration 033, applied to prod
Neon AFTER this push lands — see spec §7). Roles are now orthogonal
to levels. LevelEditor + onboarding wizard simplified. All role
pickers show every workspace role. Level-create writes permission
defaults via defaultPermissionsForLevel (L1 = all, L2+ = {}).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push to origin (triggers prod Netlify build)**

**STOP — get explicit user approval before this push.** Per `feedback_no_push_without_approval.md`, never push without an explicit user "push" signal. Surface the readiness state and wait.

After approval:

```bash
git push origin main
```

- [ ] **Step 5: Watch the deploy**

Start a background watcher:

```bash
echo "Polling Netlify deploy state every 30s..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  state=$(npx netlify api listSiteDeploys --data '{"site_id": "6d53c9bf-d6a7-4fb4-a16e-e5a4e94f59b4"}' 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('state','?'))" 2>/dev/null)
  echo "$(date +%H:%M:%S) deploy state: $state"
  if [ "$state" = "ready" ]; then
    echo "Deploy ready. Probing /api/client-levels (expect 401 or 405, NOT 404)..."
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST https://exsoldatacollectionapp.netlify.app/api/client-levels -H "Content-Type: application/json" -d '{}')
    echo "GET probe code: $code"
    break
  fi
  sleep 30
done
```

If the probe returns 404, run `restoreSiteDeploy` per `feedback_netlify_new_function_404.md`:

```bash
DEPLOY_ID=$(npx netlify api listSiteDeploys --data '{"site_id": "6d53c9bf-d6a7-4fb4-a16e-e5a4e94f59b4"}' 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'])")
npx netlify api restoreSiteDeploy --data "{\"site_id\": \"6d53c9bf-d6a7-4fb4-a16e-e5a4e94f59b4\", \"deploy_id\": \"$DEPLOY_ID\"}"
```

- [ ] **Step 6: Run migration 033 against PROD Neon (the destructive step)**

Per `feedback_verify_neon_endpoint_before_drop.md`, echo the host first:

```bash
PROD_DB_URL="<paste the prod connection string here OR set via the Netlify env var pull>"
echo "$PROD_DB_URL" | sed 's|.*@\([^/]*\)/.*|\1|'   # show host
```

The host should be `ep-dawn-bird-aojs8xxb-pooler.c-2.ap-southeast-1.aws.neon.tech` (PROD), NOT `ep-bold-wildflower-...` (dev).

If verified:

```bash
DATABASE_URL="$PROD_DB_URL" npm run migrate
```

Expected: migration 033 applied to prod. Verify:

```bash
DATABASE_URL="$PROD_DB_URL" psql -c "\d public.client_levels"
```

`allowed_role_ids` absent.

- [ ] **Step 7: Manual smoke on prod**

Open https://exsoldatacollectionapp.netlify.app and run the 7 manual smoke scenarios from spec §8.3:

1. Wizard a new workspace → L1 has full permissions in `/access-levels`; L2 has empty.
2. Edit an existing user's role to a previously-blocked role.
3. AddUserModal at any level → all roles in picker.
4. BulkActionBar role change → all roles in picker.
5. `/configure` → Levels: role-toggle grid gone; "Edit permissions →" link present.
6. `/files` — role-folder ordering still sensible.
7. SQL: `allowed_role_ids` column absent.

- [ ] **Step 8: Delete the merged feature branch**

```bash
git branch -d feat/levels-roles-decoupling
```

(Remote delete unnecessary — branch was never pushed per the no-deploy-previews rule.)

---

## Done criteria

- 14 tasks committed locally on `feat/levels-roles-decoupling`.
- `npm run typecheck` exits 0.
- Targeted test suite (~17 files) all green; new test counts: 4 unit (defaults) + 2 integration (create defaults) added; 1 unit (`validateLevelAllowsRole`) + 2 integration (bulk level-disallows × 2) deleted.
- Working tree clean apart from known untracked files.
- Branch merged into local main; pushed to origin/main after explicit user approval.
- Migration 033 applied to prod Neon AFTER deploy ready.
- Prod manual smoke scenarios 1-7 all pass.
- `allowed_role_ids` column gone from prod.

## Out-of-scope follow-ups

- File ACL `allowed_role_ids` cleanup (different column on `file_allowed_roles`, file-tier permissions) — unchanged here.
- Drop the now-empty `permissions` defaults on existing pre-021 levels — admins tune in `/access-levels`.
- Migrate the existing audit log row format for `level.created` — unchanged here.
- Remove `client_levels.label` if you eventually decide labels are pure noise — stays for now (matches "optional friendly name" decision).
