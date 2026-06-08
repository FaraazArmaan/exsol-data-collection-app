# Edit User Modal — Role Change — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Admin and L1 Owner change a user's role from inside the shared `EditUserModal`, alongside identity and parent edits. Role changes propagate to `/files` via the existing 5s poll.

**Architecture:** Extract validation helpers (level-allows, cardinality) from `user-nodes-bulk-role-change.ts` into a shared module. Add a new single-user `POST /api/user-nodes-role-change` endpoint that consumes those helpers and adds a stricter permission gate (admin + L1 only, plus self-block). Extend `TeamMemberApi` with `changeRole`. Add a role `<select>` and inline confirm panel to `EditUserModal`. New audit op `users.role_changed`.

**Tech Stack:** Netlify Functions (TS), Neon Postgres, Vitest, React/Vite frontend, zod for input validation, existing `_shared/permissions.ts` + `_shared/audit.ts` infrastructure.

**Spec:** [`docs/superpowers/specs/2026-06-08-edit-modal-role-change-design.md`](../specs/2026-06-08-edit-modal-role-change-design.md)

**Standing rules:**
- After any TypeScript change: run `npm run typecheck`.
- Never `git push` without explicit user approval. Local commits are fine.
- Never run `npm test` casually — it hits the real Neon dev DB and takes ~135s. Each task below scopes test runs to the new files only via `npx vitest run <path> --no-coverage`.
- Each step is ~2-5 minutes. Frequent commits.

---

## File Structure

**New files:**
- `netlify/functions/_shared/role-change.ts` — validation helpers (`validateLevelAllowsRole`, `validateCardinality`)
- `netlify/functions/user-nodes-role-change.ts` — single-user role-change endpoint
- `tests/unit/role-change-helpers.test.ts` — unit tests for the two helpers
- `tests/integration/user-nodes-role-change.test.ts` — 8 integration tests for the endpoint

**Modified files:**
- `netlify/functions/user-nodes-bulk-role-change.ts` — refactor to consume `_shared/role-change.ts`; behavior unchanged
- `src/modules/shared/team-modals/types.ts` — add `changeRole` to `TeamMemberApi`, add `canChangeRole: boolean` to a new `TeamMemberCaps` interface
- `src/modules/shared/team-modals/EditUserModal.tsx` — role picker, confirm panel, save-flow extension
- `src/modules/ams/components/team-modal-api.ts` — wire `changeRole`, set `canChangeRole: true`
- `src/modules/user-portal/team/team-modal-api.tsx` — wire `changeRole`, set `canChangeRole = (callerLevelNumber === 1)`
- `src/modules/ams/components/audit/op-labels.ts` — add registry entry and `summarize()` case for `users.role_changed`
- Call sites of `EditUserModal` in `AccessDashboard.tsx` and `UserManageTeam.tsx` — pass the new `caps` prop

---

## Task 1: Extract validation helpers (refactor; behavior-preserving)

**Files:**
- Create: `netlify/functions/_shared/role-change.ts`
- Modify: `netlify/functions/user-nodes-bulk-role-change.ts:91-159`

The bulk endpoint's level-allows check and cardinality projection move into a shared module. No semantic change; the existing 5 bulk tests prove behavior preservation.

- [ ] **Step 1: Inspect the current bulk endpoint to confirm extraction boundaries**

Run: `sed -n '85,165p' netlify/functions/user-nodes-bulk-role-change.ts`

Expected: see lines that fetch level rows, fetch cardinality rules, define `capFor`, fetch existing counts, fetch parent role ids, and the per-target validation loop.

- [ ] **Step 2: Create the helper module**

Create `netlify/functions/_shared/role-change.ts`:

```typescript
// Shared validators for single-user and bulk role-change endpoints.
// Lifted from user-nodes-bulk-role-change.ts to keep validation identical
// across both code paths. No new behavior here.

import type { neon } from '@neondatabase/serverless';

type SQL = ReturnType<typeof neon>;

export interface LevelAllowsRoleOk { ok: true }
export interface LevelAllowsRoleFail { ok: false; code: 'level_disallows_role' }
export type LevelAllowsRoleResult = LevelAllowsRoleOk | LevelAllowsRoleFail;

/**
 * Returns ok when the new role is in `client_levels.allowed_role_ids` for the
 * given level. Caller is expected to have already verified the role belongs
 * to the client.
 */
export async function validateLevelAllowsRole(
  sql: SQL,
  clientId: string,
  levelNumber: number,
  newRoleId: string,
): Promise<LevelAllowsRoleResult> {
  const rows = (await sql`
    SELECT allowed_role_ids FROM public.client_levels
    WHERE client_id = ${clientId}::uuid AND level_number = ${levelNumber}
    LIMIT 1
  `) as { allowed_role_ids: string[] }[];
  if (rows.length === 0 || !rows[0]!.allowed_role_ids.includes(newRoleId)) {
    return { ok: false, code: 'level_disallows_role' };
  }
  return { ok: true };
}

export interface CardinalityOk { ok: true }
export interface CardinalityFail { ok: false; code: 'cardinality_exceeded'; max: number }
export type CardinalityResult = CardinalityOk | CardinalityFail;

/**
 * Project the per-parent count of `newRoleId` after the role change and
 * compare to the configured cap. Returns ok if no rule applies. The
 * `currentRoleId` argument is used to avoid double-counting a target that
 * is already in the new-role cohort under the same parent.
 */
export async function validateCardinality(
  sql: SQL,
  clientId: string,
  parentId: string | null,
  newRoleId: string,
  currentRoleId: string,
): Promise<CardinalityResult> {
  // Fetch the rule for (parent_role_id, new_role_id). parent_role_id is
  // resolved from parentId; root-level uses null.
  let parentRoleId: string | null = null;
  if (parentId !== null) {
    const r = (await sql`
      SELECT role_id FROM public.user_nodes WHERE id = ${parentId}::uuid LIMIT 1
    `) as { role_id: string }[];
    if (r.length === 0) return { ok: true }; // parent vanished — caller will fail elsewhere
    parentRoleId = r[0]!.role_id;
  }
  const rules = (await sql`
    SELECT max_children FROM public.client_cardinality_rules
    WHERE client_id = ${clientId}::uuid
      AND child_role_id = ${newRoleId}::uuid
      AND (
        (parent_role_id IS NULL AND ${parentRoleId === null}::boolean)
        OR parent_role_id = ${parentRoleId}::uuid
      )
    LIMIT 1
  `) as { max_children: number }[];
  if (rules.length === 0) return { ok: true };
  const cap = rules[0]!.max_children;

  // Existing count of newRoleId under this parent.
  const counts = (await sql`
    SELECT count(*)::int AS c FROM public.user_nodes
    WHERE client_id = ${clientId}::uuid
      AND role_id = ${newRoleId}::uuid
      AND (
        (parent_id IS NULL AND ${parentId === null}::boolean)
        OR parent_id = ${parentId}::uuid
      )
  `) as { c: number }[];
  const existing = counts[0]?.c ?? 0;
  // If the target is already in the new-role cohort under this parent,
  // the change is a no-op and shouldn't increase the count.
  const wasCounted = currentRoleId === newRoleId ? 1 : 0;
  const projected = existing - wasCounted + 1;
  if (projected > cap) return { ok: false, code: 'cardinality_exceeded', max: cap };
  return { ok: true };
}
```

