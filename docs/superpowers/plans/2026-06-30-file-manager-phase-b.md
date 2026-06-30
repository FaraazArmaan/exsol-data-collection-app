# File Manager — Phase B (Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "polish" slice of the File Manager — storage quotas (pre-check + hard-block), bulk operations (soft-delete / restore / change-tier / add-remove-category), search + sort UI, and lazy thumbnail generation.

**Architecture:** One new migration (`046_workspace_storage_quota`), one new shared helper (`_shared/files-quota.ts`), two new Netlify functions (`files-quota.ts`, `files-bulk.ts`), quota hooks added to the existing `files-upload-url.ts` (pre-check) and `files.ts` POST commit (authoritative block + cache refresh), real WebP thumbnail generation in the existing `files-thumbnail.ts`, and four frontend additions (search input, sort dropdown, `QuotaMeter`, `BulkActionBar`) wired into the shared `FilesPage`.

**Tech Stack:** TypeScript • React 18 • React Router 7 • Netlify Functions v2 • Neon serverless (Postgres) • Netlify Blobs • `sharp` 0.33.5 (already a dep + already in `netlify.toml` `external_node_modules`) • Vitest • Zod • `_shared/audit.ts` (existing).

**Reference spec:** `docs/superpowers/specs/2026-06-04-file-manager-design.md` §4.7 (quota), §5.1–5.3 (endpoints/auth), §10 (test strategy), §9 Phase B.

## Global Constraints

- **Migration number is `046`, NOT `036`.** The spec was written reserving `036` for quota, but `036`–`045` are now taken (Product Manager 033–039, POS 040–042, Booking + POS-v2 storefront *both* claimed 043–045). `046` is the next genuinely-free number. Confirm `046` is still free immediately before applying (`ls db/migrations | tail`) — coordinate per `project_booking_migration_number_coordination` memory.
- **Migrate splitter:** in `.sql` files, never put a comment after a `;` on the same line — `scripts/migrate.ts` only splits on end-of-line `;` and will merge statements → Postgres `42601`. Comments on their own line. (`feedback_migrate_splitter_inline_comment`)
- **Shared dev DB has no per-test teardown.** Randomize any unique literals in tests and clean up rows you insert in a `finally`/`afterAll`. Run the FULL suite before declaring green. (`feedback_tests_share_persistent_dev_db`)
- **Typecheck is mandatory** in every task's verification: `npm run typecheck` must be clean. Runtime/test execution alone does not validate TS. (`feedback_implementer_verify_typecheck`)
- **No `git push`, no merge, no deploy from this worktree.** Local commits only. The parallel chat owns main/prod/integration. (`project_parallel_chat_login_ams_scope`, `feedback_no_push_without_approval`)
- **DB access pattern:** import `db` from `./_shared/db` and call `const sql = db()`. For dynamic-clause queries use the `(sql as unknown as (q: string, p: unknown[]) => Promise<...>)(text, params)` cast exactly as `files.ts`/`files-detail.ts` already do. Tagged-template `sql\`...\`` for static queries.
- **Permission keys:** `_platform.files.view | .create | .edit | .delete`, derived from the `files` platform surface (registered in Phase A) × verbs. `authenticateForPermission(req, key)` returns `AnySession` or a `Response` (401/403) — early-return the `Response`.
- **Session shape:** `AdminSession = { kind:'admin', admin:{id,email} }`; `BucketUserSession = { kind:'bucket_user', user_node_id, client_id, level_number }`. Admin operates on the **admin vault** (`files.client_id IS NULL`, no quota). Quota is **per workspace client only**.
- **Error code style:** `jsonError(status, code, detail?)`. Reuse existing codes; new codes introduced here: `quota_exceeded` (413), `quota_target_required` (400), `bulk_action_invalid` (400), `bulk_empty` (400).

---

## Task 1: Migration 046 — `workspace_storage_quota`

**Files:**
- Create: `db/migrations/046_workspace_storage_quota.sql`
- Modify: `tests/integration/files-migration.test.ts` (append a describe block)

**Interfaces:**
- Produces: table `public.workspace_storage_quota (client_id PK, byte_limit bigint, bytes_used_cached bigint, updated_at)`. Consumed by Task 2's helper.

- [ ] **Step 1: Append the failing migration test**

Append to `tests/integration/files-migration.test.ts`:

```ts
describe('migration 046: workspace_storage_quota', () => {
  test('table exists with expected columns', async () => {
    const cols = (await sql`
      SELECT column_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'workspace_storage_quota'
      ORDER BY ordinal_position
    `) as { column_name: string; column_default: string | null; is_nullable: string }[];
    expect(cols.map((c) => c.column_name)).toEqual([
      'client_id', 'byte_limit', 'bytes_used_cached', 'updated_at',
    ]);
  });

  test('byte_limit defaults to 5 GB', async () => {
    const clients = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (clients.length === 0) return;
    const cid = clients[0]!.id;
    try {
      await sql`INSERT INTO public.workspace_storage_quota (client_id) VALUES (${cid}::uuid)
                ON CONFLICT (client_id) DO NOTHING`;
      const rows = (await sql`
        SELECT byte_limit FROM public.workspace_storage_quota WHERE client_id = ${cid}::uuid
      `) as { byte_limit: string }[];
      expect(Number(rows[0]!.byte_limit)).toBe(5368709120);
    } finally {
      await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${cid}::uuid`;
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/integration/files-migration.test.ts --run`
Expected: FAIL — `workspace_storage_quota` does not exist.

- [ ] **Step 3: Write the migration**

Create `db/migrations/046_workspace_storage_quota.sql`:

```sql
-- Migration 046: workspace_storage_quota — per-client storage budget.
-- See docs/superpowers/specs/2026-06-04-file-manager-design.md section 4.7.
-- (Renumbered from spec's 036; 036-045 were taken by other modules.)
-- bytes_used_cached is for the header meter only; authoritative usage is
-- recomputed on every upload commit (see _shared/files-quota.ts).

CREATE TABLE public.workspace_storage_quota (
  client_id          uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  byte_limit         bigint NOT NULL DEFAULT 5368709120,
  bytes_used_cached  bigint NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Confirm 046 is free, then apply + test**

Run: `ls db/migrations | tail -3`
Expected: `046_workspace_storage_quota.sql` is the highest; no other `046_*`.

Run: `npm run migrate && npm test -- tests/integration/files-migration.test.ts --run`
Expected: migration applies; all migration tests PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/046_workspace_storage_quota.sql tests/integration/files-migration.test.ts
git commit -m "feat(files): migration 046 — workspace_storage_quota"
```

---

## Task 2: `_shared/files-quota.ts` — usage recompute + limit lookup

**Files:**
- Create: `netlify/functions/_shared/files-quota.ts`
- Create: `tests/integration/files-quota-helper.test.ts`

**Interfaces:**
- Consumes: `db` from `./db`; table from Task 1.
- Produces:
  - `getByteLimit(sql, clientId: string): Promise<number>` — returns the client's limit, creating a default row if absent.
  - `recomputeUsage(sql, clientId: string): Promise<number>` — sums non-deleted `byte_size` for the client, writes it into `bytes_used_cached`, returns the sum.
  - `getQuota(sql, clientId: string): Promise<{ byte_limit: number; bytes_used: number }>` — authoritative usage + limit.
  - `wouldExceed(sql, clientId: string, incomingBytes: number): Promise<boolean>` — true if `currentUsage + incomingBytes > byte_limit`.
  - Used by Tasks 3, 4.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/files-quota-helper.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { getByteLimit, recomputeUsage, getQuota, wouldExceed } from '../../netlify/functions/_shared/files-quota';

let sql: ReturnType<typeof neon>;
let clientId: string | null = null;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const c = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
  clientId = c[0]?.id ?? null;
});

afterAll(async () => {
  if (clientId) await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${clientId}::uuid`;
});

