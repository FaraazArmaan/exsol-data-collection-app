# Manage Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Owner-facing Manage Team page that reuses the admin tree-of-chips layout, by widening existing admin user-management endpoints with `requirePermission` and adding owner-scoped React components.

**Architecture:** Five existing admin endpoints (`client-structure`, `user-nodes`, `user-nodes-detail`, `user-nodes-move`, `user-node-credential`) are widened from `requireAdmin` to `requirePermission(req, '_platform.users.<verb>')`. A migration relaxes the `created_by_admin NOT NULL` constraint so bucket-user-created rows can attribute to no admin. New owner-scoped React components (`UserManageTeam` page + 3 modals + API wrappers) mount inside the dashboard layout.

**Tech Stack:** TypeScript everywhere. React 18 + react-router-dom + @dnd-kit. Netlify Functions + Neon. Zod for body validation. Vitest for tests. Argon2 for hashing. Builds on [2026-06-03-manage-team-design.md](../specs/2026-06-03-manage-team-design.md), [2026-06-01-access-levels-design.md](../specs/2026-06-01-access-levels-design.md) (`requirePermission` middleware), [2026-06-03-user-dashboard-design.md](../specs/2026-06-03-user-dashboard-design.md) (dashboard surface).

---

## File map

**New files:**
- `db/migrations/023_user_nodes_created_by_admin_nullable.sql` — relax NOT NULL on `user_nodes.created_by_admin` and `user_node_credentials.created_by_admin`.
- `src/modules/user-portal/team/api.ts` — Owner-scoped API wrappers (no `clientId` param; server resolves from JWT).
- `src/modules/user-portal/team/AddTeamMemberModal.tsx` — Owner-scoped fork of `AddUserNodeModal`.
- `src/modules/user-portal/team/EditTeamMemberModal.tsx` — Owner-scoped fork of `EditUserNodeModal`.
- `src/modules/user-portal/team/LoginManageDrawer.tsx` — Owner-scoped fork of `LoginManageModal`.
- `src/modules/user-portal/pages/UserManageTeam.tsx` — page component.
- `tests/integration/manage-team-bucket-user.test.ts` — cross-cutting bucket-user happy path.
- `tests/unit/permissions-resolve-client.test.ts` — unit tests for the two new helpers.

**Modified files:**
- `netlify/functions/_shared/permissions.ts` — add `resolveClientId` (param-based) + `authorizeClientScope` (row-based) exported helpers.
- `netlify/functions/client-structure.ts` — swap `requireAdmin` → `requirePermission('_platform.users.view')` + `resolveClientId`.
- `netlify/functions/user-nodes.ts` — GET → `view`; POST → `create`. Also nullable `adminId` plumbing.
- `netlify/functions/user-nodes-detail.ts` — GET → `view`; PATCH → `edit`; DELETE → `delete`. Row-based auth via `authorizeClientScope`.
- `netlify/functions/user-nodes-move.ts` — POST → `edit`. Row-based auth.
- `netlify/functions/user-node-credential.ts` — GET/POST/DELETE → `edit`. Row-based auth via the node FK lookup.
- `src/lib/router.tsx` — add `/c/:slug/team` route under `UserDashboardLayout`.
- `src/modules/user-portal/layout/Sidebar.tsx` — Owner-only "Team" entry.
- `src/modules/user-portal/pages/UserDashboardHome.tsx` — replace Owner "Manage team" `StubTile` with a real `Link`.
- `tests/integration/user-nodes-crud.test.ts` + sibling admin-endpoint tests — extend with bucket-user cases (existing admin assertions stay).

**No new dependencies. No env var changes.**

---

## Pre-flight (every task)

```bash
npm run typecheck && npm test
```

Both green before commit. Saved feedback `feedback_implementer_verify_typecheck` is binding — runtime tests passing does not validate TS.

---

# Task 1: Migration 023 — created_by_admin nullable

The existing `user_nodes.created_by_admin` and `user_node_credentials.created_by_admin` columns are NOT NULL with FK to `admins(id)`. Bucket-user-created rows have no admin to attribute, so we relax to NULL.

**Files:**
- Create: `db/migrations/023_user_nodes_created_by_admin_nullable.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/023_user_nodes_created_by_admin_nullable.sql`:

```sql
-- 023: Relax created_by_admin NOT NULL on user_nodes and user_node_credentials.
--
-- Bucket-user-initiated row creation (Owner adding a team member from the
-- Manage Team UI) has no admin to attribute the row to. The column stays
-- as an FK so admin-created rows continue to attribute correctly; NULL just
-- means "created by a bucket-user".
--
-- The 'created_by' attribution for bucket-user creators is intentionally NOT
-- backfilled into a new column in this migration — designing the audit-trail
-- surface is its own future feature. For now, NULL == "created from outside
-- the admin auth path".

ALTER TABLE public.user_nodes
  ALTER COLUMN created_by_admin DROP NOT NULL;

ALTER TABLE public.user_node_credentials
  ALTER COLUMN created_by_admin DROP NOT NULL;
```

- [ ] **Step 2: Apply to dev DB**

```bash
npm run migrate
```

Expected output mentions `023_user_nodes_created_by_admin_nullable` applied. If migrate fails because the column is already nullable, the migration is idempotent enough (ALTER … DROP NOT NULL on an already-nullable column is a no-op in Postgres) — verify by re-running.

- [ ] **Step 3: Verify column state**

```bash
DBU=$(grep ^DATABASE_URL .env | cut -d= -f2-)
psql "$DBU" -c "\d public.user_nodes" | grep created_by_admin
psql "$DBU" -c "\d public.user_node_credentials" | grep created_by_admin
```

Expected: both rows show the `created_by_admin` column WITHOUT `not null` in the modifiers.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: 149/149 still pass (no functional change).

- [ ] **Step 5: Commit**