- [ ] **Step 3: Add a discoverability comment in the bulk endpoint (no behavior change)**

The bulk endpoint keeps its existing batched approach for performance — calling per-target helpers in a hot loop would introduce N+1 queries. The helper module exists so the single-user endpoint shares the exact rule. To prevent the two implementations from drifting silently, add a comment at the top of the per-target validation loop in `netlify/functions/user-nodes-bulk-role-change.ts` (find the `// Per-target validation pass.` line near line 131) and replace it with:

```typescript
  // Per-target validation pass.
  // NOTE: semantics here MUST mirror _shared/role-change.ts's validateLevelAllowsRole
  // and validateCardinality (used by user-nodes-role-change.ts). If you tighten one,
  // tighten the other — they encode the same business rule.
```

No import is added to the bulk file; no functional code is changed.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 5: Run the existing bulk tests to verify no regression**

Run: `npx vitest run tests/integration/user-nodes-bulk-role-change.test.ts --no-coverage`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/role-change.ts netlify/functions/user-nodes-bulk-role-change.ts
git commit -m "refactor(role-change): extract shared validators

No behavior change. New _shared/role-change.ts hosts validateLevelAllowsRole
and validateCardinality with the same semantics as the bulk endpoint's
existing per-target validation. The single-user endpoint added in the
next commits consumes these helpers."
```

---

## Task 2: Unit tests for the shared helpers

**Files:**
- Create: `tests/unit/role-change-helpers.test.ts`

Six focused unit tests across both helpers. Uses real Neon dev DB (fast, since each test does ≤2 SELECTs).

- [ ] **Step 1: Write the test file**

Create `tests/unit/role-change-helpers.test.ts`:

```typescript
// tests/unit/role-change-helpers.test.ts
//
// Unit-scope tests for the validators shared between user-nodes-role-change
// and user-nodes-bulk-role-change. Real Neon dev DB; each test isolates via
// a per-suite fixture client.

import { neon } from '@neondatabase/serverless';
import { validateLevelAllowsRole, validateCardinality } from '../../netlify/functions/_shared/role-change';