describe('files-quota helper', () => {
  test('getByteLimit auto-creates a default 5 GB row', async () => {
    if (!clientId) return;
    await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${clientId}::uuid`;
    const limit = await getByteLimit(sql as never, clientId);
    expect(limit).toBe(5368709120);
  });

  test('recomputeUsage equals SUM(byte_size) of non-deleted files', async () => {
    if (!clientId) return;
    const expected = (await sql`
      SELECT COALESCE(SUM(byte_size), 0)::bigint AS s
      FROM public.files WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL
    `) as { s: string }[];
    const used = await recomputeUsage(sql as never, clientId);
    expect(used).toBe(Number(expected[0]!.s));
  });

  test('getQuota returns both limit and authoritative usage', async () => {
    if (!clientId) return;
    const q = await getQuota(sql as never, clientId);
    expect(q.byte_limit).toBe(5368709120);
    expect(typeof q.bytes_used).toBe('number');
  });

  test('wouldExceed is true past the limit, false under it', async () => {
    if (!clientId) return;
    expect(await wouldExceed(sql as never, clientId, 1)).toBe(false);
    expect(await wouldExceed(sql as never, clientId, 5368709120 + 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/integration/files-quota-helper.test.ts --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `netlify/functions/_shared/files-quota.ts`:

```ts
// Per-client storage-quota helpers for the File Manager.
//
// Authoritative usage is always SUM(byte_size) over non-deleted files; the
// workspace_storage_quota.bytes_used_cached column is a denormalised copy kept
// fresh on every upload commit, used only for the header meter to avoid an
// aggregate query on each page load.

import type { NeonQueryFunction } from '@neondatabase/serverless';

type SQL = NeonQueryFunction<false, false>;

export const DEFAULT_BYTE_LIMIT = 5368709120; // 5 GB

/** Returns the client's byte_limit, creating a default row if none exists. */
export async function getByteLimit(sql: SQL, clientId: string): Promise<number> {
  const rows = (await sql`
    INSERT INTO public.workspace_storage_quota (client_id)
    VALUES (${clientId}::uuid)
    ON CONFLICT (client_id) DO UPDATE SET client_id = EXCLUDED.client_id
    RETURNING byte_limit
  `) as { byte_limit: string }[];
  return Number(rows[0]!.byte_limit);
}

/** Recomputes authoritative usage, writes it to bytes_used_cached, returns it. */
export async function recomputeUsage(sql: SQL, clientId: string): Promise<number> {
  const agg = (await sql`
    SELECT COALESCE(SUM(byte_size), 0)::bigint AS s
    FROM public.files
    WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL
  `) as { s: string }[];
  const used = Number(agg[0]!.s);
  await sql`
    INSERT INTO public.workspace_storage_quota (client_id, bytes_used_cached, updated_at)
    VALUES (${clientId}::uuid, ${used}, now())
    ON CONFLICT (client_id)
    DO UPDATE SET bytes_used_cached = ${used}, updated_at = now()
  `;
  return used;
}

export async function getQuota(
  sql: SQL,
  clientId: string,
): Promise<{ byte_limit: number; bytes_used: number }> {
  const byte_limit = await getByteLimit(sql, clientId);
  const bytes_used = await recomputeUsage(sql, clientId);
  return { byte_limit, bytes_used };
}

/** True when current authoritative usage + incomingBytes would exceed the limit. */
export async function wouldExceed(sql: SQL, clientId: string, incomingBytes: number): Promise<boolean> {
  const { byte_limit, bytes_used } = await getQuota(sql, clientId);
  return bytes_used + Math.max(0, incomingBytes) > byte_limit;
}
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npm test -- tests/integration/files-quota-helper.test.ts --run && npm run typecheck`
Expected: 4 PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/files-quota.ts tests/integration/files-quota-helper.test.ts
git commit -m "feat(files): quota helper — usage recompute + limit lookup"
```

---

## Task 3: `files-quota.ts` endpoint — GET usage, PATCH limit (admin)

**Files:**
- Create: `netlify/functions/files-quota.ts`
- Create: `tests/integration/files-quota.test.ts`

**Interfaces:**
- Consumes: `getQuota`, `getByteLimit` from Task 2; `authenticateForPermission`, `resolveClientIdOrRespond` from `_shared/permissions`; `logAudit`.
- Produces:
  - `GET /api/files-quota` → `{ byte_limit, bytes_used }` for the caller's workspace (bucket_user) or `?client_id=` (admin).
  - `PATCH /api/files-quota` (admin only) `{ client_id, byte_limit }` → `{ ok: true }`, audit `files.quota_changed`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/files-quota.test.ts`. Follow the bootstrap-admin login pattern from `tests/integration/files-upload-url.test.ts` (copy its `beforeAll`/`beforeEach` admin-cookie setup verbatim, changing the email constant to `files-quota-test@example.com`). Then:

```ts
import quotaHandler from '../../netlify/functions/files-quota';
// ...admin-cookie bootstrap copied from files-upload-url.test.ts...

describe('GET /api/files-quota', () => {
  test('admin can read a client quota via ?client_id', async () => {
    const c = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (c.length === 0) return;
    const res = await quotaHandler(
      new Request(`http://localhost/api/files-quota?client_id=${c[0]!.id}`, {
        headers: { cookie: adminCookie },
      }),
      {} as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.byte_limit).toBe('number');
    expect(typeof body.bytes_used).toBe('number');
    await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${c[0]!.id}::uuid`;
  });

  test('unauthenticated → 401', async () => {
    const res = await quotaHandler(new Request('http://localhost/api/files-quota'), {} as never);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/files-quota', () => {
  test('admin sets a new limit; GET reflects it', async () => {
    const c = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (c.length === 0) return;
    const cid = c[0]!.id;
    try {
      const res = await quotaHandler(
        new Request('http://localhost/api/files-quota', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ client_id: cid, byte_limit: 1073741824 }),
        }),
        {} as never,
      );
      expect(res.status).toBe(200);
      const after = (await sql`
        SELECT byte_limit FROM public.workspace_storage_quota WHERE client_id = ${cid}::uuid
      `) as { byte_limit: string }[];
      expect(Number(after[0]!.byte_limit)).toBe(1073741824);
    } finally {
      await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${cid}::uuid`;
    }
  });

  test('missing client_id → 400 quota_target_required', async () => {
    const res = await quotaHandler(
      new Request('http://localhost/api/files-quota', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ byte_limit: 1 }),
      }),
      {} as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('quota_target_required');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/integration/files-quota.test.ts --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the endpoint**

Create `netlify/functions/files-quota.ts`:

```ts
// /api/files-quota
//   GET   → { byte_limit, bytes_used } for the caller's workspace (bucket_user),
//           or for ?client_id=<uuid> (admin).
//   PATCH → admin-only: { client_id, byte_limit } sets a client's limit.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { getByteLimit, getQuota } from './_shared/files-quota';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleGet(req: Request): Promise<Response> {
  const auth = await authenticateForPermission(req, '_platform.files.view');
  if (auth instanceof Response) return auth;
  const session = auth;

  let clientId: string;
  if (session.kind === 'bucket_user') {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    clientId = scope.clientId;
  } else {
    const q = new URL(req.url).searchParams.get('client_id');
    if (!q || !UUID.test(q)) return jsonError(400, 'quota_target_required');
    clientId = q;
  }

  const sql = db();
  const quota = await getQuota(sql, clientId);
  return jsonOk(quota);
}

const PatchBody = z.object({
  client_id:  z.string().uuid(),
  byte_limit: z.number().int().positive().max(5_497_558_138_880), // 5 TB ceiling
});

async function handlePatch(req: Request): Promise<Response> {
  const auth = await authenticateForPermission(req, '_platform.files.view');
  if (auth instanceof Response) return auth;
  const session = auth;
  if (session.kind !== 'admin') return jsonError(403, 'admin_only');

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || !('client_id' in payload)) {
    return jsonError(400, 'quota_target_required');
  }
  const parsed = PatchBody.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const { client_id, byte_limit } = parsed.data;

  const sql = db();
  const oldLimit = await getByteLimit(sql, client_id);
  await sql`
    INSERT INTO public.workspace_storage_quota (client_id, byte_limit, updated_at)
    VALUES (${client_id}::uuid, ${byte_limit}, now())
    ON CONFLICT (client_id)
    DO UPDATE SET byte_limit = ${byte_limit}, updated_at = now()
  `;
  await logAudit(sql, {
    session, op: 'files.quota_changed', clientId: client_id,
    targetType: 'client', targetId: client_id,
    detail: { old_limit: oldLimit, new_limit: byte_limit },
  });
  return jsonOk({ ok: true });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === 'GET')   return handleGet(req);
  if (req.method === 'PATCH') return handlePatch(req);
  return jsonError(405, 'method_not_allowed');
};
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npm test -- tests/integration/files-quota.test.ts --run && npm run typecheck`
Expected: tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/files-quota.ts tests/integration/files-quota.test.ts
git commit -m "feat(files): GET/PATCH /api/files-quota — usage + admin limit"
```

---

## Task 4: Quota enforcement — pre-check at reservation + hard-block at commit

**Files:**
- Modify: `netlify/functions/files-upload-url.ts` (add pre-check)
- Modify: `netlify/functions/files.ts` (add commit-time block + cache refresh)
- Create: `tests/integration/files-quota-enforce.test.ts`

**Interfaces:**
- Consumes: `wouldExceed`, `recomputeUsage` from Task 2.
- Produces: `quota_exceeded` (413) responses from both `POST /api/files-upload-url` and `POST /api/files` commit; `bytes_used_cached` refreshed after every successful workspace commit.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/files-quota-enforce.test.ts`. This test drives the workspace (bucket_user) path, so it needs a seeded workspace login. Reuse the workspace-login helper used by other workspace tests — check `tests/integration/files-commit-and-list.test.ts` for the existing bucket-user bootstrap and copy it. Core assertions:

```ts
// ...bucket-user cookie bootstrap copied from files-commit-and-list.test.ts,
//    capturing `clientId` and `userCookie` for an L1 owner in that client...
import uploadUrlHandler from '../../netlify/functions/files-upload-url';

describe('quota enforcement', () => {
  test('reservation is rejected with 413 when byte_size alone exceeds the limit', async () => {
    // Shrink this client's limit to 100 bytes.
    await sql`
      INSERT INTO public.workspace_storage_quota (client_id, byte_limit)
      VALUES (${clientId}::uuid, 100)
      ON CONFLICT (client_id) DO UPDATE SET byte_limit = 100
    `;
    try {
      const res = await uploadUrlHandler(
        new Request('http://localhost/api/files-upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: userCookie },
          body: JSON.stringify({ filename: 'big.pdf', mime: 'application/pdf', byte_size: 10_000 }),
        }),
        {} as never,
      );
      expect(res.status).toBe(413);
      expect((await res.json()).error).toBe('quota_exceeded');
    } finally {
      await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${clientId}::uuid`;
    }
  });

  test('reservation succeeds under the limit', async () => {
    const res = await uploadUrlHandler(
      new Request('http://localhost/api/files-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: userCookie },
        body: JSON.stringify({ filename: 'ok.pdf', mime: 'application/pdf', byte_size: 10 }),
      }),
      {} as never,
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/integration/files-quota-enforce.test.ts --run`
Expected: FAIL — reservation returns 200 instead of 413 (no enforcement yet).

- [ ] **Step 3a: Add the pre-check to `files-upload-url.ts`**

In `netlify/functions/files-upload-url.ts`, add the import near the other `_shared` imports:

```ts
import { db } from './_shared/db';
import { wouldExceed } from './_shared/files-quota';
```

Then, in the workspace branch where `blob_key` is built for a bucket_user, insert the pre-check **before** `blobKeyFor`. The current workspace branch looks like:

```ts
  } else {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    blob_key = blobKeyFor({ scope: 'workspace', clientId: scope.clientId });
  }
```

Replace it with:

```ts
  } else {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    if (await wouldExceed(db(), scope.clientId, parsed.data.byte_size)) {
      return jsonError(413, 'quota_exceeded');
    }
    blob_key = blobKeyFor({ scope: 'workspace', clientId: scope.clientId });
  }
```

(Admin vault has no quota, so the `session.kind === 'admin'` branch is untouched.)

- [ ] **Step 3b: Add the authoritative block + cache refresh to `files.ts` commit**

In `netlify/functions/files.ts`, add the import:

```ts
import { wouldExceed, recomputeUsage } from './_shared/files-quota';
```

In `handlePost`, after `scope_client_id` is resolved and **before** the `INSERT INTO public.files`, add the authoritative check for workspace blob uploads (URL externals carry no bytes, `byte_size` null → skip):

```ts
  if (scope_client_id !== null && byte_size !== null) {
    if (await wouldExceed(sql, scope_client_id, byte_size)) {
      return jsonError(413, 'quota_exceeded');
    }
  }
```

Note `sql` is created at `const sql = db();` — move that line above this check if it currently sits below the INSERT (it is declared at line ~119; place the check after it). Then, after the audit log call and before `return jsonOk(...)`, refresh the cache:

```ts
  if (scope_client_id !== null) {
    await recomputeUsage(sql, scope_client_id);
  }
```

- [ ] **Step 4: Run to verify pass + typecheck + no regression in files commit tests**

Run: `npm test -- tests/integration/files-quota-enforce.test.ts tests/integration/files-commit-and-list.test.ts tests/integration/files-upload-url.test.ts --run && npm run typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/files-upload-url.ts netlify/functions/files.ts tests/integration/files-quota-enforce.test.ts
git commit -m "feat(files): enforce quota — pre-check at reservation + block at commit"
```

---

## Task 5: `files-bulk.ts` — bulk soft-delete / restore / change-tier / category

**Files:**
- Create: `netlify/functions/files-bulk.ts`
- Create: `tests/integration/files-bulk.test.ts`

**Interfaces:**
- Consumes: `authenticateForPermission`, `resolveClientIdOrRespond`, `ForbiddenError` from `_shared/permissions`; `assertCanWrite`, `isL1Owner` from `_shared/files-access`; `recomputeUsage` from `_shared/files-quota`; `isCategoryKey` from `categories`; `logAudit`.
- Produces: `POST /api/files-bulk` `{ action, file_ids[], ...args }` → `{ result_counts: { ok, skipped } }`, audit `files.bulk_action`.

**Action contract (request body):**
- `{ action: 'soft_delete', file_ids }`
- `{ action: 'restore', file_ids }`
- `{ action: 'change_tier', file_ids, tier, allowed_role_ids?, allowed_node_ids?, allowed_user_node_ids? }` — restricted/confidential require L1 owner; the same audience set is applied to every file (audience tables replaced per file).
- `{ action: 'add_category', file_ids, category }`
- `{ action: 'remove_category', file_ids, category }`

**Per-action permission:** `soft_delete`/`restore` → `_platform.files.delete`; all others → `_platform.files.edit`.

**Scoping rule:** only files the caller can write are touched. Admin → `client_id IS NULL` vault files. Bucket_user → files where `client_id = session client`. `file_ids` not in scope are counted as `skipped`, never error (no cross-client leak).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/files-bulk.test.ts`. Reuse the bucket-user (L1 owner) bootstrap from `files-commit-and-list.test.ts` to get `sql`, `userCookie`, `clientId`. Seed two workspace files directly via SQL in `beforeEach`, capturing their ids. Core assertions:

```ts
import bulkHandler from '../../netlify/functions/files-bulk';

// helper to seed a workspace file owned by the bootstrap node
async function seedFile(title: string): Promise<string> {
  const node = (await sql`
    SELECT id FROM public.user_nodes WHERE client_id = ${clientId}::uuid LIMIT 1
  `) as { id: string }[];
  const r = (await sql`
    INSERT INTO public.files (client_id, type, storage_kind, blob_key, title, tier, uploaded_by_user_node, byte_size)
    VALUES (${clientId}::uuid, 'document', 'blob', ${'k-' + title + '-' + Math.random()}, ${title}, 'public', ${node[0]!.id}::uuid, 10)
    RETURNING id
  `) as { id: string }[];
  return r[0]!.id;
}

describe('POST /api/files-bulk', () => {
  test('soft_delete sets deleted_at and reports ok count', async () => {
    const a = await seedFile('bulk-a');
    const b = await seedFile('bulk-b');
    const res = await bulkHandler(
      new Request('http://localhost/api/files-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: userCookie },
        body: JSON.stringify({ action: 'soft_delete', file_ids: [a, b] }),
      }),
      {} as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).result_counts.ok).toBe(2);
    const rows = (await sql`SELECT deleted_at FROM public.files WHERE id IN (${a}::uuid, ${b}::uuid)`) as { deleted_at: string | null }[];
    expect(rows.every((r) => r.deleted_at !== null)).toBe(true);
  });

  test('restore clears deleted_at', async () => {
    const a = await seedFile('bulk-r');
    await sql`UPDATE public.files SET deleted_at = now() WHERE id = ${a}::uuid`;
    const res = await bulkHandler(
      new Request('http://localhost/api/files-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: userCookie },
        body: JSON.stringify({ action: 'restore', file_ids: [a] }),
      }),
      {} as never,
    );
    expect((await res.json()).result_counts.ok).toBe(1);
    const rows = (await sql`SELECT deleted_at FROM public.files WHERE id = ${a}::uuid`) as { deleted_at: string | null }[];
    expect(rows[0]!.deleted_at).toBeNull();
  });

  test('add_category inserts the join row idempotently', async () => {
    const a = await seedFile('bulk-c');
    const res = await bulkHandler(
      new Request('http://localhost/api/files-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: userCookie },
        body: JSON.stringify({ action: 'add_category', file_ids: [a], category: 'hr_payroll' }),
      }),
      {} as never,
    );
    expect((await res.json()).result_counts.ok).toBe(1);
    const rows = (await sql`SELECT 1 FROM public.file_categories WHERE file_id = ${a}::uuid AND category_key = 'hr_payroll'`) as unknown[];
    expect(rows).toHaveLength(1);
  });

  test('empty file_ids → 400 bulk_empty', async () => {
    const res = await bulkHandler(
      new Request('http://localhost/api/files-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: userCookie },
        body: JSON.stringify({ action: 'soft_delete', file_ids: [] }),
      }),
      {} as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bulk_empty');
  });

  test('files outside the caller client are skipped, not errored', async () => {
    const res = await bulkHandler(
      new Request('http://localhost/api/files-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: userCookie },
        body: JSON.stringify({ action: 'soft_delete', file_ids: ['00000000-0000-0000-0000-000000000000'] }),
      }),
      {} as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).result_counts.ok).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/integration/files-bulk.test.ts --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the endpoint**

Create `netlify/functions/files-bulk.ts`:

```ts
// POST /api/files-bulk — apply one action to many files in the caller's scope.
// Files outside scope are silently skipped (counted), never errored, to avoid
// cross-client existence disclosure.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import {
  authenticateForPermission, resolveClientIdOrRespond, ForbiddenError,
  type AnySession,
} from './_shared/permissions';
import { assertCanWrite, isL1Owner } from './_shared/files-access';
import { recomputeUsage } from './_shared/files-quota';
import { isCategoryKey } from '../../src/modules/files/shared/categories';
import { logAudit } from './_shared/audit';

const FileIds = z.array(z.string().uuid()).min(1).max(500);

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('soft_delete'), file_ids: FileIds }),
  z.object({ action: z.literal('restore'),     file_ids: FileIds }),
  z.object({
    action: z.literal('change_tier'),
    file_ids: FileIds,
    tier: z.enum(['public', 'role', 'restricted', 'confidential']),
    allowed_role_ids: z.array(z.string().uuid()).optional().default([]),
    allowed_node_ids: z.array(z.string().uuid()).optional().default([]),
    allowed_user_node_ids: z.array(z.string().uuid()).optional().default([]),
  }),
  z.object({ action: z.literal('add_category'),    file_ids: FileIds, category: z.string() }),
  z.object({ action: z.literal('remove_category'), file_ids: FileIds, category: z.string() }),
]);