```bash
git add db/migrations/023_user_nodes_created_by_admin_nullable.sql
git commit -m "$(cat <<'EOF'
feat(db): migration 023 — created_by_admin nullable on user_nodes + credentials

Owner-driven team management lets bucket-users create user_nodes and
credentials. Those rows have no admin to attribute. Column stays as an
FK to admins(id); NULL now means "created by a bucket-user". Audit-trail
design for bucket-user creators is deferred.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Schedule prod migration before push (do NOT push code yet)**

Saved feedback `feedback_migration_before_deploy` is binding. The widened endpoints in Task 4+ depend on this column being nullable in prod. **The migration must be applied to prod Neon before any code in Tasks 3-8 reaches `origin/main`.** Do not push until the prod migration has run. The final task (Task 8 smoke + push) is the gate.

---

# Task 2: `resolveClientId` + `authorizeClientScope` helpers

Two exported helpers in `_shared/permissions.ts`. `resolveClientId` is for endpoints that take `?client=<uuid>` (admin sets it; bucket-user implicit). `authorizeClientScope` is for endpoints that operate on a node row first (admin: any client; bucket-user: must match `session.client_id`).

**Files:**
- Modify: `netlify/functions/_shared/permissions.ts`
- Create: `tests/unit/permissions-resolve-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/permissions-resolve-client.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import {
  resolveClientId, authorizeClientScope,
  type AnySession,
} from '../../netlify/functions/_shared/permissions';

const admin: AnySession = { kind: 'admin', admin: { id: 'a-1', email: 'a@x' } };
const bu = (clientId: string): AnySession => ({
  kind: 'bucket_user', user_node_id: 'u-1', client_id: clientId, level_number: 1,
});

function req(url: string): Request {
  return new Request(`http://localhost/x${url}`);
}

describe('resolveClientId', () => {
  test('admin with ?client=X returns X', () => {
    const r = resolveClientId(admin, req('?client=c-1'));
    expect(r).toEqual({ clientId: 'c-1' });
  });

  test('admin without ?client= returns missing_client error', () => {
    const r = resolveClientId(admin, req(''));
    expect(r).toEqual({ error: 'missing_client' });
  });

  test('bucket-user without ?client= returns own client_id', () => {
    const r = resolveClientId(bu('c-own'), req(''));
    expect(r).toEqual({ clientId: 'c-own' });
  });

  test('bucket-user with matching ?client= returns own client_id', () => {
    const r = resolveClientId(bu('c-own'), req('?client=c-own'));
    expect(r).toEqual({ clientId: 'c-own' });
  });

  test('bucket-user with mismatched ?client= returns forbidden_cross_client', () => {
    const r = resolveClientId(bu('c-own'), req('?client=c-other'));
    expect(r).toEqual({ error: 'forbidden_cross_client' });
  });
});