let sql: ReturnType<typeof neon>;
let clientId: string;
let roleA: string;
let roleB: string;
let roleParent: string;
const createdClients: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  // Minimal fixture: one client, three roles, one level with [roleA] allowed,
  // one cardinality rule capping roleA under roleParent at 2.
  const c = (await sql`
    INSERT INTO public.clients (name, slug)
    VALUES (${'role-change-helpers-' + Date.now()}, ${'rch-' + Date.now()})
    RETURNING id
  `) as { id: string }[];
  clientId = c[0]!.id;
  createdClients.push(clientId);
  const rp = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientId}::uuid, 'parent', 'Parent', '#000') RETURNING id
  `) as { id: string }[];
  roleParent = rp[0]!.id;
  const ra = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientId}::uuid, 'roleA', 'A', '#111') RETURNING id
  `) as { id: string }[];
  roleA = ra[0]!.id;
  const rb = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientId}::uuid, 'roleB', 'B', '#222') RETURNING id
  `) as { id: string }[];
  roleB = rb[0]!.id;
  await sql`
    INSERT INTO public.client_levels (client_id, level_number, label, allowed_role_ids)
    VALUES (${clientId}::uuid, 2, 'L2', ARRAY[${roleA}::uuid])
  `;
  await sql`
    INSERT INTO public.client_cardinality_rules (client_id, parent_role_id, child_role_id, max_children)
    VALUES (${clientId}::uuid, ${roleParent}::uuid, ${roleA}::uuid, 2)
  `;
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('validateLevelAllowsRole', () => {
  test('returns ok when role is in allowed_role_ids', async () => {
    const r = await validateLevelAllowsRole(sql, clientId, 2, roleA);
    expect(r.ok).toBe(true);
  });

  test('returns level_disallows_role when role is not in allowed_role_ids', async () => {
    const r = await validateLevelAllowsRole(sql, clientId, 2, roleB);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('level_disallows_role');
  });

  test('returns level_disallows_role when level does not exist', async () => {
    const r = await validateLevelAllowsRole(sql, clientId, 99, roleA);
    expect(r.ok).toBe(false);
  });
});

describe('validateCardinality', () => {
  test('returns ok when no cardinality rule exists for the (parent_role, new_role) pair', async () => {
    // No rule for (roleParent → roleB). Capless ⇒ ok.
    const parent = (await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleParent}::uuid, 1, NULL, 'parent', '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const parentId = parent[0]!.id;
    const r = await validateCardinality(sql, clientId, parentId, roleB, roleA);
    expect(r.ok).toBe(true);
    await sql`DELETE FROM public.user_nodes WHERE id = ${parentId}::uuid`;
  });

  test('returns ok when projected count is at or below the cap', async () => {
    const parent = (await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleParent}::uuid, 1, NULL, 'parent', '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const parentId = parent[0]!.id;
    // One existing roleA child; new arrival would make 2 (cap is 2).
    await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleA}::uuid, 2, ${parentId}::uuid, 'child1', '{}'::jsonb)
    `;
    // Target is currently roleB under parentId — projected post-change = 1 + 1 = 2.
    const r = await validateCardinality(sql, clientId, parentId, roleA, roleB);
    expect(r.ok).toBe(true);
    await sql`DELETE FROM public.user_nodes WHERE parent_id = ${parentId}::uuid OR id = ${parentId}::uuid`;
  });

  test('returns cardinality_exceeded with max when projected count exceeds cap', async () => {
    const parent = (await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleParent}::uuid, 1, NULL, 'parent', '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const parentId = parent[0]!.id;
    // Two existing roleA children; a third would exceed.
    await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleA}::uuid, 2, ${parentId}::uuid, 'c1', '{}'::jsonb),
             (${clientId}::uuid, ${roleA}::uuid, 2, ${parentId}::uuid, 'c2', '{}'::jsonb)
    `;
    const r = await validateCardinality(sql, clientId, parentId, roleA, roleB);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('cardinality_exceeded'); expect(r.max).toBe(2); }
    await sql`DELETE FROM public.user_nodes WHERE parent_id = ${parentId}::uuid OR id = ${parentId}::uuid`;
  });

  test('does NOT double-count a target already in the new-role cohort under same parent', async () => {
    const parent = (await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleParent}::uuid, 1, NULL, 'parent', '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const parentId = parent[0]!.id;
    // Two existing roleA children; one of them IS the target (currentRoleId = roleA).
    // Projected = 2 - 1 + 1 = 2 ≤ cap 2 → ok.
    await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleA}::uuid, 2, ${parentId}::uuid, 'c1', '{}'::jsonb),
             (${clientId}::uuid, ${roleA}::uuid, 2, ${parentId}::uuid, 'c2', '{}'::jsonb)
    `;
    const r = await validateCardinality(sql, clientId, parentId, roleA, roleA);
    expect(r.ok).toBe(true);
    await sql`DELETE FROM public.user_nodes WHERE parent_id = ${parentId}::uuid OR id = ${parentId}::uuid`;
  });
});
```

- [ ] **Step 2: Run the unit tests**

Run: `npx vitest run tests/unit/role-change-helpers.test.ts --no-coverage`
Expected: 6 tests pass.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/role-change-helpers.test.ts
git commit -m "test(role-change): unit tests for shared validators

Six tests covering validateLevelAllowsRole (3) and validateCardinality (3).
Includes the wasCounted no-double-count case explicitly to guard against
a regression in the role-already-matches branch."
```

---

## Task 3: New endpoint — write the failing integration test for the happy path

**Files:**
- Create: `tests/integration/user-nodes-role-change.test.ts` (with one test for now; later tasks add the other 7)
- Reference (do NOT create yet): `netlify/functions/user-nodes-role-change.ts`

TDD: write a failing test pinning down the happy path, then implement.

- [ ] **Step 1: Create the integration test file with one happy-path test**

Create `tests/integration/user-nodes-role-change.test.ts`:

```typescript
// tests/integration/user-nodes-role-change.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import clientCardinalityHandler from '../../netlify/functions/client-cardinality';
import userNodesHandler from '../../netlify/functions/user-nodes';
import roleChangeHandler from '../../netlify/functions/user-nodes-role-change';
import { assertLastAudit } from '../helpers/audit';

const ADMIN_EMAIL = `role-change-test-${Date.now()}@example.com`;
const ADMIN_PASSWORD = 'role-change-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let clientId: string;
let roleShop: string, roleA: string, roleB: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Role Change Test', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
  `;
});