type ParsedBody = z.infer<typeof Body>;

function permFor(action: ParsedBody['action']): string {
  return action === 'soft_delete' || action === 'restore'
    ? '_platform.files.delete'
    : '_platform.files.edit';
}

/** Returns the subset of file_ids that exist within the caller's writable scope. */
async function inScopeIds(
  sql: ReturnType<typeof db>, session: AnySession, fileIds: string[],
): Promise<string[]> {
  const idCsv = fileIds;
  if (session.kind === 'admin') {
    const rows = (await sql`
      SELECT id FROM public.files
      WHERE id = ANY(${idCsv}::uuid[]) AND client_id IS NULL
    `) as { id: string }[];
    return rows.map((r) => r.id);
  }
  const rows = (await sql`
    SELECT id FROM public.files
    WHERE id = ANY(${idCsv}::uuid[]) AND client_id = ${session.client_id}::uuid
  `) as { id: string }[];
  return rows.map((r) => r.id);
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const payload = await req.json().catch(() => null);
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    // Distinguish empty-list from other validation failures for the UI.
    if (payload && typeof payload === 'object' && Array.isArray((payload as { file_ids?: unknown }).file_ids)
        && (payload as { file_ids: unknown[] }).file_ids.length === 0) {
      return jsonError(400, 'bulk_empty');
    }
    return jsonError(400, 'bulk_action_invalid', parsed.error.flatten());
  }
  const body = parsed.data;

  const auth = await authenticateForPermission(req, permFor(body.action));
  if (auth instanceof Response) return auth;
  const session = auth;

  // Bucket-user write block (external customers/employees) — admin & internal pass.
  const sql = db();
  try { await assertCanWrite(sql, session); }
  catch (e) { if (e instanceof ForbiddenError) return jsonError(403, e.key); throw e; }

  if (body.action === 'change_tier'
      && (body.tier === 'restricted' || body.tier === 'confidential')
      && !isL1Owner(session)) {
    return jsonError(403, 'tier_requires_owner');
  }
  if (body.action === 'add_category' || body.action === 'remove_category') {
    if (!isCategoryKey(body.category)) return jsonError(400, 'unknown_category');
  }

  // Admin vault is single-tier (public). Reject non-public bulk tier change there.
  if (session.kind === 'admin' && body.action === 'change_tier' && body.tier !== 'public') {
    return jsonError(400, 'admin_vault_single_tier');
  }

  const ids = await inScopeIds(sql, session, body.file_ids);
  let ok = 0;

  for (const id of ids) {
    switch (body.action) {
      case 'soft_delete':
        await sql`UPDATE public.files SET deleted_at = now() WHERE id = ${id}::uuid AND deleted_at IS NULL`;
        ok++; break;
      case 'restore':
        await sql`UPDATE public.files SET deleted_at = NULL WHERE id = ${id}::uuid`;
        ok++; break;
      case 'change_tier':
        await sql`UPDATE public.files SET tier = ${body.tier}::file_tier, updated_at = now() WHERE id = ${id}::uuid`;
        await sql`DELETE FROM public.file_allowed_roles WHERE file_id = ${id}::uuid`;
        await sql`DELETE FROM public.file_allowed_nodes WHERE file_id = ${id}::uuid`;
        await sql`DELETE FROM public.file_allowed_users WHERE file_id = ${id}::uuid`;
        if (body.tier === 'role') {
          for (const r of body.allowed_role_ids) {
            await sql`INSERT INTO public.file_allowed_roles (file_id, role_id) VALUES (${id}::uuid, ${r}::uuid) ON CONFLICT DO NOTHING`;
          }
        } else if (body.tier === 'restricted') {
          for (const n of body.allowed_node_ids) {
            await sql`INSERT INTO public.file_allowed_nodes (file_id, node_id) VALUES (${id}::uuid, ${n}::uuid) ON CONFLICT DO NOTHING`;
          }
        } else if (body.tier === 'confidential') {
          for (const u of body.allowed_user_node_ids) {
            await sql`INSERT INTO public.file_allowed_users (file_id, user_node_id) VALUES (${id}::uuid, ${u}::uuid) ON CONFLICT DO NOTHING`;
          }
        }
        ok++; break;
      case 'add_category':
        await sql`INSERT INTO public.file_categories (file_id, category_key) VALUES (${id}::uuid, ${body.category}) ON CONFLICT DO NOTHING`;
        ok++; break;
      case 'remove_category':
        await sql`DELETE FROM public.file_categories WHERE file_id = ${id}::uuid AND category_key = ${body.category}`;
        ok++; break;
    }
  }

  const skipped = body.file_ids.length - ids.length;

  // soft_delete/restore change usage; refresh the workspace cache.
  if (session.kind === 'bucket_user' && (body.action === 'soft_delete' || body.action === 'restore')) {
    await recomputeUsage(sql, session.client_id);
  }

  await logAudit(sql, {
    session, op: 'files.bulk_action',
    clientId: session.kind === 'bucket_user' ? session.client_id : null,
    targetType: 'file', targetId: null,
    detail: { action: body.action, file_ids: ids, result_counts: { ok, skipped } },
  });

  return jsonOk({ result_counts: { ok, skipped } });
};
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npm test -- tests/integration/files-bulk.test.ts --run && npm run typecheck`
Expected: all PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/files-bulk.ts tests/integration/files-bulk.test.ts
git commit -m "feat(files): POST /api/files-bulk — delete/restore/tier/category"
```