describe('authorizeClientScope', () => {
  test('admin always authorized regardless of row client_id', () => {
    expect(authorizeClientScope(admin, 'c-any')).toEqual({ ok: true });
  });

  test('bucket-user authorized when row client matches session client', () => {
    expect(authorizeClientScope(bu('c-own'), 'c-own')).toEqual({ ok: true });
  });

  test('bucket-user forbidden when row client differs from session client', () => {
    expect(authorizeClientScope(bu('c-own'), 'c-other')).toEqual({ error: 'forbidden_cross_client' });
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npm test -- tests/unit/permissions-resolve-client.test.ts
```

Expected: 8 tests, all FAIL (`resolveClientId` and `authorizeClientScope` not exported).

- [ ] **Step 3: Add the helpers**

Append to `netlify/functions/_shared/permissions.ts` (after the existing `requirePermission` definition, around line 147):

```typescript
// ---------------------------------------------------------------------------
// Client-scope helpers — pair with requirePermission for endpoints that need
// to know which Client the caller is acting on.
//
// resolveClientId   — for endpoints that take ?client=<uuid> (admin) and
//                     where bucket-user is implicitly scoped to own client.
// authorizeClientScope — for endpoints that lookup a node row by ?id=<uuid>
//                        first; pass node.client_id to verify caller may act.
// ---------------------------------------------------------------------------

export function resolveClientId(
  session: AnySession,
  req: Request,
): { clientId: string } | { error: 'missing_client' | 'forbidden_cross_client' } {
  const param = new URL(req.url).searchParams.get('client');
  if (session.kind === 'admin') {
    if (!param) return { error: 'missing_client' };
    return { clientId: param };
  }
  // bucket_user — JWT-scoped. Reject any explicit ?client= that doesn't match.
  if (param && param !== session.client_id) {
    return { error: 'forbidden_cross_client' };
  }
  return { clientId: session.client_id };
}

export function authorizeClientScope(
  session: AnySession,
  rowClientId: string,
): { ok: true } | { error: 'forbidden_cross_client' } {
  if (session.kind === 'admin') return { ok: true };
  return rowClientId === session.client_id
    ? { ok: true }
    : { error: 'forbidden_cross_client' };
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm run typecheck
npm test -- tests/unit/permissions-resolve-client.test.ts
```

Expected: typecheck clean; 8/8 pass.

- [ ] **Step 5: Full suite**

```bash
npm test
```

Expected: 149 + 8 = 157 passing.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/permissions.ts tests/unit/permissions-resolve-client.test.ts
git commit -m "$(cat <<'EOF'
feat(permissions): resolveClientId + authorizeClientScope helpers

Two scope helpers for widening admin endpoints to also accept bucket-user
sessions. resolveClientId is for ?client=<id> endpoints (admin sets it,
bucket-user is JWT-scoped and rejects mismatched ?client=).
authorizeClientScope is for ?id=<nodeId> endpoints — after the row lookup,
verify the caller is allowed to touch a node in that client.

The forbidden_cross_client check on resolveClientId is a real security
boundary: without it, a bucket-user could pass ?client=<other-id> to a
widened endpoint and enumerate or mutate another workspace's users.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 3: Widen READ endpoints

Three GET endpoints get the widening treatment. The transform pattern is identical for all three: swap `requireAdmin` → `requirePermission(req, '_platform.users.view')`, swap query-param parsing → `resolveClientId(session, req)`.

**Files:**
- Modify: `netlify/functions/client-structure.ts`
- Modify: `netlify/functions/user-nodes.ts` (GET branch only — POST stays for Task 4)
- Modify: `netlify/functions/user-nodes-detail.ts` (GET branch only — PATCH/DELETE stay for Task 4)
- Modify: `tests/integration/client-structure.test.ts`
- Modify: `tests/integration/user-nodes-crud.test.ts`

## 3.1 — `client-structure.ts` widening

- [ ] **Step 1: Refactor `client-structure.ts`**

Open `netlify/functions/client-structure.ts`. Replace the auth block + clientId resolution:

```typescript
// before
import { requireAdmin, UnauthorizedError } from './_shared/permissions';

export default async (req: Request, _ctx: Context) => {
  // ...
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
  const clientId = new URL(req.url).searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  // ...
};

// after
import {
  requirePermission, resolveClientId, UnauthorizedError, ForbiddenError,
} from './_shared/permissions';

export default async (req: Request, _ctx: Context) => {
  // ...
  let session;
  try { session = await requirePermission(req, '_platform.users.view'); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    if (e instanceof ForbiddenError) return jsonError(403, 'forbidden', { key: e.key });
    throw e;
  }
  const resolved = resolveClientId(session, req);
  if ('error' in resolved) {
    return jsonError(resolved.error === 'forbidden_cross_client' ? 403 : 400, resolved.error);
  }
  const clientId = resolved.clientId;
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }
  // ... rest of handler unchanged
};
```

The handler body (the SELECT queries that return roles/levels/cardinality) stays identical — only the auth and clientId resolution change.

- [ ] **Step 2: Extend `tests/integration/client-structure.test.ts`**

First read `tests/integration/client-structure.test.ts` (existing) and `tests/integration/user-node-auth.test.ts` (sibling — its `createNodeWithLogin` helper at line ~48 and its `'u-me payload extensions (dashboard)'` describe block at the file-end show the L1-Owner-login pattern this codebase uses).

Add the following imports near the top of `client-structure.test.ts` if not already present:

```typescript
import uLoginHandler from '../../netlify/functions/u-login';
import userNodesHandler from '../../netlify/functions/user-nodes';
```

If `client-structure.test.ts` doesn't already have an L1-Owner-login helper, add a small one at file scope (modeled on `user-node-auth.test.ts:48`'s `createNodeWithLogin`):

```typescript
// Local helper — creates an L1 Owner node + logs in + returns the bu_session cookie.
async function createOwnerCookie(
  clientId: string, clientSlug: string, roleId: string,
): Promise<string> {
  const email = `owner-${Date.now()}@example.com`;
  const pw = `owner-pw-${Date.now()}`;
  const r = await userNodesHandler(
    new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        role_id: roleId, level_number: 1, parent_id: null,
        display_name: 'Owner', email,
        create_login: true, temp_password: pw,
      }),
    }), CTX,
  );
  if (r.status !== 201) throw new Error(`owner create failed: ${r.status} ${await r.text()}`);
  const login = await uLoginHandler(
    new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    }), CTX,
  );
  if (login.status !== 200) throw new Error(`owner login failed: ${login.status}`);
  return login.headers.get('set-cookie')!.split(';')[0]!;
}
```

(`cookie`, `CTX`, `clientId`, `clientSlug`, `roleId` are already in scope from the file's existing `beforeEach` — verify by reading the file.)

Then add the describe block:

```typescript
describe('client-structure — bucket-user widening', () => {
  test('L1 Owner can GET /api/client-structure without ?client= (JWT-scoped)', async () => {
    const ownerCookie = await createOwnerCookie(testClientId, testClientSlug, roleId);
    const r = await clientStructureHandler(
      new Request('http://localhost/api/client-structure', {
        method: 'GET', headers: { cookie: ownerCookie },
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { structure: { roles: Array<{ id: string }>; levels: Array<{ id: string }> } };
    expect(body.structure.roles.some((r) => r.id === roleId)).toBe(true);
    expect(body.structure.levels.length).toBeGreaterThan(0);
  });

  test('L1 Owner with ?client= matching their workspace also succeeds', async () => {
    const ownerCookie = await createOwnerCookie(testClientId, testClientSlug, roleId);
    const r = await clientStructureHandler(
      new Request(`http://localhost/api/client-structure?client=${testClientId}`, {
        method: 'GET', headers: { cookie: ownerCookie },
      }), CTX,
    );
    expect(r.status).toBe(200);
  });

  test('bucket-user passing ?client=<other-client-id> gets 403 forbidden_cross_client', async () => {
    // Create a second client (clientB) using the admin cookie.
    const otherClientResp = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: `Other Client ${Date.now()}` }),
      }), CTX,
    );
    const otherId = (await otherClientResp.json() as { client: { id: string } }).client.id;
    createdClients.push(otherId);

    const ownerCookie = await createOwnerCookie(testClientId, testClientSlug, roleId);

    const r = await clientStructureHandler(
      new Request(`http://localhost/api/client-structure?client=${otherId}`, {
        method: 'GET', headers: { cookie: ownerCookie },
      }), CTX,
    );
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('forbidden_cross_client');
  });
});
```

(`clientsHandler`, `createdClients` come from the existing file scope — verify in the file before relying on them. If `client-structure.test.ts` doesn't import `clientsHandler`, add it.)

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/integration/client-structure.test.ts
```

Expected: existing admin tests still pass; 3 new tests pass.

- [ ] **Step 4: Verify nothing else regressed**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean; 157 + 3 = 160 passing.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/client-structure.ts tests/integration/client-structure.test.ts
git commit -m "feat(client-structure): accept bucket-user with _platform.users.view"
```

(Full commit message body per the existing repo style; see prior commits for tone.)

## 3.2 — `user-nodes.ts` GET widening (POST stays admin-only for now)

- [ ] **Step 1: Refactor the GET branch**

`netlify/functions/user-nodes.ts` has both GET and POST. For this sub-task, only widen the GET branch — POST stays `requireAdmin` until Task 4. Restructure the handler so the auth gate depends on `req.method`:

```typescript
// Replace the existing requireAdmin + clientId block at the top of the handler with:

let session: AnySession | null = null;
let adminActor: { admin: { id: string } } | null = null;

if (req.method === 'GET') {
  try { session = await requirePermission(req, '_platform.users.view'); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    if (e instanceof ForbiddenError) return jsonError(403, 'forbidden', { key: e.key });
    throw e;
  }
} else if (req.method === 'POST') {
  try { adminActor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
  session = { kind: 'admin', admin: { id: adminActor.admin.id, email: '' } };
} else {
  return jsonError(405, 'method_not_allowed');
}

const resolved = resolveClientId(session, req);
if ('error' in resolved) {
  return jsonError(resolved.error === 'forbidden_cross_client' ? 403 : 400, resolved.error);
}
const clientId = resolved.clientId;
try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }
```

The POST branch still has `adminActor` available — its existing `handleCreate(req, sql, clientId, adminActor.admin.id)` call stays the same. Task 4 will widen POST.

Update imports to add `requirePermission`, `resolveClientId`, `ForbiddenError`, `type AnySession`.

- [ ] **Step 2: Extend `tests/integration/user-nodes-crud.test.ts`**

Add a describe block for the new GET access path. Same shape as the client-structure test above: L1 Owner success without `?client=`, L1 Owner success with matching `?client=`, cross-client 403. The L1 Owner is set up the same way (create node + login + cookie). For each case, assert that the returned `nodes` array contains the expected workspace's users.

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && npm test -- tests/integration/user-nodes-crud.test.ts
git add netlify/functions/user-nodes.ts tests/integration/user-nodes-crud.test.ts
git commit -m "feat(user-nodes): GET accepts bucket-user with _platform.users.view"
```

## 3.3 — `user-nodes-detail.ts` GET widening

Same shape as 3.2, but `user-nodes-detail` takes `?id=<nodeId>` (not `?client=`). Use `authorizeClientScope` after fetching the node:

- [ ] **Step 1: Refactor**

In `netlify/functions/user-nodes-detail.ts`, for the `req.method === 'GET'` branch:

```typescript
// Pseudocode for the new auth+scope flow at the top of GET handling:

let session: AnySession;
try { session = await requirePermission(req, '_platform.users.view'); } catch (e) {
  if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
  if (e instanceof ForbiddenError) return jsonError(403, 'forbidden', { key: e.key });
  throw e;
}

// ... fetch the node row by ?id= as today ...
const node = nodeRows[0];
if (!node) return jsonError(404, 'not_found');

const scope = authorizeClientScope(session, node.client_id);
if ('error' in scope) return jsonError(403, scope.error);

// ... return node as today
```

PATCH and DELETE stay `requireAdmin` for now (Task 4 widens them).

- [ ] **Step 2: Tests + commit**