async function setupClient() {
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
      body: JSON.stringify({ name: `Role Change Test ${Date.now()}-${Math.random()}` }),
    }), CTX,
  );
  clientId = (await cr.json() as { client: { id: string } }).client.id;
  created.push(clientId);
  const r1 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'shop', label: 'Shop', color: '#ef4444' }),
    }), CTX,
  );
  roleShop = (await r1.json() as { role: { id: string } }).role.id;
  const r2 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'mgr', label: 'Manager', color: '#3b82f6' }),
    }), CTX,
  );
  roleA = (await r2.json() as { role: { id: string } }).role.id;
  const r3 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'sr_mgr', label: 'Senior Manager', color: '#10b981' }),
    }), CTX,
  );
  roleB = (await r3.json() as { role: { id: string } }).role.id;
  await clientLevelsHandler(
    new Request(`http://localhost/api/client-levels?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 1, label: 'Top', allowed_role_ids: [roleShop] }),
    }), CTX,
  );
  await clientLevelsHandler(
    new Request(`http://localhost/api/client-levels?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 2, allowed_role_ids: [roleA, roleB] }),
    }), CTX,
  );
  await clientCardinalityHandler(
    new Request(`http://localhost/api/client-cardinality?client=${clientId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ rules: [
        { parent_role_id: null, child_role_id: roleShop, max_children: 1 },
        { parent_role_id: roleShop, child_role_id: roleA, max_children: 2 },
        { parent_role_id: roleShop, child_role_id: roleB, max_children: 2 },
      ] }),
    }), CTX,
  );
}
beforeEach(async () => { await setupClient(); });
afterAll(async () => {
  for (const id of created) { try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ } }
});

async function createNode(opts: { role_id: string; level_number: number | null; parent_id: string | null; display_name: string }): Promise<string> {
  const r = await userNodesHandler(
    new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(opts),
    }), CTX,
  );
  return (await r.json() as { node: { id: string } }).node.id;
}

describe('POST /api/user-nodes-role-change', () => {
  test('happy path: admin changes Manager → Senior Manager', async () => {
    const shopId = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    const mgrId = await createNode({ role_id: roleA, level_number: 2, parent_id: shopId, display_name: 'M1' });

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_id: mgrId, new_role_id: roleB }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: true; node: { id: string; role_id: string } };
    expect(body.node.role_id).toBe(roleB);

    const updated = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${mgrId}::uuid`) as { role_id: string }[];
    expect(updated[0]!.role_id).toBe(roleB);

    await assertLastAudit(sql, {
      op: 'users.role_changed',
      targetType: 'user_node',
      targetId: mgrId,
      clientId,
    });
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (endpoint file does not exist)**

Run: `npx vitest run tests/integration/user-nodes-role-change.test.ts --no-coverage`
Expected: FAIL with `Cannot find module '../../netlify/functions/user-nodes-role-change'` or similar import error.

- [ ] **Step 3: Commit (red phase)**

```bash
git add tests/integration/user-nodes-role-change.test.ts
git commit -m "test(role-change): failing happy-path integration test

Red phase. Endpoint not implemented yet."
```

---

## Task 4: Implement the endpoint to make Task 3's test pass

**Files:**
- Create: `netlify/functions/user-nodes-role-change.ts`

- [ ] **Step 1: Create the endpoint**

Create `netlify/functions/user-nodes-role-change.ts`:

```typescript
// netlify/functions/user-nodes-role-change.ts
//
// POST /api/user-nodes-role-change — admin or L1 Owner.
// Single-user variant of user-nodes-bulk-role-change.ts with a stricter
// permission gate (L2+ bucket-user rejected) and self-target block.
//
// Spec: docs/superpowers/specs/2026-06-08-edit-modal-role-change-design.md

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import {
  authenticateForPermission, resolveClientIdOrRespond,
  type AnySession,
} from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { logAudit } from './_shared/audit';
import { validateLevelAllowsRole, validateCardinality } from './_shared/role-change';

const Body = z.object({
  node_id: z.string().uuid(),
  new_role_id: z.string().uuid(),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, '_platform.users.edit');
  if (auth instanceof Response) return auth;
  const session: AnySession = auth;

  // Gate: admin OR L1 only.
  if (session.kind === 'bucket_user' && session.level_number > 1) {
    return jsonError(403, 'forbidden_role_change_scope');
  }

  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const clientId = scope.clientId;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const { node_id, new_role_id } = parsed.data;

  const sql = db();

  // Fetch target + new role.
  const [target] = (await sql`
    SELECT id, client_id, parent_id, level_number, role_id, display_name
    FROM public.user_nodes WHERE id = ${node_id}::uuid LIMIT 1
  `) as { id: string; client_id: string; parent_id: string | null; level_number: number | null; role_id: string; display_name: string }[];
  if (!target) return jsonError(404, 'not_found');
  if (target.client_id !== clientId) return jsonError(400, 'cross_client');

  const [newRole] = (await sql`
    SELECT id, client_id, key FROM public.client_roles WHERE id = ${new_role_id}::uuid LIMIT 1
  `) as { id: string; client_id: string; key: string }[];
  if (!newRole) return jsonError(404, 'not_found');
  if (newRole.client_id !== clientId) return jsonError(400, 'cross_client');

  // Self-block.
  if (session.kind === 'bucket_user' && session.user_node_id === target.id) {
    return jsonError(403, 'self_role_change_forbidden');
  }

  // No-op.
  if (target.role_id === new_role_id) {
    return jsonOk({ ok: true, no_change: true, node: target });
  }

  // Unassigned guard.
  if (target.level_number === null) {
    return jsonError(400, 'unassigned_node');
  }

  // Level allows role?
  const lv = await validateLevelAllowsRole(sql, clientId, target.level_number, new_role_id);
  if (!lv.ok) return jsonError(400, lv.code);

  // Cardinality projection.
  const card = await validateCardinality(sql, clientId, target.parent_id, new_role_id, target.role_id);
  if (!card.ok) return jsonError(400, card.code, { max: card.max });

  // Old role key for audit detail.
  const [oldRole] = (await sql`
    SELECT key FROM public.client_roles WHERE id = ${target.role_id}::uuid LIMIT 1
  `) as { key: string }[];

  // Commit.
  const [updated] = (await sql`
    UPDATE public.user_nodes SET role_id = ${new_role_id}::uuid, updated_at = now()
    WHERE id = ${target.id}::uuid
    RETURNING id, client_id, parent_id, level_number, role_id, display_name
  `) as { id: string; client_id: string; parent_id: string | null; level_number: number; role_id: string; display_name: string }[];

  await logAudit(sql, {
    session,
    op: 'users.role_changed',
    clientId,
    targetType: 'user_node',
    targetId: target.id,
    detail: {
      from_role_key: oldRole?.key ?? null,
      to_role_key: newRole.key,
      target_id: target.id,
      level_number: target.level_number,
    },
  });

  return jsonOk({ ok: true, node: updated });
};
```

- [ ] **Step 2: Run the happy-path test — expect PASS**

Run: `npx vitest run tests/integration/user-nodes-role-change.test.ts --no-coverage`
Expected: 1 test passes.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/user-nodes-role-change.ts
git commit -m "feat(role-change): single-user endpoint

POST /api/user-nodes-role-change. Admin or L1 only (L2+ rejected with
forbidden_role_change_scope). Self-target rejected. No-op short-circuits
without audit. Validates level-allows + cardinality via shared helpers."
```

---

## Task 5: Add the remaining 7 integration tests

**Files:**
- Modify: `tests/integration/user-nodes-role-change.test.ts`

- [ ] **Step 1: Append the L1 owner happy-path test**

Add to the `describe` block (after the existing test), but FIRST add a u-login helper import at the top of the file:

```typescript
import uLoginHandler from '../../netlify/functions/u-login';
```

Then append the test:

```typescript
  test('L1 owner changes a node in their workspace', async () => {
    // setupClient already created a workspace; now also create the L1 Owner
    // user with a login, then sign in as that user and try the role change.
    const ownerEmail = `owner-${Date.now()}@example.com`;
    const ownerPw = 'owner-pw-123';
    const ownerRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Owner',
          email: ownerEmail, create_login: true, temp_password: ownerPw,
        }),
      }), CTX,
    );
    expect(ownerRes.status).toBe(201);
    const ownerNode = (await ownerRes.json() as { node: { id: string }; client_slug: string });
    const slug = ownerNode.client_slug;
    const login = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, password: ownerPw }),
      }), CTX,
    );
    expect(login.status).toBe(200);
    const ownerCookie = login.headers.get('set-cookie')!.split(';')[0]!;

    const mgrId = await createNode({ role_id: roleA, level_number: 2, parent_id: ownerNode.node.id, display_name: 'M-by-owner' });

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ node_id: mgrId, new_role_id: roleB }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const updated = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${mgrId}::uuid`) as { role_id: string }[];
    expect(updated[0]!.role_id).toBe(roleB);
  });
```