---

## Task 6: Lazy thumbnail generation in `files-thumbnail.ts`

**Files:**
- Modify: `netlify/functions/files-thumbnail.ts`
- Modify: `tests/integration/files-download-thumbnail.test.ts` (add a lazy-gen case)

**Interfaces:**
- Consumes: `filesStore`, `thumbnailsStore`, `thumbnailKeyFor` from `_shared/files-storage`; `sharp`.
- Produces: on first GET for an `image` file with `thumbnail_key IS NULL`, generates a 400px-wide WebP from the original blob, stores it under `thumbnailKeyFor(blob_key)`, persists `files.thumbnail_key`, and returns the bytes (200). Subsequent GETs serve the stored thumbnail.

- [ ] **Step 1: Add the failing test**

Append to `tests/integration/files-download-thumbnail.test.ts` a case that seeds an image file whose blob holds a real tiny PNG, clears `thumbnail_key`, GETs the thumbnail, and asserts 200 + `content-type: image/webp` + that `thumbnail_key` is now set. Use sharp in the test to produce the seed PNG:

```ts
import sharp from 'sharp';
// ...within the existing describe, with admin cookie + filesStore available...

test('lazy-generates a webp thumbnail on first GET for an image', async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png().toBuffer();
  const blobKey = `admin/${crypto.randomUUID()}`;
  await filesStore().set(blobKey, png);
  const f = (await sql`
    INSERT INTO public.files (client_id, type, storage_kind, blob_key, title, mime, byte_size, tier, uploaded_by_admin)
    VALUES (NULL, 'image', 'blob', ${blobKey}, 'thumb-test', 'image/png', ${png.length}, 'public',
            (SELECT id FROM public.admins LIMIT 1))
    RETURNING id
  `) as { id: string }[];
  const id = f[0]!.id;
  try {
    const res = await thumbnailHandler(
      new Request(`http://localhost/api/files-thumbnail/${id}`, { headers: { cookie: adminCookie } }),
      {} as never,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    const after = (await sql`SELECT thumbnail_key FROM public.files WHERE id = ${id}::uuid`) as { thumbnail_key: string | null }[];
    expect(after[0]!.thumbnail_key).not.toBeNull();
  } finally {
    await sql`DELETE FROM public.files WHERE id = ${id}::uuid`;
    try { await filesStore().delete(blobKey); } catch { /* */ }
  }
});
```

(Import `thumbnailHandler` from `'../../netlify/functions/files-thumbnail'`, `filesStore` from storage, and `crypto` is global in the test runtime. Confirm the existing file already imports `sql`, `adminCookie`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/integration/files-download-thumbnail.test.ts --run`
Expected: FAIL — current handler returns 404 `thumbnail_not_generated`.