Same pattern: extend existing test file with 3 new cases (Owner success, Owner success with matching client, cross-client 403 — the cross-client case requires creating a node in client B and trying to GET it with Owner-A's cookie). Commit.

```bash
npm run typecheck && npm test -- tests/integration/user-nodes-crud.test.ts
git add netlify/functions/user-nodes-detail.ts tests/integration/user-nodes-crud.test.ts
git commit -m "feat(user-nodes-detail): GET accepts bucket-user with _platform.users.view"
```

---

# Task 4: Widen MUTATION endpoints + nullable created_by_admin plumbing

Now the mutation endpoints: `user-nodes` POST (create), `user-nodes-detail` PATCH (edit), `user-nodes-detail` DELETE, `user-nodes-move` POST, and `user-node-credential` GET/POST/DELETE.

The pattern is the same as Task 3, but two new wrinkles:
1. **Verb mapping** per method: POST=`create`, PATCH=`edit`, DELETE=`delete`, move=`edit`, credential ops=`edit`.
2. **`created_by_admin`**: for bucket-user callers, pass `null` instead of `adminActor.admin.id` to the INSERT statements. This requires Task 1's migration.

**Files:**
- Modify: `netlify/functions/user-nodes.ts` — POST branch.
- Modify: `netlify/functions/user-nodes-detail.ts` — PATCH + DELETE branches.
- Modify: `netlify/functions/user-nodes-move.ts` — full handler.
- Modify: `netlify/functions/user-node-credential.ts` — full handler (GET/POST/DELETE all → `edit`).
- Modify: relevant integration tests with bucket-user cases.

## 4.1 — `user-nodes.ts` POST

**Context for a fresh subagent:** Task 3.2 widened this file's GET branch using a method-switched auth block (`if (req.method === 'GET') { … requirePermission(view) … } else if (req.method === 'POST') { … requireAdmin … }`). The POST branch is still on `requireAdmin`. Read the current method-switch in `netlify/functions/user-nodes.ts` first; the change here is to also swap the POST arm of that switch.

- [ ] **Step 1: Refactor the POST branch**

In the existing method switch, replace the POST arm's `requireAdmin` block with `requirePermission` using verb `create`:

```typescript
} else if (req.method === 'POST') {
  try { session = await requirePermission(req, '_platform.users.create'); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    if (e instanceof ForbiddenError) return jsonError(403, 'forbidden', { key: e.key });
    throw e;
  }
}
```

Then `handleCreate` and `maybeCreateCredential` need to accept a nullable `adminId`. Change their signatures from `adminId: string` to `adminId: string | null`, and pass `null` for bucket-user callers (`session.kind === 'bucket_user' ? null : session.admin.id`).

In the INSERT statements inside `handleCreate` and `maybeCreateCredential`, the existing `${adminId}::uuid` interpolation will accept `null` and produce a NULL — but verify the call sites pass it correctly. The Neon driver handles `null → NULL`, but if the implementer is uncertain, switch the SQL fragment to a conditional: `${adminId ? sql`${adminId}::uuid` : sql`NULL`}`.

- [ ] **Step 2: Bucket-user create-user test**

In `tests/integration/user-nodes-crud.test.ts` (or a new bucket-user-focused file), test:

```typescript
test('L1 Owner can create a user in their workspace', async () => {
  // Setup: L1 Owner logged in.
  // Call POST /api/user-nodes with NO ?client= param + valid body.
  // Assert: 201; node row exists; node.client_id === owner's client_id;
  //         row.created_by_admin IS NULL in the DB.
});

test('Bucket-user cannot create a user in another workspace', async () => {
  // Setup: Owner-A logged in; client B exists.
  // Call POST /api/user-nodes?client=<clientB> with Owner-A cookie.
  // Assert: 403 forbidden_cross_client.
});
```

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && npm test
git add netlify/functions/user-nodes.ts tests/integration/user-nodes-crud.test.ts
git commit -m "feat(user-nodes): POST accepts bucket-user with _platform.users.create"
```

## 4.2 — `user-nodes-detail.ts` PATCH + DELETE

**Context for a fresh subagent:** Task 3.3 already widened this file's GET branch. The current state of `netlify/functions/user-nodes-detail.ts` already imports `requirePermission`, `authorizeClientScope`, `ForbiddenError`, and `type AnySession`, and the GET branch shows the working pattern. Read the GET branch first as your reference, then replicate the same auth-and-scope shape for PATCH and DELETE with different verbs.

- [ ] **Step 1: Refactor PATCH and DELETE branches**

Apply the same auth-and-scope flow used by the (already-widened) GET branch in the same file:
- PATCH → `requirePermission(req, '_platform.users.edit')`
- DELETE → `requirePermission(req, '_platform.users.delete')`

PATCH may also write back an updated row; verify `updated_by_admin` (if such a column exists) handles NULL. (Run `psql -c "\d public.user_nodes"` to check — if no such column, no plumbing change.)

- [ ] **Step 2: Tests for both methods**

Bucket-user cases: edit succeeds for own-workspace node; edit fails 403 for cross-client node; delete same. Add to `tests/integration/user-nodes-crud.test.ts`.

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && npm test
git add netlify/functions/user-nodes-detail.ts tests/integration/user-nodes-crud.test.ts
git commit -m "feat(user-nodes-detail): PATCH+DELETE accept bucket-user with _platform.users.edit/delete"
```

## 4.3 — `user-nodes-move.ts`

- [ ] **Step 1: Refactor**

`user-nodes-move.ts` is POST-only. Fetch the node first (it already does — see lines 32-36 in the current file), then `authorizeClientScope` against `node.client_id`. Use verb `edit`.

If the move target involves a new parent in a different client (the existing code already 400s on `cross_client_parent`), that check stays.

- [ ] **Step 2: Bucket-user move test**

In `tests/integration/user-nodes-move.test.ts`:

```typescript
test('L1 Owner can move a node within their workspace', async () => {
  // Setup: Owner; create an L2 node + an alternate L2 parent in same client.
  // Call POST /api/user-nodes-move?id=<nodeId> with body specifying new parent.
  // Assert: 200; node.parent_id updated.
});

test('Bucket-user cannot move a node in another workspace', async () => {
  // 403 forbidden_cross_client.
});
```

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && npm test
git add netlify/functions/user-nodes-move.ts tests/integration/user-nodes-move.test.ts
git commit -m "feat(user-nodes-move): accepts bucket-user with _platform.users.edit"
```

## 4.4 — `user-node-credential.ts`

- [ ] **Step 1: Refactor — all three methods**

All three methods (GET peek, POST reset, DELETE) → `requirePermission(req, '_platform.users.edit')`. GET is `edit`-grade because peeking the temp pw is privileged.

The credential's `client_id` comes from `user_node_credentials.client_id` (already fetched in the existing handler). Pass that to `authorizeClientScope` after the lookup.

For POST (reset password), the INSERT/UPDATE statements may set `created_by_admin` — make it nullable for bucket-user callers.

- [ ] **Step 2: Tests**

In `tests/integration/user-node-auth.test.ts` (the file already exercises credentials):

```typescript
describe('user-node-credential — bucket-user widening', () => {
  test('L1 Owner can reset another user\'s password', async () => {
    // Setup: Owner; create a target L2 node.
    // Call POST /api/user-node-credential?node=<targetId> with Owner cookie + body {temp_password:'new-pw'}.
    // Assert: 200; target's must_change_password is true; temp pw is set.
  });

  test('L1 Owner can peek another user\'s temp pw', async () => {
    // Same setup; GET /api/user-node-credential?node=<targetId>.
    // Assert: 200; body.temp_password_plain matches what was set.
  });

  test('Bucket-user cannot reset cred for a node in another workspace', async () => {
    // 403 forbidden_cross_client.
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && npm test
git add netlify/functions/user-node-credential.ts tests/integration/user-node-auth.test.ts
git commit -m "feat(user-node-credential): accepts bucket-user with _platform.users.edit"
```

---

# Task 5: Owner-scoped API wrappers

A thin TypeScript module that mirrors the admin `src/modules/ams/api.ts` functions the Manage Team page needs, but without the `clientId` parameter — the server resolves from JWT.

**Files:**
- Create: `src/modules/user-portal/team/api.ts`

- [ ] **Step 1: Create the wrapper file**

```typescript
// src/modules/user-portal/team/api.ts
//
// Owner-scoped API wrappers for Manage Team. Mirrors the team-management
// subset of src/modules/ams/api.ts, but parameter-free where the admin
// version takes clientId — the server resolves the client from the
// bu_session JWT.

import { apiFetch } from '../../../lib/api-client';
import type {
  ClientStructure, ClientRole, ClientLevel,
} from '../../ams/api';

// Types: re-export AMS types where they're identical, define new ones for
// shapes that differ (e.g., UserNode is identical).

export interface UserNode {
  id: string;
  client_id: string;
  parent_id: string | null;
  level_number: number | null;
  role_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  fields: Record<string, unknown>;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by_admin: string | null;
  has_login: boolean;
  has_reset_request: boolean;
}

export const getStructure = () =>
  apiFetch<{ structure: ClientStructure }>('/api/client-structure');

export const listNodes = () =>
  apiFetch<{ nodes: UserNode[] }>('/api/user-nodes');

export const createNode = (body: {
  role_id: string;
  parent_id?: string | null;
  level_number?: number | null;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  fields?: Record<string, unknown>;
  create_login?: boolean;
  temp_password?: string;
}) =>
  apiFetch<{ node: UserNode; login_created?: boolean }>('/api/user-nodes', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const getNode = (nodeId: string) =>
  apiFetch<{ node: UserNode }>(`/api/user-nodes-detail?id=${encodeURIComponent(nodeId)}`);

export const updateNode = (nodeId: string, body: Partial<{
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  fields: Record<string, unknown>;
  role_id: string;
}>) =>
  apiFetch<{ node: UserNode }>(`/api/user-nodes-detail?id=${encodeURIComponent(nodeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const deleteNode = (nodeId: string) =>
  apiFetch<{ ok: true }>(`/api/user-nodes-detail?id=${encodeURIComponent(nodeId)}`, {
    method: 'DELETE',
  });

export const moveNode = (nodeId: string, body: {
  parent_id: string | null;
  level_number: number | null;
}) =>
  apiFetch<{ node: UserNode }>(`/api/user-nodes-move?id=${encodeURIComponent(nodeId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const getCredential = (nodeId: string) =>
  apiFetch<{
    email: string | null;
    must_change_password: boolean;
    temp_password_plain: string | null;
    temp_password_views_left: number | null;
    last_login_at: string | null;
    has_password: boolean;
    has_google: boolean;
    password_reset_requested_at: string | null;
  }>(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}`);

export const resetCredential = (nodeId: string, temp_password: string) =>
  apiFetch<{ ok: true }>(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}`, {
    method: 'POST',
    body: JSON.stringify({ temp_password }),
  });

export const deleteCredential = (nodeId: string) =>
  apiFetch<{ ok: true }>(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}`, {
    method: 'DELETE',
  });

// Re-export for convenience.
export type { ClientStructure, ClientRole, ClientLevel };
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: clean. (No tests for this file directly — it's wrapper-only.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/user-portal/team/api.ts
git commit -m "feat(user-portal): owner-scoped API wrappers for Manage Team"
```

---

# Task 6: Owner-scoped modals (3 files)

Three React modals — `AddTeamMemberModal`, `EditTeamMemberModal`, `LoginManageDrawer` — that mirror the AMS versions but bind to the owner-scoped API from Task 5.

**Strategy:** copy the existing AMS modal file verbatim, then:
1. Rename the exported component.
2. Replace AMS api imports with owner-scoped api imports.
3. Remove any `clientId` props/state — the wrappers no longer need them.
4. Remove any admin-specific affordances (links to admin pages, "Configure Structure" buttons, etc.).
5. Add a header comment pointing at the AMS version.

This is a tedious but mechanical task. Each file ends up similar in shape to its AMS twin.

**Files:**
- Create: `src/modules/user-portal/team/AddTeamMemberModal.tsx`
- Create: `src/modules/user-portal/team/EditTeamMemberModal.tsx`
- Create: `src/modules/user-portal/team/LoginManageDrawer.tsx`

- [ ] **Step 1: Create `AddTeamMemberModal.tsx`**

Open `src/modules/ams/components/AddUserNodeModal.tsx` as the reference. Create the owner-scoped version with:

- Header comment:
  ```typescript
  // Mirrors src/modules/ams/components/AddUserNodeModal.tsx.
  // Owner-scoped: binds to ../team/api (no clientId param).
  // Consolidate when the modals stabilize.
  ```
- Props: `{ structure, levels, parentId | null, levelNumber, onClose, onCreated }` — same shape as the AMS modal MINUS `clientId` (the api wrappers don't need it).
- Imports: `createNode, type ClientStructure, type ClientRole, type ClientLevel` from `./api` (NOT from ams/api).
- Submission: call `createNode(body)` and on success call `onCreated(node)`.
- JSX: identical to AMS version. If the AMS version uses any context (`useAuth`), drop it — bucket-user side has `useUserAuth` already in scope, but this modal probably doesn't need it.

- [ ] **Step 2: Create `EditTeamMemberModal.tsx`**

Same pattern, mirroring `src/modules/ams/components/EditUserNodeModal.tsx`. Props: `{ node, structure, onClose, onUpdated, onDeleted }`. Bind submit to `updateNode(node.id, body)` and delete to `deleteNode(node.id)`.

If the AMS version mounts a sub-modal for credential management (`LoginManageModal`), replace it with our new `LoginManageDrawer`.

- [ ] **Step 3: Create `LoginManageDrawer.tsx`**

Mirror `src/modules/ams/components/LoginManageModal.tsx`. Props: `{ node, onClose, onCredentialChanged }`. Bind to `getCredential(nodeId)`, `resetCredential(nodeId, temp)`, `deleteCredential(nodeId)`.

Drop the Google link/unlink-on-behalf controls per spec §3 (out of scope) — the drawer only does password ops.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Tests**

No unit tests for these (UI components). They will be exercised by the integration tests against the widened endpoints and the manual smoke in Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/modules/user-portal/team/AddTeamMemberModal.tsx \
        src/modules/user-portal/team/EditTeamMemberModal.tsx \
        src/modules/user-portal/team/LoginManageDrawer.tsx
git commit -m "feat(user-portal): owner-scoped Add/Edit/LoginManage modals for Manage Team"
```

---

# Task 7: `UserManageTeam` page

The page assembles the tree-of-chips view (reusing `UserNodeChip` and `LevelRow` from AMS) and wires the 3 modals from Task 6 + the DndContext for drag-to-move.

**Files:**
- Create: `src/modules/user-portal/pages/UserManageTeam.tsx`

- [ ] **Step 1: Reference the admin page**

Open `src/modules/ams/pages/AccessDashboard.tsx` (275 LOC) as the structural reference. The Owner version is a substantially trimmed copy:

| AccessDashboard piece | Owner page? |
|---|---|
| Identity card (client name, role count) | Keep |
| Level filter | Keep (filtering helps when teams grow) |
| Per-level rows of chips | Keep (the main content) |
| DndContext + drag-to-move | Keep |
| Add User button per row | Keep |
| Edit modal on chip click | Keep |
| Configure Structure link | DROP |
| ClientProductsSection | DROP |
| Permission Matrix link | DROP |

- [ ] **Step 2: Create the page**

```typescript
// src/modules/user-portal/pages/UserManageTeam.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useUserAuth } from '../user-auth-context';
import {
  getStructure, listNodes, moveNode,
  type ClientStructure, type ClientLevel, type UserNode,
} from '../team/api';
import { LevelRow } from '../../ams/components/LevelRow';
import { UserNodeChip } from '../../ams/components/UserNodeChip';
import AddTeamMemberModal from '../team/AddTeamMemberModal';
import EditTeamMemberModal from '../team/EditTeamMemberModal';

export default function UserManageTeam() {
  const { slug } = useParams<{ slug: string }>();
  const { user, client } = useUserAuth();
  const [structure, setStructure] = useState<ClientStructure | null>(null);
  const [nodes, setNodes] = useState<UserNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingForLevel, setAddingForLevel] = useState<ClientLevel | null>(null);
  const [editingNode, setEditingNode] = useState<UserNode | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, n] = await Promise.all([getStructure(), listNodes()]);
    if (!s.ok || !n.ok) {
      setError('Failed to load team data.');
      setLoading(false);
      return;
    }
    setStructure(s.data.structure);
    setNodes(n.data.nodes);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDragEnd = useCallback(async (e: DragEndEvent) => {
    if (!e.over || !nodes) return;
    const nodeId = String(e.active.id);
    const overId = String(e.over.id);
    // overId encodes target level/parent — match AccessDashboard's convention.
    // See src/modules/ams/pages/AccessDashboard.tsx for the exact id format.
    // ... call moveNode(nodeId, { parent_id, level_number }) and refresh on success.
  }, [nodes, refresh]);

  if (!slug || !user || !client) return null;
  if (loading) return <div className="page">Loading team…</div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!structure || !nodes) return null;

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Manage team</h1>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          {client.name} · {nodes.length} {nodes.length === 1 ? 'user' : 'users'}
        </p>
      </header>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {structure.levels.map((lvl) => (
          <LevelRow
            key={lvl.id}
            level={lvl}
            nodes={nodes.filter((n) => n.level_number === lvl.level_number)}
            structure={structure}
            onAdd={() => setAddingForLevel(lvl)}
            onNodeClick={(n) => setEditingNode(n)}
            renderChip={(n) => <UserNodeChip node={n} structure={structure} />}
          />
        ))}
      </DndContext>

      {addingForLevel && (
        <AddTeamMemberModal
          structure={structure}
          level={addingForLevel}
          onClose={() => setAddingForLevel(null)}
          onCreated={() => { setAddingForLevel(null); void refresh(); }}
        />
      )}
      {editingNode && (
        <EditTeamMemberModal
          node={editingNode}
          structure={structure}
          onClose={() => setEditingNode(null)}
          onUpdated={() => { setEditingNode(null); void refresh(); }}
          onDeleted={() => { setEditingNode(null); void refresh(); }}
        />
      )}
    </div>
  );
}
```

**Important: the `handleDragEnd` logic is left as a sketch above** — the exact `e.over.id` format depends on what `LevelRow` emits as drop-target ids, which you'll discover by reading `src/modules/ams/pages/AccessDashboard.tsx` (the existing AccessDashboard handler is the source of truth). Copy that handler's body and replace its call to the admin `userNodesApi.move` with the owner-scoped `moveNode(nodeId, body)`.

**Also: `LevelRow`'s prop signature** — if its existing props expect `clientId` or admin-specific callbacks, you'll need to adjust. Read the file before assuming compatibility. If `LevelRow` is not props-compatible without surgery, you have two options: (a) refactor `LevelRow` to be slightly more generic (small change to admin path), or (b) create a thin `OwnerLevelRow` wrapper. Pick (a) if the change is cosmetic; pick (b) if the AMS LevelRow is doing admin-specific things internally.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: clean. If `LevelRow` props mismatch, fix per the note above before continuing.

- [ ] **Step 4: Tests**

No unit test for this page (it composes other tested pieces). Covered by manual smoke in Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/modules/user-portal/pages/UserManageTeam.tsx
# If LevelRow needed adjustment, include it.
git commit -m "feat(user-portal): UserManageTeam page (tree-of-chips + dnd + modals)"
```

---

# Task 8: Router + sidebar + dashboard tile + smoke + push

The wire-up that makes the page reachable, plus the smoke test, plus the prod migration + push.

**Files:**
- Modify: `src/lib/router.tsx`
- Modify: `src/modules/user-portal/layout/Sidebar.tsx`
- Modify: `src/modules/user-portal/pages/UserDashboardHome.tsx`

- [ ] **Step 1: Add the route**

Edit `src/lib/router.tsx`. Find the `UserDashboardLayout` children block (currently has `index`, `account`, `m/:moduleKey`). Add a sibling:

```typescript
{ path: 'team', element: <UserManageTeam /> },
```

And add the import at the top:

```typescript
import UserManageTeam from '../modules/user-portal/pages/UserManageTeam';
```

- [ ] **Step 2: Update the Sidebar**

In `src/modules/user-portal/layout/Sidebar.tsx`, import `useUserAuth` and add a Team entry between Modules and Account:

```typescript
import { useUserAuth } from '../user-auth-context';
// ...
const { user } = useUserAuth();
const isOwner = user && (user.level_number == null || user.level_number === 1);
// ...
// Inside the <nav>, after the Modules block and before the Account NavLink:
{isOwner && (
  <>
    <div className="nav-group-header">Workspace</div>
    <NavLink to={`/c/${slug}/team`}>Team</NavLink>
  </>
)}
```

The L1 gate is intentional v1 simplification (see spec §4.3 asymmetry note). L2+ users granted `_platform.users.view` can still reach the page via direct URL.

- [ ] **Step 3: Update the dashboard tile**

In `src/modules/user-portal/pages/UserDashboardHome.tsx`, replace the Owner-only `StubTile title="Manage team"` with a real Link:

```typescript
// Replace:
<StubTile title="Manage team" description="Add, edit, and remove users in your workspace." />

// With:
<Link to={`/c/${slug}/team`} className="card tile tile-link">
  <div className="tile-title">Manage team</div>
  <div className="tile-sub">Add, edit, and remove users in your workspace.</div>
</Link>
```

The Settings StubTile stays as-is (Settings is a separate future feature).

- [ ] **Step 4: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean; all tests pass (count should be 157 + the new bucket-user integration tests added across Tasks 3-4).

- [ ] **Step 5: Apply migration 023 to prod Neon**

Saved feedback `feedback_migration_before_deploy` requires the prod migration to run BEFORE pushing code that depends on it. The widened endpoints from Tasks 3-4 will fail in prod if `created_by_admin` is still NOT NULL.

```bash
# Verify your local .env has the PROD DATABASE_URL, OR construct it inline.
# The user will provide the prod URL if not stored — DO NOT echo it in chat.
DATABASE_URL=<prod-url> npm run migrate
```

Expected: `023_user_nodes_created_by_admin_nullable` applied to prod. Verify via `psql "$PROD_URL" -c "\d public.user_nodes" | grep created_by_admin` showing no `not null`.

**If you don't have the prod URL on hand, STOP and ask the user before pushing.**

- [ ] **Step 6: Manual smoke test (local dev server)**

The dev server should be running (`npm run dev` → http://localhost:8888). If not, start it.

Log in as Joe (Owner, password = `smoke-stable-pw-2026` per session memory) and exercise:

1. **Click "Manage team" tile on dashboard home** → land on `/c/joe-s-hardware/team`. See the org tree with Joe in L1.
2. **Click "Team" in sidebar** → same landing, sidebar entry shows active state.
3. **Click "+ add" on an L2 row** (or whatever the row affordance shows) → AddTeamMemberModal opens → fill in display_name + email + temp_password → submit → tree updates with the new user.
4. **Click the new user's chip** → EditTeamMemberModal opens → change display_name → submit → chip label updates.
5. **Drag the new user's chip to an L3 row** (if cardinality allows) → confirm dialog → after release, server persists the move and chip appears in L3.
6. **Click "Manage login" inside the edit modal** → LoginManageDrawer opens → click "Reset password" → enter new temp pw → see the new temp pw in the peek view.
7. **Click "Delete" in the edit modal** → confirm → user disappears from the tree.
8. **Sign out + sign in as a non-Owner user if available** → "Team" entry does NOT appear in the sidebar; direct visit to `/c/joe-s-hardware/team` shows the page with a 403 affordance OR the page renders if they have `_platform.users.view` (depends on what perms they have).

If any step fails, fix before committing.

- [ ] **Step 7: Commit + push**

```bash
git add src/lib/router.tsx \
        src/modules/user-portal/layout/Sidebar.tsx \
        src/modules/user-portal/pages/UserDashboardHome.tsx
git commit -m "$(cat <<'EOF'
feat(user-portal): wire Manage Team into router, sidebar, dashboard tile

/c/:slug/team route inside UserDashboardLayout. Sidebar "Team" entry
gated to L1 (Owner) for v1; L2+ with _platform.users.view granted can
still reach via direct URL (one-line upgrade later). Dashboard's
Manage team Owner tile becomes a real Link.

Closes the spec at docs/superpowers/specs/2026-06-03-manage-team-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

# Confirm with the user before push (saved feedback: feedback_no_push_without_approval).
# Once approved:
git push origin main
```

---

## Self-review checklist (after implementation, before reporting done)

- [ ] `npm run typecheck` clean.
- [ ] `npm test` shows expected count: 157 from prior + new bucket-user integration tests across Tasks 3-4 + 8 unit tests from Task 2. Final count ~170+.
- [ ] No `requireAdmin` references remain in: `client-structure.ts`, `user-nodes.ts`, `user-nodes-detail.ts`, `user-nodes-move.ts`, `user-node-credential.ts`. They all use `requirePermission` now.
- [ ] `user-nodes` GET/POST: GET uses verb `view`, POST uses verb `create`.
- [ ] `user-nodes-detail` PATCH/DELETE use verbs `edit`/`delete`.
- [ ] All endpoints that take `?id=<nodeId>` call `authorizeClientScope(session, node.client_id)` after the row lookup.
- [ ] All endpoints that take `?client=<id>` call `resolveClientId(session, req)`.
- [ ] Migration 023 applied to BOTH dev and prod Neon before push.
- [ ] Smoke step 5 (drag-to-move) verified — drag UX is the most failure-prone piece.
- [ ] Smoke step 7 (delete) verified — irreversible operation, confirm dialog should be present.

---

## Out of scope (do not implement)

- Settings page (separate future feature).
- Google link/unlink on behalf of another user.
- L2+ subtree scoping in the UI (L2 with perms sees full workspace).
- Soft delete / deactivate.
- Bulk operations.
- Audit log for who-changed-what.
- Consolidating the AMS modals with the owner-scoped forks (deferred until both stabilize).
- Promoting the Sidebar L1 check to a permission check (defer until first real L2 grant exists).