The L1 caller has no `client=` query param — JWT scope resolves it. If `createNode` requires `client=` in the URL and the L1 has no admin cookie, this differs from admin path. Verify `createNode` works (it uses the admin `cookie`, so it'll still succeed for setup).

- [ ] **Step 2: Append the L2+ rejection test**

```typescript
  test('L2+ bucket-user is rejected with forbidden_role_change_scope', async () => {
    // L1 Owner with login, then an L2 manager under it with a login.
    const ownerEmail = `o2-${Date.now()}@example.com`;
    const ownerPw = 'o2-pw-123';
    const ownerRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Owner2',
          email: ownerEmail, create_login: true, temp_password: ownerPw,
        }),
      }), CTX,
    );
    const ownerJson = await ownerRes.json() as { node: { id: string }; client_slug: string };
    const slug = ownerJson.client_slug;
    const ownerId = ownerJson.node.id;

    const mgrEmail = `m2-${Date.now()}@example.com`;
    const mgrPw = 'm2-pw-123';
    const mgrRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleA, level_number: 2, parent_id: ownerId, display_name: 'L2Mgr',
          email: mgrEmail, create_login: true, temp_password: mgrPw,
        }),
      }), CTX,
    );
    const mgrId = (await mgrRes.json() as { node: { id: string } }).node.id;

    const login = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mgrEmail, password: mgrPw }),
      }), CTX,
    );
    const mgrCookie = login.headers.get('set-cookie')!.split(';')[0]!;

    // L2 manager tries to change their own peer's role — but actually let's
    // change their own subordinate. First create a peer to avoid self-block.
    const targetId = await createNode({ role_id: roleA, level_number: 2, parent_id: ownerId, display_name: 'Peer' });

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: mgrCookie },
        body: JSON.stringify({ node_id: targetId, new_role_id: roleB }),
      }), CTX,
    );
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('forbidden_role_change_scope');

    // No UPDATE happened.
    const after = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${targetId}::uuid`) as { role_id: string }[];
    expect(after[0]!.role_id).toBe(roleA);
  });
```

Note: at L2, the test scenario requires the L2 level to allow more than the L2 manager's own role (so there's a target whose role can be changed). The fixture in `setupClient` makes L2 allow `[roleA, roleB]` — fine.

- [ ] **Step 3: Append the self-block test**

```typescript
  test('self-target: caller hits self_role_change_forbidden', async () => {
    const ownerEmail = `o-self-${Date.now()}@example.com`;
    const ownerPw = 'o-self-pw';
    const ownerRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShop, level_number: 1, parent_id: null, display_name: 'OwnerSelf',
          email: ownerEmail, create_login: true, temp_password: ownerPw,
        }),
      }), CTX,
    );
    const ownerJson = await ownerRes.json() as { node: { id: string }; client_slug: string };
    const ownerId = ownerJson.node.id;
    const slug = ownerJson.client_slug;
    const login = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, password: ownerPw }),
      }), CTX,
    );
    const ownerCookie = login.headers.get('set-cookie')!.split(';')[0]!;

    // Owner targets their own user_node. Owner level is 1 → roleShop. The
    // only role allowed at L1 is roleShop, so the request would also fail
    // with level_disallows_role for any other role — but the self-block
    // fires FIRST per design §6.3 step 6.
    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ node_id: ownerId, new_role_id: roleA }),
      }), CTX,
    );
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('self_role_change_forbidden');
  });
```

- [ ] **Step 4: Append the level-disallows-role test**

```typescript
  test('new role not in level allowed_role_ids → level_disallows_role', async () => {
    const shopId = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    const mgrId = await createNode({ role_id: roleA, level_number: 2, parent_id: shopId, display_name: 'M' });

    // Try to assign roleShop (an L1 role) to an L2 node.
    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_id: mgrId, new_role_id: roleShop }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('level_disallows_role');
    const after = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${mgrId}::uuid`) as { role_id: string }[];
    expect(after[0]!.role_id).toBe(roleA);
  });
```

- [ ] **Step 5: Append the cardinality-exceeded test**

```typescript
  test('cardinality cap exceeded → cardinality_exceeded with max', async () => {
    const shopId = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    // Fixture: cap of roleB under roleShop is 2. Create 2 roleB children + 1 roleA target.
    await createNode({ role_id: roleB, level_number: 2, parent_id: shopId, display_name: 'B1' });
    await createNode({ role_id: roleB, level_number: 2, parent_id: shopId, display_name: 'B2' });
    const mgrId = await createNode({ role_id: roleA, level_number: 2, parent_id: shopId, display_name: 'A1' });

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_id: mgrId, new_role_id: roleB }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string; details: { max: number } } };
    expect(body.error.code).toBe('cardinality_exceeded');
    expect(body.error.details.max).toBe(2);
    const after = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${mgrId}::uuid`) as { role_id: string }[];
    expect(after[0]!.role_id).toBe(roleA);
  });