- [ ] **Step 3: Implement lazy generation**

In `netlify/functions/files-thumbnail.ts`:

Update the SELECT to also fetch `blob_key` and `client_id` (needed for the persist + ownership already constrained):

```ts
  const rows = (await (sql as unknown as (q: string, p: unknown[]) => Promise<Array<{ thumbnail_key: string | null; type: string; blob_key: string | null }>>)(
    `SELECT thumbnail_key, type, blob_key FROM public.files WHERE ${clauses.join(' AND ')} LIMIT 1`,
    params,
  ));
```

Add imports at the top:

```ts
import sharp from 'sharp';
import { filesStore, thumbnailsStore, thumbnailKeyFor } from './_shared/files-storage';
```

Replace the `if (!rows[0]!.thumbnail_key) return jsonError(404, 'thumbnail_not_generated');` block and the subsequent fetch with:

```ts
  const file = rows[0]!;
  let thumbKey = file.thumbnail_key;

  // Lazy-generate on first request.
  if (!thumbKey) {
    if (!file.blob_key) return jsonError(404, 'thumbnail_unavailable');
    const original = await filesStore().get(file.blob_key, { type: 'arrayBuffer' });
    if (!original) return jsonError(404, 'blob_missing');
    let webp: Buffer;
    try {
      webp = await sharp(Buffer.from(original)).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    } catch (e) {
      console.error('[files] thumbnail generation failed', e);
      return jsonError(422, 'thumbnail_generation_failed');
    }
    thumbKey = thumbnailKeyFor(file.blob_key);
    await thumbnailsStore().set(thumbKey, webp);
    await sql`UPDATE public.files SET thumbnail_key = ${thumbKey} WHERE id = ${id}::uuid`;
    return new Response(new Uint8Array(webp), {
      status: 200,
      headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=86400' },
    });
  }

  const bytes = await thumbnailsStore().get(thumbKey, { type: 'arrayBuffer' });
  if (!bytes) return jsonError(404, 'thumbnail_missing');
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=86400' },
  });
```

Keep the existing `if (rows[0]!.type !== 'image') return jsonError(415, ...)` guard before this block.

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npm test -- tests/integration/files-download-thumbnail.test.ts --run && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/files-thumbnail.ts tests/integration/files-download-thumbnail.test.ts
git commit -m "feat(files): lazy WebP thumbnail generation via sharp"
```

---

## Task 7: Frontend — search input + sort dropdown

**Files:**
- Modify: `src/modules/files/shared/FilesPage.tsx`
- Modify: `src/modules/files/shared/components/FilterBar.tsx`

**Interfaces:**
- Consumes: `listFiles(clientId, { type, category, search, sort })` — already supports `search` + `sort` (see `api.ts`, `types.ts`); backend `files.ts` GET already parses them. This task is **frontend-only**.
- Produces: search + sort state in `FilesPage`, passed to `listFiles`.

- [ ] **Step 1: Add a render test (RTL)**

Create `tests/unit/files-filterbar.test.tsx` (or extend an existing FilesPage render test if present):

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { FilterBar } from '../../src/modules/files/shared/components/FilterBar';

describe('FilterBar search + sort', () => {
  test('typing in search calls onSearchChange (debounced value surfaced)', () => {
    const onSearch = vi.fn();
    render(<FilterBar selected={[]} onChange={() => {}} search="" onSearchChange={onSearch} sort="newest" onSortChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'invoice' } });
    expect(onSearch).toHaveBeenCalledWith('invoice');
  });

  test('changing sort calls onSortChange', () => {
    const onSort = vi.fn();
    render(<FilterBar selected={[]} onChange={() => {}} search="" onSearchChange={() => {}} sort="newest" onSortChange={onSort} />);
    fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: 'name' } });
    expect(onSort).toHaveBeenCalledWith('name');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/unit/files-filterbar.test.tsx --run`
Expected: FAIL — `FilterBar` doesn't accept these props / no search input.

- [ ] **Step 3: Extend `FilterBar`**

Update `src/modules/files/shared/components/FilterBar.tsx` props and render. Add to the `Props` interface:

```ts
  search: string;
  onSearchChange: (s: string) => void;
  sort: 'newest' | 'oldest' | 'name' | 'size';
  onSortChange: (s: 'newest' | 'oldest' | 'name' | 'size') => void;
```

Add, inside the rendered bar (above or beside the category chips):

```tsx
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          type="search"
          placeholder="Search title or description…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ flex: 1, padding: '6px 10px' }}
        />
        <label style={{ fontSize: 12, color: '#888' }}>
          Sort
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as 'newest' | 'oldest' | 'name' | 'size')}
            style={{ marginLeft: 6, padding: '6px 8px' }}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
        </label>
      </div>
```

- [ ] **Step 4: Wire state in `FilesPage`**

In `src/modules/files/shared/FilesPage.tsx`, add state + debounce and pass to `listFiles` and `FilterBar`:

```tsx
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name' | 'size'>('newest');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);
```

Update `load()` to include `search: debouncedSearch || undefined, sort`, the `useEffect` deps to add `debouncedSearch, sort`, and the `<FilterBar>` usage:

```tsx
      <FilterBar
        selected={selectedCategories} onChange={setSelectedCategories}
        search={search} onSearchChange={setSearch}
        sort={sort} onSortChange={setSort}
      />
```

- [ ] **Step 5: Run, typecheck, commit**

Run: `npm test -- tests/unit/files-filterbar.test.tsx --run && npm run typecheck`
Expected: PASS; typecheck clean.

```bash
git add src/modules/files/shared/FilesPage.tsx src/modules/files/shared/components/FilterBar.tsx tests/unit/files-filterbar.test.tsx
git commit -m "feat(files): search input + sort dropdown UI"
```

---

## Task 8: Frontend — `QuotaMeter` (workspace header)

**Files:**
- Create: `src/modules/files/shared/components/QuotaMeter.tsx`
- Modify: `src/modules/files/shared/api.ts` (add `getQuota`)
- Modify: `src/modules/files/shared/types.ts` (add `QuotaResponse`)
- Modify: `src/modules/files/shared/FilesPage.tsx` (mount, workspace only)
- Create: `tests/unit/files-quota-meter.test.tsx`