```

- [ ] **Step 6: Append the unassigned-node test**

```typescript
  test('target has level_number IS NULL → unassigned_node', async () => {
    // Create an unassigned node by inserting directly (the endpoint enforces
    // level_number on POST, so we bypass via SQL for the fixture).
    const orphan = (await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleA}::uuid, NULL, NULL, 'orphan', '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const orphanId = orphan[0]!.id;

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_id: orphanId, new_role_id: roleB }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('unassigned_node');
  });
```

- [ ] **Step 7: Append the no-change test**

```typescript
  test('new_role_id equals current role_id → 200 no_change, no UPDATE, no audit', async () => {
    const shopId = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    const mgrId = await createNode({ role_id: roleA, level_number: 2, parent_id: shopId, display_name: 'M' });

    const auditBefore = (await sql`
      SELECT count(*)::int AS c FROM public.audit_log WHERE target_id = ${mgrId} AND op = 'users.role_changed'
    `) as { c: number }[];

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_id: mgrId, new_role_id: roleA }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: true; no_change: boolean };
    expect(body.no_change).toBe(true);

    const auditAfter = (await sql`
      SELECT count(*)::int AS c FROM public.audit_log WHERE target_id = ${mgrId} AND op = 'users.role_changed'
    `) as { c: number }[];
    expect(auditAfter[0]!.c).toBe(auditBefore[0]!.c);
  });
```

- [ ] **Step 8: Run the integration suite for this file**

Run: `npx vitest run tests/integration/user-nodes-role-change.test.ts --no-coverage`
Expected: 8 tests pass (1 happy + 7 new).

- [ ] **Step 9: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add tests/integration/user-nodes-role-change.test.ts
git commit -m "test(role-change): 7 more integration tests

Covers L1 owner happy path, L2+ rejection, self-block, level-disallows,
cardinality cap, unassigned target, and no-change short-circuit."
```

---

## Task 6: Audit op-label registry entry

**Files:**
- Modify: `src/modules/ams/components/audit/op-labels.ts`

- [ ] **Step 1: Add the OP_LABELS entry**

In `src/modules/ams/components/audit/op-labels.ts`, in the `OP_LABELS` object, add after the `'users.bulk_role_changed'` line:

```typescript
  'users.role_changed': 'Changed role',
```

- [ ] **Step 2: Add the summarize() case**

In the same file, in `summarize()`, add a case for `users.role_changed` near the `users.bulk_role_changed` case:

```typescript
  if (op === 'users.role_changed') {
    const v = detail as { from_role_key?: string; to_role_key?: string };
    if (v.from_role_key && v.to_role_key) return `${v.from_role_key} → ${v.to_role_key}`;
    if (v.to_role_key) return `→ ${v.to_role_key}`;
    return '';
  }
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/ams/components/audit/op-labels.ts
git commit -m "feat(audit): op-label for users.role_changed

Renders as 'Changed role' with summary 'old_key → new_key' in the
admin audit log."
```

---

## Task 7: Extend TeamMemberApi and per-portal factories

**Files:**
- Modify: `src/modules/shared/team-modals/types.ts`
- Modify: `src/modules/ams/components/team-modal-api.ts`
- Modify: `src/modules/user-portal/team/team-modal-api.tsx`

- [ ] **Step 1: Inspect the current admin and owner factories**

Run: `sed -n '1,80p' src/modules/ams/components/team-modal-api.ts`
Run: `sed -n '1,80p' src/modules/user-portal/team/team-modal-api.tsx`

Goal: understand each factory's pattern so the new `changeRole` follows the same shape (path, cookie handling, error mapping).

- [ ] **Step 2: Extend the TeamMemberApi interface**

In `src/modules/shared/team-modals/types.ts`, add after the `bulkRoleChange` declaration:

```typescript
  changeRole: (
    nodeId: string,
    new_role_id: string,
  ) => Promise<ApiResult<{ node: UserNode; no_change?: boolean }>>;
```

And add a new exported interface for the per-portal capability bag:

```typescript
// Per-portal capability flags. Lets the modal hide UI affordances when the
// current caller's role/level doesn't permit them. Decided by the call site.
export interface TeamMemberCaps {
  canChangeRole: boolean;
}
```

- [ ] **Step 3: Implement changeRole in the admin factory**

In `src/modules/ams/components/team-modal-api.ts`, add a method following the existing pattern of admin endpoints (admin endpoints take `client=` query parameter):