**Interfaces:**
- Consumes: `GET /api/files-quota` (Task 3).
- Produces: `getQuota(clientId: string): Promise<QuotaResponse>`; `<QuotaMeter clientId refreshKey />` showing `used / limit` with a colored bar (green <80%, amber <100%, red ≥100%).

- [ ] **Step 1: Write the failing render test**

Create `tests/unit/files-quota-meter.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { QuotaMeter } from '../../src/modules/files/shared/components/QuotaMeter';
import * as api from '../../src/modules/files/shared/api';

describe('QuotaMeter', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('renders used and limit in GB', async () => {
    vi.spyOn(api, 'getQuota').mockResolvedValue({ byte_limit: 5368709120, bytes_used: 1073741824 });
    render(<QuotaMeter clientId="c1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText(/1\.0 GB \/ 5\.0 GB/)).toBeInTheDocument());
  });

  test('shows over-quota state at ≥100%', async () => {
    vi.spyOn(api, 'getQuota').mockResolvedValue({ byte_limit: 100, bytes_used: 100 });
    render(<QuotaMeter clientId="c1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/unit/files-quota-meter.test.tsx --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the API client + type**

In `src/modules/files/shared/types.ts` add:

```ts
export interface QuotaResponse {
  byte_limit: number;
  bytes_used: number;
}
```

In `src/modules/files/shared/api.ts` add:

```ts
import type { /* existing */ QuotaResponse } from './types';

export async function getQuota(clientId: string): Promise<QuotaResponse> {
  const sp = new URLSearchParams({ client_id: clientId });
  return jsonFetch<QuotaResponse>(`/api/files-quota?${sp.toString()}`);
}
```

- [ ] **Step 4: Implement `QuotaMeter`**

Create `src/modules/files/shared/components/QuotaMeter.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getQuota } from '../api';