```typescript
changeRole: async (nodeId, new_role_id) => {
  const r = await apiFetch(`/api/user-nodes-role-change?client=${clientId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: nodeId, new_role_id }),
  });
  return r as ApiResult<{ node: UserNode; no_change?: boolean }>;
},
```

Match the surrounding code's `apiFetch` import and error-mapping conventions; if the file uses a different return-mapper helper, mirror it. (If unsure, inspect the existing `bulkRoleChange` method in the same file and copy its shape.)

- [ ] **Step 4: Implement changeRole in the owner factory**

In `src/modules/user-portal/team/team-modal-api.tsx`, add the same method without the `client=` query (owner endpoints rely on JWT-scoped resolution):

```typescript
changeRole: async (nodeId, new_role_id) => {
  const r = await apiFetch(`/api/user-nodes-role-change`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_id: nodeId, new_role_id }),
  });
  return r as ApiResult<{ node: UserNode; no_change?: boolean }>;
},
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (consumers of `TeamMemberApi` will be flagged in the next task; for now, the modal hasn't been updated, but the interface adds a NEW required method — every factory MUST implement it before typecheck passes).

If typecheck fails because not all factories were updated, fix the missing factory before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/modules/shared/team-modals/types.ts src/modules/ams/components/team-modal-api.ts src/modules/user-portal/team/team-modal-api.tsx
git commit -m "feat(team-modal): wire changeRole in shared API + factories

Adds changeRole to TeamMemberApi (admin: client= query; owner: JWT-scoped)
and introduces TeamMemberCaps for per-portal UI capability flags."
```

---

## Task 8: Wire the role picker + confirm panel into EditUserModal

**Files:**
- Modify: `src/modules/shared/team-modals/EditUserModal.tsx`
- Modify: call sites — `src/modules/ams/pages/AccessDashboard.tsx` and `src/modules/user-portal/team/UserManageTeam.tsx` (paths assumed; verify with `grep -rln EditUserModal src/` before editing)

- [ ] **Step 1: Identify all EditUserModal call sites**

Run: `grep -rln "EditUserModal" src/`
Expected: at least two call sites (admin + owner). Note the exact paths.

- [ ] **Step 2: Add the new props to the EditUserModal Props interface**

In `src/modules/shared/team-modals/EditUserModal.tsx`, modify the `Props` interface (currently at line 8):

```typescript
import type { ClientRole, UserNode, UserNodeCredentialStatus, ClientLevel } from '../../ams/api';
import type { TeamMemberApi, TeamMemberCopy, TeamMemberCaps } from './types';

interface Props {
  api: TeamMemberApi;
  copy: TeamMemberCopy;
  caps: TeamMemberCaps;
  node: UserNode;
  role: ClientRole | undefined;
  roles: ClientRole[];        // all roles in the workspace
  levels: ClientLevel[];      // all levels in the workspace
  callerUserNodeId: string | null;  // null when caller is admin
  clientSlug: string;
  nodes: UserNode[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onManageLogin: () => void;
}
```

Verify `ClientLevel` is exported from `../../ams/api`; if not, import from wherever the `ClientLevel` type lives (search: `grep -rn "export.*ClientLevel" src/`).

- [ ] **Step 3: Compute the level-allowed roles inside the component**

In `EditUserModal.tsx`, after the existing `parentCandidates` declaration (~line 45-48), add:

```typescript
  // Role picker — show only roles allowed at the target's current level.
  const levelAllowedRoleIds = node.level_number !== null
    ? (levels.find((l) => l.level_number === node.level_number)?.allowed_role_ids ?? [])
    : [];
  const levelAllowedRoles = roles.filter((r) => levelAllowedRoleIds.includes(r.id));

  const isSelfTarget = callerUserNodeId !== null && callerUserNodeId === node.id;
  const rolePickerVisible = caps.canChangeRole && node.level_number !== null;
  const rolePickerDisabled = isSelfTarget;

  const [selectedRoleId, setSelectedRoleId] = useState<string>(node.role_id);
  const [roleChangeConfirmed, setRoleChangeConfirmed] = useState(false);

  const roleChanged = selectedRoleId !== node.role_id;
```

Also add `selectedRoleId` to the form's dirty calculation so Save activates:

```typescript
  const dirty = identityDirty || parentChanged || (roleChanged && roleChangeConfirmed);
```

- [ ] **Step 4: Render the role picker and confirm panel**

In `EditUserModal.tsx`, after the parent-picker block (currently lines 236-247), insert:

```typescript
          {rolePickerVisible && (
            <label>Role
              <select
                value={selectedRoleId}
                disabled={rolePickerDisabled}
                title={rolePickerDisabled ? "You can't change your own role" : undefined}
                onChange={(e) => {
                  setSelectedRoleId(e.target.value);
                  setRoleChangeConfirmed(false);  // re-arm confirmation on every change
                }}
              >
                {levelAllowedRoles.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </label>
          )}

          {rolePickerVisible && roleChanged && !roleChangeConfirmed && (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 6,
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                fontSize: 12,
              }}
            >
              You're changing <strong>{node.display_name}</strong> from{' '}
              <strong>{role?.label ?? '(current)'}</strong> to{' '}
              <strong>{levelAllowedRoles.find((r) => r.id === selectedRoleId)?.label ?? '(new)'}</strong>.
              This affects which views and bulk actions they appear in.
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setRoleChangeConfirmed(true)}
                  disabled={submitting}
                >
                  Confirm role change
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSelectedRoleId(node.role_id)}
                  disabled={submitting}
                >
                  Revert
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 5: Extend handleSave to call changeRole after identity and parent**

In `EditUserModal.tsx`, after the existing `if (parentChanged) { … }` block (around line 122), insert:

```typescript
    if (roleChanged && roleChangeConfirmed) {
      const r = await api.changeRole(node.id, selectedRoleId);
      if (!r.ok) {
        setSubmitting(false);
        const code = r.error.code;
        const details = r.error.details as { max?: number } | undefined;
        const msg =
          code === 'cardinality_exceeded'
            ? `Limit reached for this role under the current parent${details?.max !== undefined ? ` (max ${details.max})` : ''}. Move the user first, or pick a different role.`
            : code === 'level_disallows_role'
              ? `This role isn't allowed at level ${node.level_number}.`
              : code === 'forbidden_role_change_scope'
                ? `Only admins and Owners can change roles.`
                : code === 'self_role_change_forbidden'
                  ? `You can't change your own role.`
                  : code === 'unassigned_node'
                    ? `Assign this user to a level first.`
                    : `Failed (${code}).`;
        setError(msg);
        return;
      }
    }