function gb(bytes: number): string {
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

interface Props {
  clientId: string;
  refreshKey: number; // bump to re-fetch after uploads/bulk deletes
}

export function QuotaMeter({ clientId, refreshKey }: Props) {
  const [data, setData] = useState<{ byte_limit: number; bytes_used: number } | null>(null);

  useEffect(() => {
    let alive = true;
    getQuota(clientId).then((q) => { if (alive) setData(q); }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [clientId, refreshKey]);

  if (!data) return null;
  const pct = data.byte_limit > 0 ? Math.min(100, Math.round((data.bytes_used / data.byte_limit) * 100)) : 0;
  const color = pct >= 100 ? '#d33' : pct >= 80 ? '#c80' : '#4a8';

  return (
    <div style={{ minWidth: 180, fontSize: 12, color: '#888' }}>
      <div style={{ marginBottom: 4 }}>{gb(data.bytes_used)} / {gb(data.byte_limit)}</div>
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
           style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Mount in `FilesPage` (workspace only)**

In `FilesPage.tsx`, import `QuotaMeter`, add a `quotaRefresh` counter bumped on upload/bulk change, and render in the header only when `clientId !== null`:

```tsx
  const [quotaRefresh, setQuotaRefresh] = useState(0);
  // ...in the header flex row, after <h2>Files</h2>:
  {clientId && <QuotaMeter clientId={clientId} refreshKey={quotaRefresh} />}
  // ...in UploadModal onUploaded: () => { load(); setQuotaRefresh((n) => n + 1); }
```

- [ ] **Step 6: Run, typecheck, commit**

Run: `npm test -- tests/unit/files-quota-meter.test.tsx --run && npm run typecheck`
Expected: PASS; typecheck clean.

```bash
git add src/modules/files/shared/components/QuotaMeter.tsx src/modules/files/shared/api.ts src/modules/files/shared/types.ts src/modules/files/shared/FilesPage.tsx tests/unit/files-quota-meter.test.tsx
git commit -m "feat(files): QuotaMeter header component (workspace)"
```

---

## Task 9: Frontend — `BulkActionBar` + selection

**Files:**
- Create: `src/modules/files/shared/components/BulkActionBar.tsx`
- Modify: `src/modules/files/shared/api.ts` (add `bulkAction`)
- Modify: `src/modules/files/shared/types.ts` (add `BulkActionBody`, `BulkResult`)
- Modify: `src/modules/files/shared/components/FileGrid.tsx` (selection checkboxes)
- Modify: `src/modules/files/shared/FilesPage.tsx` (selection state + bar)
- Create: `tests/unit/files-bulk-bar.test.tsx`

**Interfaces:**
- Consumes: `POST /api/files-bulk` (Task 5).
- Produces: `bulkAction(body): Promise<BulkResult>`; `<BulkActionBar selectedIds onAction onClear />` slide-up bar with Delete / Restore / Change tier / Add category / Remove category controls; multi-select state in `FilesPage` driving `FileGrid` checkboxes.

- [ ] **Step 1: Write the failing render test**

Create `tests/unit/files-bulk-bar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { BulkActionBar } from '../../src/modules/files/shared/components/BulkActionBar';

describe('BulkActionBar', () => {
  test('hidden when nothing selected', () => {
    const { container } = render(<BulkActionBar selectedIds={[]} isL1Owner onAction={vi.fn()} onClear={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('Delete triggers soft_delete action with selected ids', () => {
    const onAction = vi.fn();
    render(<BulkActionBar selectedIds={['a', 'b']} isL1Owner onAction={onAction} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onAction).toHaveBeenCalledWith({ action: 'soft_delete', file_ids: ['a', 'b'] });
  });

  test('shows count of selected', () => {
    render(<BulkActionBar selectedIds={['a', 'b', 'c']} isL1Owner onAction={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/unit/files-bulk-bar.test.tsx --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Add API client + types**

In `types.ts`:

```ts
export type BulkAction =
  | { action: 'soft_delete'; file_ids: string[] }
  | { action: 'restore'; file_ids: string[] }
  | { action: 'change_tier'; file_ids: string[]; tier: FileTier; allowed_role_ids?: string[]; allowed_node_ids?: string[]; allowed_user_node_ids?: string[] }
  | { action: 'add_category'; file_ids: string[]; category: CategoryKey }
  | { action: 'remove_category'; file_ids: string[]; category: CategoryKey };

export interface BulkResult { result_counts: { ok: number; skipped: number }; }
```

In `api.ts`:

```ts
import type { /* existing */ BulkAction, BulkResult } from './types';

export async function bulkAction(body: BulkAction): Promise<BulkResult> {
  return jsonFetch<BulkResult>('/api/files-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 4: Implement `BulkActionBar`**

Create `src/modules/files/shared/components/BulkActionBar.tsx`. Render `null` when `selectedIds.length === 0`. Provide buttons that call `onAction(...)` with the typed body. For Delete and Restore, pass the action directly. For Change tier / Add-Remove category, render a small inline `<select>` of the category keys (`CATEGORY_KEYS`/`CATEGORY_LABELS`) or tier values; gate `restricted`/`confidential` tier options behind `isL1Owner`. Minimal version sufficient for the test:

```tsx
import { CATEGORY_KEYS, CATEGORY_LABELS, type CategoryKey } from '../categories';
import type { BulkAction } from '../types';

interface Props {
  selectedIds: string[];
  isL1Owner: boolean;
  onAction: (a: BulkAction) => void;
  onClear: () => void;
}

export function BulkActionBar({ selectedIds, isL1Owner, onAction, onClear }: Props) {
  if (selectedIds.length === 0) return null;
  const ids = selectedIds;
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 24px',
      background: '#111', color: '#fff', display: 'flex', gap: 12, alignItems: 'center',
    }}>
      <span>{ids.length} selected</span>
      <button type="button" onClick={() => onAction({ action: 'soft_delete', file_ids: ids })}>Delete</button>
      <button type="button" onClick={() => onAction({ action: 'restore', file_ids: ids })}>Restore</button>
      <select aria-label="Add category" defaultValue=""
        onChange={(e) => { if (e.target.value) onAction({ action: 'add_category', file_ids: ids, category: e.target.value as CategoryKey }); }}>
        <option value="">+ Category…</option>
        {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
      </select>
      <select aria-label="Change tier" defaultValue=""
        onChange={(e) => { if (e.target.value) onAction({ action: 'change_tier', file_ids: ids, tier: e.target.value as never }); }}>
        <option value="">Tier…</option>
        <option value="public">Public</option>
        <option value="role">Role</option>
        {isL1Owner && <option value="restricted">Restricted</option>}
        {isL1Owner && <option value="confidential">Confidential</option>}
      </select>
      <button type="button" onClick={onClear} style={{ marginLeft: 'auto' }}>Clear</button>
    </div>
  );
}
```

(Note: bulk change to `role`/`restricted`/`confidential` without an audience selection leaves files with an empty allow-list — acceptable for v1; the spec treats fine-grained audience editing as the per-file `FileDetailModal` flow. Document this in the bar with a tooltip if time permits.)

- [ ] **Step 5: Selection in `FileGrid` + wire `FilesPage`**

In `FileGrid.tsx` add optional props `selectedIds?: string[]` and `onToggleSelect?: (id: string) => void`; render a checkbox on each tile when `onToggleSelect` is provided. In `FilesPage.tsx`:

```tsx
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  function toggle(id: string) {
    setSelectedIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }
  async function runBulk(a: BulkAction) {
    await bulkAction(a);
    setSelectedIds([]);
    load();
    setQuotaRefresh((n) => n + 1);
  }
  // pass selectedIds + toggle to <FileGrid>, render <BulkActionBar selectedIds={selectedIds} isL1Owner={isL1Owner} onAction={runBulk} onClear={() => setSelectedIds([])} />
```

- [ ] **Step 6: Run, typecheck, commit**

Run: `npm test -- tests/unit/files-bulk-bar.test.tsx --run && npm run typecheck`
Expected: PASS; typecheck clean.

```bash
git add src/modules/files/shared/components/BulkActionBar.tsx src/modules/files/shared/components/FileGrid.tsx src/modules/files/shared/FilesPage.tsx src/modules/files/shared/api.ts src/modules/files/shared/types.ts tests/unit/files-bulk-bar.test.tsx
git commit -m "feat(files): BulkActionBar + multi-select"
```

---

## Task 10: Permission-boundary sweep + full-suite green

**Files:**
- Create: `tests/integration/files-bulk-quota-boundary.test.ts`
- (No source changes expected; this task is the spec §10 "permission boundary" matrix for the new endpoints.)

**Interfaces:**
- Consumes: `files-bulk.ts`, `files-quota.ts`.
- Produces: confirmation that wrong session kinds get 403 (not 404/500) and that bucket-family (external) users cannot write via bulk.

- [ ] **Step 1: Write the boundary tests**

Create `tests/integration/files-bulk-quota-boundary.test.ts`. Using a bucket-family (external) user cookie if a fixture exists (else assert the admin-only quota PATCH path):

```ts
import quotaHandler from '../../netlify/functions/files-quota';

describe('files-quota PATCH is admin-only', () => {
  test('workspace user PATCH → 403', async () => {
    // userCookie = an L1 or L2 bucket_user cookie from the shared bootstrap
    const res = await quotaHandler(
      new Request('http://localhost/api/files-quota', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: userCookie },
        body: JSON.stringify({ client_id: clientId, byte_limit: 1 }),
      }),
      {} as never,
    );
    expect(res.status).toBe(403);
  });

  test('unauthenticated bulk → 401', async () => {
    const bulkHandler = (await import('../../netlify/functions/files-bulk')).default;
    const res = await bulkHandler(
      new Request('http://localhost/api/files-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'soft_delete', file_ids: ['00000000-0000-0000-0000-000000000000'] }),
      }),
      {} as never,
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the boundary tests**

Run: `npm test -- tests/integration/files-bulk-quota-boundary.test.ts --run`
Expected: PASS.

- [ ] **Step 3: Full suite + typecheck (green gate)**

Run: `npm run typecheck && npm test -- --run --reporter=dot 2>&1 | tail -15`
Expected: typecheck clean; entire suite green (Phase A files tests + all new Phase B tests + no regressions elsewhere). Investigate any red before committing.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/files-bulk-quota-boundary.test.ts
git commit -m "test(files): permission-boundary sweep for bulk + quota"
```

---

## Self-Review (completed during planning)

**Spec coverage (§9 Phase B):**
- Migration 036 (quota) → **Task 1** (renumbered 046). ✓
- `files-bulk.ts` → **Task 5**. ✓
- `files-quota.ts` → **Task 3** (+ helper Task 2, enforcement Task 4). ✓
- Thumbnail lazy-gen → **Task 6**. ✓
- Search input, Sort dropdown → **Task 7**. ✓
- `BulkActionBar` → **Task 9**; `QuotaMeter` → **Task 8**. ✓
- Audit `files.bulk_action` (Task 5), `files.quota_changed` (Task 3). ✓
- ~10 tests → 10 tasks, ~24 test cases (expanded by the 4-action bulk scope the user chose). ✓

**Decisions locked (from user):** bulk = soft_delete + restore + change_tier + add/remove_category; quota = pre-check at reservation **and** hard-block at commit.

**Out of Phase B scope (deferred to later phases / follow-up):**
- Admin-facing UI to set a client's quota limit (PATCH endpoint exists; surfacing it on the AMS team page is a separate small task — flag to the parallel chat).
- Bulk change-to-restricted/confidential with per-file audience selection (bar sets tier + empty allow-list; fine-grained audience stays in `FileDetailModal`).
- Cursor pagination UI (backend supports it; not a Phase B deliverable).

**Type consistency check:** `BulkAction` union (types.ts) mirrors the server `Body` discriminated union (files-bulk.ts) action-for-action. `QuotaResponse { byte_limit, bytes_used }` matches `getQuota` server return. `getQuota` (FE api) vs `getQuota` (server helper) are different layers — intentional name reuse, no conflict.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-30-file-manager-phase-b.md`.