```

- [ ] **Step 6: Update both call sites to pass the new props**

For each `EditUserModal` call site found in Step 1, pass the new props. Pattern for admin (`AccessDashboard.tsx`):

```typescript
<EditUserModal
  api={api}
  copy={copy}
  caps={{ canChangeRole: true }}
  node={selectedNode}
  role={role}
  roles={roles}
  levels={levels}
  callerUserNodeId={null}
  clientSlug={clientSlug}
  nodes={nodes}
  onClose={...}
  onSaved={...}
  onDeleted={...}
  onManageLogin={...}
/>
```

Pattern for owner (`UserManageTeam.tsx` or equivalent):

```typescript
<EditUserModal
  api={api}
  copy={copy}
  caps={{ canChangeRole: callerLevelNumber === 1 }}
  node={selectedNode}
  role={role}
  roles={roles}
  levels={levels}
  callerUserNodeId={callerUserNodeId}
  ...
/>
```

The owner page must already know its own `callerLevelNumber` and `callerUserNodeId` from session context — search the existing file for how it gets the caller's identity, and reuse that source.

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Run targeted tests for files touched**

The endpoint + helper tests should still pass (and aren't affected by the UI changes), but rerunning gives a clean signal:

Run: `npx vitest run tests/integration/user-nodes-role-change.test.ts tests/unit/role-change-helpers.test.ts --no-coverage`
Expected: 14 tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/modules/shared/team-modals/EditUserModal.tsx src/modules/ams/pages/AccessDashboard.tsx src/modules/user-portal/team/UserManageTeam.tsx
# (adjust paths if Step 1 found different call-site files)
git commit -m "feat(team-modal): role picker + confirm panel in Edit User modal

Picker visible to admin and L1 only (via caps.canChangeRole), hidden
for L2+ and for unassigned nodes, disabled with tooltip when target is
the caller. Inline confirm panel arms before commit. Save flow extends
to identity → parent → role with per-step error mapping."
```

---

## Task 9: Manual smoke (no code changes — validation only)

**Files:** none modified.

This task is the spec's §7.4 manual smoke. Run it before marking the work shipped.

- [ ] **Step 1: Start local dev**

Per the standing memory `feedback_netlify_dev_target_port_collision.md`, use the conflict-free ports:

```bash
# Terminal 1
npx vite --port 5180 --strictPort

# Terminal 2
npx netlify dev --port 8890 --target-port 5180
```

Open http://localhost:8890.

- [ ] **Step 2: Smoke #1 — Admin happy path**

1. Sign in as admin.
2. Navigate to Access Dashboard for a workspace with L2 users (e.g., Papa's Saloon).
3. Click any L2+ user.
4. Verify the Role picker is visible and populated with the level's allowed roles.
5. Pick a different role.
6. Verify the orange confirm panel appears: "You're changing X from … to … — Confirm role change / Revert".
7. Click "Confirm role change".
8. Click Save.
9. Modal closes; dashboard refreshes; user shows the new role swatch + label.

- [ ] **Step 3: Smoke #2 — L1 Owner happy path**

1. Sign in as a Papa's Saloon Owner (L1).
2. Open `UserManageTeam`.
3. Click an L2 user.
4. Repeat the role-change flow.
5. Verify it works exactly like admin (picker visible because `caps.canChangeRole = true` when `callerLevelNumber === 1`).

- [ ] **Step 4: Smoke #3 — Self-block**

1. Still signed in as the Owner, click their own user_node from the dashboard (or wherever the Owner can target themselves).
2. Verify the Role picker is rendered but `disabled`.
3. Hover the picker — verify the tooltip says "You can't change your own role".

- [ ] **Step 5: Smoke #4 — L2 hidden**

1. Sign in as an L2 manager (any subtree caller).
2. Click any subordinate user.
3. Verify the Role picker is **absent** from the form (not rendered at all). Identity + parent fields render normally.

- [ ] **Step 6: Smoke #5 — Files-page propagation**

1. Sign in as admin in two tabs.
2. Tab A: open `/files`, expand a workspace card.
3. Tab B: open the Access Dashboard for the same workspace, edit a user, change their role, confirm, Save.
4. Switch back to Tab A. Within 5 seconds, the user should disappear from the old role folder and appear under the new role folder.
5. If it doesn't propagate, check the browser's network tab for `getClientStructure` / `listUserNodes` polling activity — the poll runs every 5s while the card is expanded.

- [ ] **Step 7: Document smoke results**

Append a short note to the implementation plan checklist with the date and any anomalies. If everything passed, the work is done.

- [ ] **Step 8: Final commit (only if anomalies required code fixes; otherwise skip)**

If anything failed during smoke and required follow-up changes, commit those as separate fix commits before considering the work complete.

---

## Done criteria

All of the following must hold before declaring the feature complete:

1. `npm run typecheck` exits 0.
2. `npx vitest run tests/unit/role-change-helpers.test.ts tests/integration/user-nodes-role-change.test.ts tests/integration/user-nodes-bulk-role-change.test.ts --no-coverage` — all 19 tests pass (6 unit + 8 new integration + 5 existing bulk).
3. All five manual smoke scenarios in Task 9 pass.
4. No `console.log` debugging left in the modified files.
5. Working tree clean except for known untracked files documented in the handoff.
6. Local main has the feature commits but has NOT been pushed (push happens only on explicit user approval).

## Out-of-scope follow-ups (do not implement here)

- Combined identity+parent+role atomic transaction endpoint.
- Drop `ClientFilesCard.tsx` `POLL_MS` from 5000 to 2000.
- Fix `AccessDashboard.tsx:143` drag-drop first-parent default.
- Tighten the bulk endpoint to also reject L2+ callers (intentionally untouched).
