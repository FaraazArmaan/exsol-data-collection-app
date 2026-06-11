# Workspace Data Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GET /api/workspace-export?format=json|zip` that produces a per-client snapshot of users, structure, files metadata, and products metadata, with redacted credential fields and an audit row per export.

**Architecture:** One Netlify Function `workspace-export.ts` orchestrates auth → client scope → collector → format dispatch → audit → stream. The collector lives in `_shared/workspace-export-collect.ts` (single source of truth for redactions, enforced by SELECT-list omission). Two thin formatters live in `_shared/workspace-export-format.ts` — JSON pretty-print and JSZip-built ZIP-of-CSVs. The existing `wrapInZip` helper is **not** reused; it bakes in product-specific README copy and a single-CSV+images layout. The FE adds one card with two download buttons on the existing `UserManageTeam` page, gated by `_platform.workspace.view` (with L1 bypass).

**Tech Stack:** TypeScript 5, Vitest, Neon Postgres (`@neondatabase/serverless`), JSZip (already in repo), React 18, React Router. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-06-11-workspace-export-design.md`. Read before starting; the plan assumes you've read the spec's data model and contract sections.

**Working tree:** `/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT` on branch `feat/ams-workspace-export-iso`. **Before every commit, run `git branch --show-current` and verify it equals `feat/ams-workspace-export-iso`.** Do NOT push, do NOT merge to main — handoff goes to the parallel chat.

---

## Task 1: Register the `workspace` platform surface + audit op label

**Files:**
- Modify: `src/modules/registry/types.ts` (line 19)
- Modify: `src/modules/ams/components/audit/op-labels.ts`
- Test: `tests/unit/workspace-export.test.ts` (new file, this is the first stub)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/workspace-export.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { PLATFORM_SURFACES } from '../../src/modules/registry/types';
import { OP_LABELS } from '../../src/modules/ams/components/audit/op-labels';

describe('workspace export — registry registration', () => {
  test('PLATFORM_SURFACES includes "workspace"', () => {
    expect((PLATFORM_SURFACES as readonly string[]).includes('workspace')).toBe(true);
  });

  test('OP_LABELS has a label for workspace.exported', () => {
    expect(OP_LABELS['workspace.exported']).toBe('Exported workspace data');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/workspace-export.test.ts`
Expected: 2 failures — `'workspace'` missing from tuple; `OP_LABELS['workspace.exported']` is undefined.

- [ ] **Step 3: Modify `src/modules/registry/types.ts` line 19**

Change:
```ts
export const PLATFORM_SURFACES = ['users', 'structure', 'settings', 'files'] as const;
```
To:
```ts
export const PLATFORM_SURFACES = ['users', 'structure', 'settings', 'files', 'workspace'] as const;
```

- [ ] **Step 4: Modify `src/modules/ams/components/audit/op-labels.ts`**

Add this entry inside the `OP_LABELS` object, immediately after the `'admin.deleted'` line (preserve trailing comma):

```ts
  'workspace.exported': 'Exported workspace data',
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/workspace-export.test.ts`
Expected: 2 passes.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean exit (no errors).

- [ ] **Step 7: Verify on the right branch then commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-workspace-export-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add src/modules/registry/types.ts src/modules/ams/components/audit/op-labels.ts tests/unit/workspace-export.test.ts
git commit -m "feat(ams): register workspace platform surface + audit op label

Adds 'workspace' to PLATFORM_SURFACES (yielding _platform.workspace.view
as the export-gate permission key) and a OP_LABELS entry for the new
audit op 'workspace.exported'. No behavior yet; prep for the export
endpoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Build the snapshot collector with enforced redactions

**Files:**
- Create: `netlify/functions/_shared/workspace-export-collect.ts`
- Create: `netlify/functions/_shared/workspace-export-types.ts`
- Test: `tests/unit/workspace-export.test.ts` (append)

- [ ] **Step 1: Define the snapshot types**

Create `netlify/functions/_shared/workspace-export-types.ts` with:

```ts
// Type-only module — shapes the workspace export snapshot.
// Source of truth for the JSON wire format; mirrored 1:1 by CSV columns.

export interface ExportActor {
  kind: 'admin' | 'user_node';
  id: string;
  email: string;
}

export interface WorkspaceSnapshot {
  schema_version: 1;
  exported_at: string;
  exported_by: ExportActor;
  client: Record<string, unknown>;          // one public.clients row
  enabled_products: string[];               // product_key list
  levels: Record<string, unknown>[];        // client_levels
  roles: Record<string, unknown>[];         // client_roles
  cardinality_rules: Record<string, unknown>[];
  user_nodes: Record<string, unknown>[];
  credentials: Record<string, unknown>[];   // password_hash / temp_password_plain / password_reset_requested_at OMITTED
  files: {
    files: Record<string, unknown>[];
    categories: Record<string, unknown>[];
    allowed_nodes: Record<string, unknown>[];
    allowed_roles: Record<string, unknown>[];
    allowed_users: Record<string, unknown>[];
  };
  products: {
    products: Record<string, unknown>[];
    categories: Record<string, unknown>[];
    images: Record<string, unknown>[];
  };
}

export interface TableCounts {
  user_nodes: number;
  credentials: number;
  levels: number;
  roles: number;
  cardinality_rules: number;
  files: number;
  file_categories: number;
  products: number;
  product_categories: number;
  product_images: number;
}

export function countTables(snap: WorkspaceSnapshot): TableCounts {
  return {
    user_nodes: snap.user_nodes.length,
    credentials: snap.credentials.length,
    levels: snap.levels.length,
    roles: snap.roles.length,
    cardinality_rules: snap.cardinality_rules.length,
    files: snap.files.files.length,
    file_categories: snap.files.categories.length,
    products: snap.products.products.length,
    product_categories: snap.products.categories.length,
    product_images: snap.products.images.length,
  };
}
```

- [ ] **Step 2: Write the failing collector tests**

Append to `tests/unit/workspace-export.test.ts`:

```ts
import { collectWorkspaceSnapshot } from '../../netlify/functions/_shared/workspace-export-collect';
import { countTables } from '../../netlify/functions/_shared/workspace-export-types';
import type { ExportActor } from '../../netlify/functions/_shared/workspace-export-types';

// Mock sql tagged template. Routes by the leading FROM clause; returns the
// matching fixture array. Anything unrecognized → empty array (and the test
// will fail loudly because counts will be off).
function mockSqlWithFixtures(fixtures: Record<string, unknown[]>) {
  return ((strings: TemplateStringsArray) => {
    const joined = strings.join(' ').toLowerCase();
    for (const [k, rows] of Object.entries(fixtures)) {
      if (joined.includes(`from public.${k}`) || joined.includes(`from ${k}`)) {
        return Promise.resolve(rows);
      }
    }
    return Promise.resolve([]);
  }) as never;
}

const ACTOR: ExportActor = { kind: 'admin', id: 'admin-1', email: 'admin@x' };

describe('collectWorkspaceSnapshot — shape', () => {
  test('returns schema_version 1 and the supplied actor', async () => {
    const sql = mockSqlWithFixtures({
      clients: [{ id: 'c-1', slug: 's', name: 'N' }],
    });
    const snap = await collectWorkspaceSnapshot(sql, 'c-1', ACTOR);
    expect(snap.schema_version).toBe(1);
    expect(snap.exported_by).toEqual(ACTOR);
    expect(typeof snap.exported_at).toBe('string');
    expect(snap.client).toEqual({ id: 'c-1', slug: 's', name: 'N' });
  });

  test('counts match fixture sizes', async () => {
    const sql = mockSqlWithFixtures({
      clients: [{ id: 'c-1', slug: 's', name: 'N' }],
      client_levels: [{ level_number: 1 }, { level_number: 2 }, { level_number: 3 }],
      client_roles: Array.from({ length: 5 }, (_, i) => ({ id: `r-${i}` })),
      user_nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n-${i}` })),
      files: Array.from({ length: 4 }, (_, i) => ({ id: `f-${i}` })),
      products: Array.from({ length: 2 }, (_, i) => ({ id: `p-${i}` })),
    });
    const snap = await collectWorkspaceSnapshot(sql, 'c-1', ACTOR);
    const c = countTables(snap);
    expect(c.levels).toBe(3);
    expect(c.roles).toBe(5);
    expect(c.user_nodes).toBe(12);
    expect(c.files).toBe(4);
    expect(c.products).toBe(2);
  });
});

describe('collectWorkspaceSnapshot — redactions', () => {
  test('credential rows omit password_hash, temp_password_plain, password_reset_requested_at', async () => {
    const sql = mockSqlWithFixtures({
      clients: [{ id: 'c-1' }],
      user_node_credentials: [
        {
          id: 'cred-1',
          email: 'a@x',
          must_change_password: false,
          last_login_at: '2026-06-11T00:00:00Z',
          // These three MUST NOT appear in the snapshot — but they're in the
          // fixture to prove SELECT-list omission strips them upstream of JS.
          // The collector uses a hand-written SELECT list, so even if the
          // mock returns these keys the collector should ignore them.
          password_hash: 'argon2:secret',
          temp_password_plain: 'temp-secret',
          password_reset_requested_at: '2026-06-10T00:00:00Z',
        },
      ],
    });
    const snap = await collectWorkspaceSnapshot(sql, 'c-1', ACTOR);
    expect(snap.credentials.length).toBe(1);
    const cred = snap.credentials[0]!;
    expect('password_hash' in cred).toBe(false);
    expect('temp_password_plain' in cred).toBe(false);
    expect('password_reset_requested_at' in cred).toBe(false);
    expect(cred.email).toBe('a@x');
  });

  test('guard: no redacted field name appears anywhere in stringified snapshot', async () => {
    const sql = mockSqlWithFixtures({
      clients: [{ id: 'c-1' }],
      user_node_credentials: [
        {
          id: 'cred-1', email: 'a@x', must_change_password: false,
          password_hash: 'argon2:secret', temp_password_plain: 'temp-secret',
          password_reset_requested_at: '2026-06-10T00:00:00Z',
        },
      ],
    });
    const snap = await collectWorkspaceSnapshot(sql, 'c-1', ACTOR);
    const text = JSON.stringify(snap);
    expect(text).not.toMatch(/password_hash/);
    expect(text).not.toMatch(/temp_password_plain/);
    expect(text).not.toMatch(/password_reset_requested_at/);
    expect(text).not.toMatch(/argon2:secret/);
    expect(text).not.toMatch(/temp-secret/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/workspace-export.test.ts`
Expected: import errors / module-not-found for `collectWorkspaceSnapshot`.

- [ ] **Step 4: Implement the collector**

Create `netlify/functions/_shared/workspace-export-collect.ts`:

```ts
// Workspace data export — query layer.
//
// One function: collectWorkspaceSnapshot(sql, clientId, actor) → WorkspaceSnapshot.
//
// SECURITY INVARIANT: The credentials SELECT list does NOT include
// password_hash, temp_password_plain, or password_reset_requested_at.
// These fields are never read into JS memory inside this function. This
// is the single source of truth for the redaction rule; format branches
// CANNOT accidentally leak them because they don't exist on the object.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { ExportActor, WorkspaceSnapshot } from './workspace-export-types';

type SQL = NeonQueryFunction<false, false>;

export async function collectWorkspaceSnapshot(
  sql: SQL,
  clientId: string,
  actor: ExportActor,
): Promise<WorkspaceSnapshot> {
  // Each query is filtered by client_id to enforce per-tenant isolation.
  // Order chosen so the heaviest queries (user_nodes, files, products) come
  // after the lighter ones — small mercy if a network blip mid-collection
  // surfaces a quick error before we've done much work.
  const [clientRow] = (await sql`
    SELECT * FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Record<string, unknown>[];
  if (!clientRow) {
    throw new Error(`workspace_export: client_not_found ${clientId}`);
  }

  const enabledProductRows = (await sql`
    SELECT product_key FROM public.client_enabled_products
    WHERE client_id = ${clientId}::uuid
    ORDER BY product_key ASC
  `) as { product_key: string }[];

  const levels = (await sql`
    SELECT * FROM public.client_levels
    WHERE client_id = ${clientId}::uuid
    ORDER BY level_number ASC
  `) as Record<string, unknown>[];

  const roles = (await sql`
    SELECT * FROM public.client_roles
    WHERE client_id = ${clientId}::uuid
    ORDER BY key ASC
  `) as Record<string, unknown>[];

  const cardinality_rules = (await sql`
    SELECT * FROM public.client_cardinality_rules
    WHERE client_id = ${clientId}::uuid
    ORDER BY level_number ASC, role_id ASC
  `) as Record<string, unknown>[];

  const user_nodes = (await sql`
    SELECT * FROM public.user_nodes
    WHERE client_id = ${clientId}::uuid
    ORDER BY level_number NULLS FIRST, parent_id NULLS FIRST, sort_order ASC, id ASC
  `) as Record<string, unknown>[];

  // REDACTION: explicit SELECT list, omits password_hash, temp_password_plain,
  // password_reset_requested_at. Keep this list in sync with migration 017
  // (and any later additions to user_node_credentials).
  const credentials = (await sql`
    SELECT id, client_id, user_node_id, email, must_change_password,
           last_login_at, created_at, updated_at, created_by_admin
    FROM public.user_node_credentials
    WHERE client_id = ${clientId}::uuid
    ORDER BY email ASC
  `) as Record<string, unknown>[];

  const files = (await sql`
    SELECT * FROM public.files
    WHERE client_id = ${clientId}::uuid
    ORDER BY created_at ASC, id ASC
  `) as Record<string, unknown>[];

  const file_categories = (await sql`
    SELECT * FROM public.file_categories
    WHERE file_id IN (SELECT id FROM public.files WHERE client_id = ${clientId}::uuid)
  `) as Record<string, unknown>[];

  const file_allowed_nodes = (await sql`
    SELECT * FROM public.file_allowed_nodes
    WHERE file_id IN (SELECT id FROM public.files WHERE client_id = ${clientId}::uuid)
  `) as Record<string, unknown>[];

  const file_allowed_roles = (await sql`
    SELECT * FROM public.file_allowed_roles
    WHERE file_id IN (SELECT id FROM public.files WHERE client_id = ${clientId}::uuid)
  `) as Record<string, unknown>[];

  const file_allowed_users = (await sql`
    SELECT * FROM public.file_allowed_users
    WHERE file_id IN (SELECT id FROM public.files WHERE client_id = ${clientId}::uuid)
  `) as Record<string, unknown>[];

  const products = (await sql`
    SELECT * FROM public.products
    WHERE client_id = ${clientId}::uuid
    ORDER BY created_at ASC, id ASC
  `) as Record<string, unknown>[];

  const product_categories = (await sql`
    SELECT * FROM public.product_categories
    WHERE client_id = ${clientId}::uuid
    ORDER BY name ASC
  `) as Record<string, unknown>[];

  const product_images = (await sql`
    SELECT * FROM public.product_images
    WHERE product_id IN (SELECT id FROM public.products WHERE client_id = ${clientId}::uuid)
    ORDER BY product_id ASC, sort_order ASC
  `) as Record<string, unknown>[];

  return {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    exported_by: actor,
    client: clientRow,
    enabled_products: enabledProductRows.map((r) => r.product_key),
    levels,
    roles,
    cardinality_rules,
    user_nodes,
    credentials,
    files: {
      files,
      categories: file_categories,
      allowed_nodes: file_allowed_nodes,
      allowed_roles: file_allowed_roles,
      allowed_users: file_allowed_users,
    },
    products: {
      products,
      categories: product_categories,
      images: product_images,
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/workspace-export.test.ts`
Expected: all tests in this file pass.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-workspace-export-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add netlify/functions/_shared/workspace-export-collect.ts netlify/functions/_shared/workspace-export-types.ts tests/unit/workspace-export.test.ts
git commit -m "feat(ams): workspace snapshot collector with enforced redactions

Single source of truth for 'no password columns' rule — the credentials
SELECT list omits password_hash, temp_password_plain, and
password_reset_requested_at, so the fields never enter JS memory.
Guard test asserts none of the field names appear anywhere in
JSON.stringify(snapshot).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Build the JSON formatter

**Files:**
- Create: `netlify/functions/_shared/workspace-export-format.ts`
- Test: `tests/unit/workspace-export.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/workspace-export.test.ts`:

```ts
import { toJsonResponse, isoFilenameStamp } from '../../netlify/functions/_shared/workspace-export-format';

const SNAPSHOT_FIXTURE = {
  schema_version: 1 as const,
  exported_at: '2026-06-11T10:00:00.000Z',
  exported_by: { kind: 'admin' as const, id: 'a-1', email: 'a@x' },
  client: { id: 'c-1', slug: 'acme', name: 'Acme' },
  enabled_products: ['products'],
  levels: [], roles: [], cardinality_rules: [], user_nodes: [], credentials: [],
  files: { files: [], categories: [], allowed_nodes: [], allowed_roles: [], allowed_users: [] },
  products: { products: [], categories: [], images: [] },
};

describe('isoFilenameStamp', () => {
  test('formats Date as YYYYMMDDTHHMMSSZ', () => {
    expect(isoFilenameStamp(new Date('2026-06-11T10:23:45.678Z'))).toBe('20260611T102345Z');
  });
});

describe('toJsonResponse', () => {
  test('returns 200 with application/json and the right filename', async () => {
    const res = toJsonResponse(SNAPSHOT_FIXTURE, 'acme');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/attachment/);
    expect(cd).toMatch(/filename="workspace-acme-\d{8}T\d{6}Z\.json"/);
  });

  test('body parses back to a snapshot with schema_version 1', async () => {
    const res = toJsonResponse(SNAPSHOT_FIXTURE, 'acme');
    const text = await res.text();
    const parsed = JSON.parse(text);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.client.slug).toBe('acme');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/workspace-export.test.ts`
Expected: module-not-found for `workspace-export-format`.

- [ ] **Step 3: Implement the JSON formatter**

Create `netlify/functions/_shared/workspace-export-format.ts`:

```ts
// Workspace data export — formatters.
//
// Two functions: toJsonResponse, toZipResponse.
// Both take a (snapshot, slug) and return a Response with the right headers
// already set. Caller streams them as-is.

import JSZip from 'jszip';
import type { WorkspaceSnapshot } from './workspace-export-types';
import { countTables } from './workspace-export-types';
import { csvEscape } from './exporters/format-helpers';
import { ExportTooLargeError } from './exporters/types';

export const MAX_BYTES = 4 * 1024 * 1024;

export function isoFilenameStamp(d: Date): string {
  // YYYYMMDDTHHMMSSZ — filesystem-safe (no colons or hyphens in the time).
  const iso = d.toISOString();          // 2026-06-11T10:23:45.678Z
  const datePart = iso.slice(0, 10).replace(/-/g, '');    // 20260611
  const timePart = iso.slice(11, 19).replace(/:/g, '');   // 102345
  return `${datePart}T${timePart}Z`;
}

function buildFilename(slug: string, ext: 'json' | 'zip'): string {
  return `workspace-${slug}-${isoFilenameStamp(new Date())}.${ext}`;
}

export function toJsonResponse(snap: WorkspaceSnapshot, slug: string): Response {
  const body = JSON.stringify(snap, null, 2);
  if (body.length > MAX_BYTES) {
    throw new ExportTooLargeError(body.length, MAX_BYTES);
  }
  const filename = buildFilename(slug, 'json');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

// --- ZIP formatter (implemented in Task 4) ---
export async function toZipResponse(_snap: WorkspaceSnapshot, _slug: string): Promise<Response> {
  throw new Error('toZipResponse: not implemented yet');
}

// Re-export for callers
export { csvEscape };

// Internal helper exported only for testing the per-table CSV builder in Task 4.
export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const lines: string[] = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => {
      const v = r[h];
      if (v == null) return '';
      if (typeof v === 'object') return csvEscape(JSON.stringify(v));
      return csvEscape(v as string | number);
    }).join(','));
  }
  return lines.join('\n');
}

// re-export for the endpoint
export { countTables, JSZip };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/workspace-export.test.ts`
Expected: the new tests pass; old tests still pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-workspace-export-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add netlify/functions/_shared/workspace-export-format.ts tests/unit/workspace-export.test.ts
git commit -m "feat(ams): workspace export JSON formatter + filename stamp

Pretty-printed JSON with Content-Disposition attachment + ISO timestamp
filename (YYYYMMDDTHHMMSSZ). ZIP formatter stubbed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Build the ZIP-of-CSVs formatter

**Files:**
- Modify: `netlify/functions/_shared/workspace-export-format.ts`
- Test: `tests/unit/workspace-export.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/workspace-export.test.ts`:

```ts
import { toZipResponse, rowsToCsv } from '../../netlify/functions/_shared/workspace-export-format';
import JSZipForTest from 'jszip';

describe('rowsToCsv', () => {
  test('empty rows → empty string', () => {
    expect(rowsToCsv([])).toBe('');
  });

  test('basic rows with header row', () => {
    const out = rowsToCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
    expect(out.split('\n')[0]).toBe('a,b');
    expect(out.split('\n')[1]).toBe('1,x');
  });

  test('embedded commas and quotes get RFC-4180 escaped', () => {
    const out = rowsToCsv([{ s: 'a,b' }, { s: 'he said "hi"' }]);
    const lines = out.split('\n');
    expect(lines[1]).toBe('"a,b"');
    expect(lines[2]).toBe('"he said ""hi"""');
  });

  test('jsonb / object values become JSON-encoded strings', () => {
    const out = rowsToCsv([{ id: 'x', fields: { a: 1 } }]);
    expect(out).toContain('"{""a"":1}"');
  });

  test('null values become empty cells', () => {
    const out = rowsToCsv([{ a: null, b: 'x' }]);
    expect(out.split('\n')[1]).toBe(',x');
  });
});

describe('toZipResponse', () => {
  test('returns 200 application/zip with attachment filename', async () => {
    const res = await toZipResponse(SNAPSHOT_FIXTURE, 'acme');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/zip/);
    expect(res.headers.get('content-disposition')).toMatch(/filename="workspace-acme-\d{8}T\d{6}Z\.zip"/);
  });

  test('archive contains the expected file list', async () => {
    const res = await toZipResponse(SNAPSHOT_FIXTURE, 'acme');
    const buf = Buffer.from(await res.arrayBuffer());
    const z = await JSZipForTest.loadAsync(buf);
    const names = Object.keys(z.files).sort();
    expect(names).toEqual([
      'README.txt',
      '_manifest.json',
      'client.csv',
      'client_cardinality_rules.csv',
      'client_levels.csv',
      'client_roles.csv',
      'enabled_products.csv',
      'files/file_allowed_nodes.csv',
      'files/file_allowed_roles.csv',
      'files/file_allowed_users.csv',
      'files/file_categories.csv',
      'files/files.csv',
      'products/product_categories.csv',
      'products/product_images.csv',
      'products/products.csv',
      'user_node_credentials.csv',
      'user_nodes.csv',
    ]);
  });

  test('_manifest.json contains schema_version and table_counts', async () => {
    const res = await toZipResponse(SNAPSHOT_FIXTURE, 'acme');
    const buf = Buffer.from(await res.arrayBuffer());
    const z = await JSZipForTest.loadAsync(buf);
    const manifest = JSON.parse(await z.file('_manifest.json')!.async('string'));
    expect(manifest.schema_version).toBe(1);
    expect(manifest.client_id).toBe('c-1');
    expect(manifest.slug).toBe('acme');
    expect(manifest.table_counts.user_nodes).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/workspace-export.test.ts`
Expected: `toZipResponse` throws "not implemented" / `rowsToCsv` empty-string test passes already, others fail.

- [ ] **Step 3: Replace the `toZipResponse` stub**

In `netlify/functions/_shared/workspace-export-format.ts`, replace the stub with:

```ts
export async function toZipResponse(snap: WorkspaceSnapshot, slug: string): Promise<Response> {
  const z = new JSZip();

  const manifest = {
    schema_version: snap.schema_version,
    exported_at: snap.exported_at,
    exported_by: snap.exported_by,
    client_id: (snap.client as { id?: string }).id ?? null,
    slug,
    table_counts: countTables(snap),
  };
  z.file('_manifest.json', JSON.stringify(manifest, null, 2));

  z.file('README.txt', [
    `ExSol Workspace Data Export`,
    `Workspace slug: ${slug}`,
    `Exported at:    ${snap.exported_at}`,
    `Exported by:    ${snap.exported_by.email} (${snap.exported_by.kind})`,
    `Schema version: ${snap.schema_version}`,
    ``,
    `Files in this archive (CSV, RFC 4180):`,
    `  client.csv                       — single row from public.clients`,
    `  enabled_products.csv             — one column: product_key`,
    `  client_levels.csv                — level definitions`,
    `  client_roles.csv                 — role definitions`,
    `  client_cardinality_rules.csv     — how many of each role at each level`,
    `  user_nodes.csv                   — the org tree (parent_id preserved)`,
    `  user_node_credentials.csv        — workspace logins`,
    `  files/files.csv                  — file metadata`,
    `  files/file_categories.csv`,
    `  files/file_allowed_nodes.csv`,
    `  files/file_allowed_roles.csv`,
    `  files/file_allowed_users.csv`,
    `  products/products.csv`,
    `  products/product_categories.csv`,
    `  products/product_images.csv      — metadata only; no binaries`,
    ``,
    `REDACTIONS (always absent from this export):`,
    `  - password_hash`,
    `  - temp_password_plain`,
    `  - password_reset_requested_at`,
    ``,
    `File and image binaries are NOT included; only their metadata + storage`,
    `keys. The audit log (public.audit_log) is NOT included.`,
  ].join('\n'));

  // Top-level CSVs
  z.file('client.csv', rowsToCsv([snap.client]));
  z.file('enabled_products.csv', rowsToCsv(snap.enabled_products.map((k) => ({ product_key: k }))));
  z.file('client_levels.csv', rowsToCsv(snap.levels));
  z.file('client_roles.csv', rowsToCsv(snap.roles));
  z.file('client_cardinality_rules.csv', rowsToCsv(snap.cardinality_rules));
  z.file('user_nodes.csv', rowsToCsv(snap.user_nodes));
  z.file('user_node_credentials.csv', rowsToCsv(snap.credentials));

  // files/
  z.file('files/files.csv', rowsToCsv(snap.files.files));
  z.file('files/file_categories.csv', rowsToCsv(snap.files.categories));
  z.file('files/file_allowed_nodes.csv', rowsToCsv(snap.files.allowed_nodes));
  z.file('files/file_allowed_roles.csv', rowsToCsv(snap.files.allowed_roles));
  z.file('files/file_allowed_users.csv', rowsToCsv(snap.files.allowed_users));

  // products/
  z.file('products/products.csv', rowsToCsv(snap.products.products));
  z.file('products/product_categories.csv', rowsToCsv(snap.products.categories));
  z.file('products/product_images.csv', rowsToCsv(snap.products.images));

  const buf = await z.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  if (buf.byteLength > MAX_BYTES) {
    throw new ExportTooLargeError(buf.byteLength, MAX_BYTES);
  }

  const filename = buildFilename(slug, 'zip');
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/workspace-export.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-workspace-export-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add netlify/functions/_shared/workspace-export-format.ts tests/unit/workspace-export.test.ts
git commit -m "feat(ams): workspace export ZIP-of-CSVs formatter

Each logical table → one CSV (RFC 4180). _manifest.json carries
schema_version + table_counts. README.txt documents redactions and
that binaries / audit_log are excluded. 4 MB cap → ExportTooLargeError.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire the endpoint — auth, format dispatch, audit, error mapping

**Files:**
- Create: `netlify/functions/workspace-export.ts`
- Test: `tests/integration/workspace-export.test.ts` (new)

- [ ] **Step 1: Write the failing integration tests (gate + format + auth)**

Create `tests/integration/workspace-export.test.ts`:

```ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import workspaceExportHandler from '../../netlify/functions/workspace-export';

const ADMIN_EMAIL = 'workspace-export-test@example.com';
const ADMIN_PASSWORD = 'workspace-export-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let adminId: string;
let adminCookie: string;
let clientAId: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'WE Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
    RETURNING id
  `) as { id: string }[];
  adminId = rows[0]!.id;

  // Seed a minimal client
  const clientRows = (await sql`
    INSERT INTO public.clients (slug, name, created_by_admin)
    VALUES ('we-test-acme', 'WE Test Acme', ${adminId})
    ON CONFLICT (slug) DO UPDATE SET name = 'WE Test Acme'
    RETURNING id
  `) as { id: string }[];
  clientAId = clientRows[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  adminCookie = lr.headers.get('set-cookie')!.split(';')[0]!;
});

afterEach(async () => {
  await sql`DELETE FROM public.audit_log WHERE op = 'workspace.exported' AND client_id = ${clientAId}::uuid`;
});

function buildReq(qs: string, opts: { cookie?: string; method?: string } = {}) {
  return new Request(`http://localhost/api/workspace-export${qs}`, {
    method: opts.method ?? 'GET',
    headers: opts.cookie ? { cookie: opts.cookie } : {},
  });
}

describe('workspace-export — gates', () => {
  test('POST → 405', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie, method: 'POST' }),
      CTX,
    );
    expect(res.status).toBe(405);
  });

  test('missing format → 400 invalid_format', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('invalid_format');
  });

  test('format=foo → 400 invalid_format', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=foo&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(400);
  });

  test('no cookie → 401', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`),
      CTX,
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/workspace-export.test.ts`
Expected: module-not-found for `workspace-export.ts` handler.

- [ ] **Step 3: Implement the endpoint**

Create `netlify/functions/workspace-export.ts`:

```ts
// GET /api/workspace-export?format=json|zip
//
// Per-client snapshot of workspace data — users, structure, files metadata,
// products metadata. JSON or ZIP-of-CSVs. Gated by _platform.workspace.view
// (with L1 Owner bypass). Writes one workspace.exported audit row before
// streaming.
//
// Spec: docs/superpowers/specs/2026-06-11-workspace-export-design.md

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import {
  authenticateForPermission,
  resolveClientIdOrRespond,
  type AnySession,
} from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { ExportTooLargeError } from './_shared/exporters/types';
import { collectWorkspaceSnapshot } from './_shared/workspace-export-collect';
import { toJsonResponse, toZipResponse } from './_shared/workspace-export-format';
import { countTables, type ExportActor } from './_shared/workspace-export-types';

function isFormat(v: string | null): v is 'json' | 'zip' {
  return v === 'json' || v === 'zip';
}

async function actorFor(session: AnySession, sql: ReturnType<typeof db>): Promise<ExportActor> {
  if (session.kind === 'admin') {
    return { kind: 'admin', id: session.admin.id, email: session.admin.email };
  }
  // bucket_user — fetch email from credentials by user_node_id.
  const rows = (await sql`
    SELECT email FROM public.user_node_credentials
    WHERE user_node_id = ${session.user_node_id}::uuid
    LIMIT 1
  `) as { email: string }[];
  return {
    kind: 'user_node',
    id: session.user_node_id,
    email: rows[0]?.email ?? '',
  };
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const url = new URL(req.url);
  const formatParam = url.searchParams.get('format');
  if (!isFormat(formatParam)) return jsonError(400, 'invalid_format');
  const format: 'json' | 'zip' = formatParam;

  const auth = await authenticateForPermission(req, '_platform.workspace.view');
  if (auth instanceof Response) return auth;
  const session = auth;

  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const sql = db();

  // Look up slug for the filename + audit detail.
  const clientRows = (await sql`
    SELECT slug FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as { slug: string }[];
  if (clientRows.length === 0) return jsonError(404, 'client_not_found');
  const slug = clientRows[0]!.slug;

  const actor = await actorFor(session, sql);

  let snapshot;
  try {
    snapshot = await collectWorkspaceSnapshot(sql, clientId, actor);
  } catch (e) {
    console.error('[workspace-export] collect failed', (e as Error).message);
    return jsonError(500, 'internal_error');
  }

  let response: Response;
  try {
    response = format === 'json'
      ? toJsonResponse(snapshot, slug)
      : await toZipResponse(snapshot, slug);
  } catch (e) {
    if (e instanceof ExportTooLargeError) {
      return jsonError(413, 'export_too_large', { size_bytes: e.sizeBytes, limit_bytes: e.limit });
    }
    console.error('[workspace-export] format failed', (e as Error).message);
    return jsonError(500, 'internal_error');
  }

  // Audit on success only (failures self-log to stderr above).
  const byteCount =
    response.headers.get('content-length')
      ? Number(response.headers.get('content-length'))
      : 0;
  await logAudit(sql, {
    session,
    op: 'workspace.exported',
    clientId,
    targetType: 'workspace',
    targetId: clientId,
    detail: {
      format,
      byte_count: byteCount,
      table_counts: countTables(snapshot),
    },
  });

  return response;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/workspace-export.test.ts`
Expected: 4 gate-tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-workspace-export-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add netlify/functions/workspace-export.ts tests/integration/workspace-export.test.ts
git commit -m "feat(ams): GET /api/workspace-export endpoint

Method + format + auth + client-scope gates wired. JSON and ZIP
dispatch through the new formatters. Writes workspace.exported audit
row on success. 413 mapped from ExportTooLargeError.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Happy-path 200s + permission boundary integration tests

**Files:**
- Modify: `tests/integration/workspace-export.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/workspace-export.test.ts`:

```ts
import JSZipForTest from 'jszip';

describe('workspace-export — admin happy paths', () => {
  test('format=json returns 200 with workspace-<slug>-<iso>.json filename', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('content-disposition')).toMatch(/filename="workspace-we-test-acme-\d{8}T\d{6}Z\.json"/);
    const body = await res.json();
    expect(body.schema_version).toBe(1);
    expect(body.client.id).toBe(clientAId);
  });

  test('format=json body never contains password_hash / temp_password_plain / password_reset_requested_at', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    const text = await res.text();
    expect(text).not.toMatch(/password_hash/);
    expect(text).not.toMatch(/temp_password_plain/);
    expect(text).not.toMatch(/password_reset_requested_at/);
  });

  test('format=zip returns 200 application/zip; manifest schema_version=1', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=zip&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/zip/);
    const buf = Buffer.from(await res.arrayBuffer());
    const z = await JSZipForTest.loadAsync(buf);
    const manifest = JSON.parse(await z.file('_manifest.json')!.async('string'));
    expect(manifest.schema_version).toBe(1);
    expect(manifest.client_id).toBe(clientAId);
  });

  test('admin without ?client= → 400 missing_client', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('missing_client');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/workspace-export.test.ts`
Expected: existing 4 gate tests still pass; the new 4 tests now run and pass (the endpoint already implements them). If they fail, debug — DO NOT skip; the audit row guard in Task 7 depends on these being correct.

If any of the new tests fail, fix in `netlify/functions/workspace-export.ts`; do not modify tests.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-workspace-export-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add tests/integration/workspace-export.test.ts
git commit -m "test(ams): workspace export — admin JSON/ZIP happy paths + redaction guard

Asserts 200 + filename pattern + redacted field names absent from JSON
body + manifest shape in ZIP. Pins missing-client to 400.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Cross-tenant safety + audit row + 413

**Files:**
- Modify: `tests/integration/workspace-export.test.ts` (append)

- [ ] **Step 1: Seed a second client and a bucket-user, write the failing tests**

Append to `tests/integration/workspace-export.test.ts`:

```ts
import { hashPassword as hashPw } from '../../netlify/functions/_shared/argon';
import buLoginHandler from '../../netlify/functions/u-login';
import { ExportTooLargeError } from '../../netlify/functions/_shared/exporters/types';

// We seed a second client B with a uniquely-named user_node so the
// cross-tenant test has a needle to look for.
let clientBId: string;
let clientBNeedleNodeId: string;

beforeAll(async () => {
  const clientRows = (await sql`
    INSERT INTO public.clients (slug, name, created_by_admin)
    VALUES ('we-test-bravo', 'WE Test Bravo', ${adminId})
    ON CONFLICT (slug) DO UPDATE SET name = 'WE Test Bravo'
    RETURNING id
  `) as { id: string }[];
  clientBId = clientRows[0]!.id;

  // Seed one role + L1 for clientB so the user_node FK is satisfied.
  const roleRows = (await sql`
    INSERT INTO public.client_roles (client_id, key, name, created_by_admin)
    VALUES (${clientBId}, 'owner', 'Owner', ${adminId})
    ON CONFLICT (client_id, key) DO UPDATE SET name = 'Owner'
    RETURNING id
  `) as { id: string }[];
  const roleBId = roleRows[0]!.id;

  await sql`
    INSERT INTO public.client_levels (client_id, level_number, name, permissions, created_by_admin)
    VALUES (${clientBId}, 1, 'Primary', '{}'::jsonb, ${adminId})
    ON CONFLICT (client_id, level_number) DO NOTHING
  `;

  const nodeRows = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientBId}, NULL, 1, ${roleBId}, 'CLIENT_B_NEEDLE_HUMAN', 'needle@b.test', ${adminId})
    RETURNING id
  `) as { id: string }[];
  clientBNeedleNodeId = nodeRows[0]!.id;
});

afterAll(async () => {
  await sql`DELETE FROM public.user_nodes WHERE client_id = ${clientBId}::uuid`;
  await sql`DELETE FROM public.client_levels WHERE client_id = ${clientBId}::uuid`;
  await sql`DELETE FROM public.client_roles WHERE client_id = ${clientBId}::uuid`;
  await sql`DELETE FROM public.clients WHERE id = ${clientBId}::uuid`;
});

describe('workspace-export — cross-tenant safety (highest-value test)', () => {
  test('exporting client A does NOT include client B rows', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('CLIENT_B_NEEDLE_HUMAN');
    expect(text).not.toContain(clientBNeedleNodeId);
    expect(text).not.toContain('needle@b.test');
  });
});

describe('workspace-export — audit row', () => {
  test('exactly one workspace.exported row written per successful export', async () => {
    // Pre-clear
    await sql`DELETE FROM public.audit_log WHERE op = 'workspace.exported' AND client_id = ${clientAId}::uuid`;

    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(200);

    const rows = (await sql`
      SELECT actor_admin, actor_user_node, target_type, target_id, detail
      FROM public.audit_log
      WHERE op = 'workspace.exported' AND client_id = ${clientAId}::uuid
      ORDER BY occurred_at DESC LIMIT 5
    `) as Array<{
      actor_admin: string | null;
      actor_user_node: string | null;
      target_type: string;
      target_id: string;
      detail: Record<string, unknown>;
    }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.actor_admin).toBe(adminId);
    expect(rows[0]!.actor_user_node).toBeNull();
    expect(rows[0]!.target_type).toBe('workspace');
    expect(rows[0]!.target_id).toBe(clientAId);
    const d = rows[0]!.detail as { format: string; table_counts: Record<string, number> };
    expect(d.format).toBe('json');
    expect(typeof d.table_counts.user_nodes).toBe('number');
  });
});

describe('workspace-export — 413 path (mocked)', () => {
  test('ExportTooLargeError mapped to 413 with size_bytes + limit_bytes', async () => {
    // Stub the JSON formatter via the exports object to throw the error.
    // Done by spying on the module — vitest's vi.spyOn won't reach Response;
    // simpler: feed the endpoint a giant byte_count via a dedicated test that
    // exercises the catch block. We test the mapping at the handler edge by
    // verifying the response code; the formatter's own 413-throw is covered
    // in the unit suite (Task 4 tests that the cap throws).
    //
    // Approach: temporarily wrap MAX_BYTES in the format module by mocking it.
    const mod = await import('../../netlify/functions/_shared/workspace-export-format');
    const originalToJson = mod.toJsonResponse;
    const spy = (mod as unknown as { toJsonResponse: typeof originalToJson }).toJsonResponse =
      ((_s: never, _slug: string) => { throw new ExportTooLargeError(9_000_000, 4_194_304); }) as typeof originalToJson;
    try {
      const res = await workspaceExportHandler(
        buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
        CTX,
      );
      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error?.code).toBe('export_too_large');
      expect(body.error?.details?.size_bytes).toBe(9_000_000);
      expect(body.error?.details?.limit_bytes).toBe(4_194_304);
    } finally {
      (mod as unknown as { toJsonResponse: typeof originalToJson }).toJsonResponse = originalToJson;
      void spy;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/workspace-export.test.ts`
Expected: cross-tenant + audit pass on first try (endpoint already correct); 413 test may fail if the import-spying technique doesn't work as written — see Step 3.

- [ ] **Step 3: If the 413 test fails, adjust the technique**

The 413 test relies on monkey-patching the module exports. If vitest's module system makes this brittle, replace with a simpler integration approach: temporarily set the `MAX_BYTES` constant to a value smaller than the snapshot, by introducing an ENV-var override in `workspace-export-format.ts`:

```ts
export const MAX_BYTES = Number(process.env.WORKSPACE_EXPORT_MAX_BYTES) || 4 * 1024 * 1024;
```

Then the test sets `process.env.WORKSPACE_EXPORT_MAX_BYTES = '100'` before calling the handler. This is a real env-override path the user can also use in prod for emergencies. Update the spec's §10 (Operational notes) with this env var if you take this path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/workspace-export.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-workspace-export-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add tests/integration/workspace-export.test.ts netlify/functions/_shared/workspace-export-format.ts docs/superpowers/specs/2026-06-11-workspace-export-design.md
git commit -m "test(ams): workspace export — cross-tenant + audit row + 413

Cross-tenant test seeds a needle in client B; asserts the needle never
appears in client A's export. Audit row test asserts exactly one row
per successful export with correct actor + detail. 413 path mapped
through ExportTooLargeError.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(If Step 3 was taken, the spec amendment for the env-var override is included in this commit.)

---

## Task 8: Bucket-user permission boundary integration tests

**Files:**
- Modify: `tests/integration/workspace-export.test.ts` (append)

This task asserts the four-quadrant permission matrix for bucket-users: L1 bypass, L2 with perm, L2 without perm. Admin is already covered by Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/workspace-export.test.ts`:

```ts
async function seedBucketUserForClientA(opts: { levelNumber: number; permKey?: string }) {
  // Reuses clientAId from beforeAll. Idempotent.
  const roleRows = (await sql`
    INSERT INTO public.client_roles (client_id, key, name, created_by_admin)
    VALUES (${clientAId}, ${'role-L' + opts.levelNumber}, ${'Role L' + opts.levelNumber}, ${adminId})
    ON CONFLICT (client_id, key) DO UPDATE SET name = ${'Role L' + opts.levelNumber}
    RETURNING id
  `) as { id: string }[];
  const roleId = roleRows[0]!.id;

  const perms: Record<string, true> = opts.permKey ? { [opts.permKey]: true } : {};
  await sql`
    INSERT INTO public.client_levels (client_id, level_number, name, permissions, created_by_admin)
    VALUES (${clientAId}, ${opts.levelNumber}, ${'Level ' + opts.levelNumber}, ${JSON.stringify(perms)}::jsonb, ${adminId})
    ON CONFLICT (client_id, level_number) DO UPDATE SET permissions = ${JSON.stringify(perms)}::jsonb
  `;

  // Parent for L2+: pick any L1 node.
  let parentId: string | null = null;
  if (opts.levelNumber > 1) {
    const pRows = (await sql`
      SELECT id FROM public.user_nodes WHERE client_id = ${clientAId}::uuid AND level_number = 1 LIMIT 1
    `) as { id: string }[];
    parentId = pRows[0]?.id ?? null;
    if (!parentId) {
      // Seed an L1 node if missing.
      const l1Role = (await sql`
        INSERT INTO public.client_roles (client_id, key, name, created_by_admin)
        VALUES (${clientAId}, 'owner', 'Owner', ${adminId})
        ON CONFLICT (client_id, key) DO UPDATE SET name = 'Owner'
        RETURNING id
      `) as { id: string }[];
      await sql`
        INSERT INTO public.client_levels (client_id, level_number, name, permissions, created_by_admin)
        VALUES (${clientAId}, 1, 'Primary', '{}'::jsonb, ${adminId})
        ON CONFLICT (client_id, level_number) DO NOTHING
      `;
      const seed = (await sql`
        INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, created_by_admin)
        VALUES (${clientAId}, NULL, 1, ${l1Role[0]!.id}, 'L1 Owner Seed', ${adminId})
        RETURNING id
      `) as { id: string }[];
      parentId = seed[0]!.id;
    }
  }

  const email = `bu-l${opts.levelNumber}@we-test.example`;
  const nodeRows = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientAId}, ${parentId}, ${opts.levelNumber}, ${roleId},
            ${'BU L' + opts.levelNumber}, ${email}, ${adminId})
    ON CONFLICT (client_id, lower(email::text)) DO UPDATE SET display_name = ${'BU L' + opts.levelNumber}
    RETURNING id
  `) as { id: string }[];
  const nodeId = nodeRows[0]!.id;

  const pw = `bu-pw-L${opts.levelNumber}`;
  const h = await hashPw(pw);
  await sql`
    INSERT INTO public.user_node_credentials
      (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
    VALUES (${clientAId}, ${nodeId}, ${email}, ${h}, false, ${adminId})
    ON CONFLICT (user_node_id) DO UPDATE SET password_hash = ${h}, must_change_password = false
  `;

  return { nodeId, email, password: pw };
}

async function loginBucketUser(email: string, password: string, slug: string): Promise<string> {
  const r = await buLoginHandler(
    new Request(`http://localhost/api/u-login?client=${slug}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }), CTX,
  );
  if (r.status !== 200) throw new Error(`bucket-user login failed: ${r.status} ${await r.text()}`);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

describe('workspace-export — bucket-user permission boundary', () => {
  test('L1 Owner without explicit perm → 200 (matrix bypass)', async () => {
    const u = await seedBucketUserForClientA({ levelNumber: 1 });
    const cookie = await loginBucketUser(u.email, u.password, 'we-test-acme');
    const res = await workspaceExportHandler(
      buildReq(`?format=json`, { cookie }),
      CTX,
    );
    expect(res.status).toBe(200);
  });

  test('L2 without perm → 403', async () => {
    const u = await seedBucketUserForClientA({ levelNumber: 2 });
    const cookie = await loginBucketUser(u.email, u.password, 'we-test-acme');
    const res = await workspaceExportHandler(
      buildReq(`?format=json`, { cookie }),
      CTX,
    );
    expect(res.status).toBe(403);
  });

  test('L2 with _platform.workspace.view granted → 200', async () => {
    const u = await seedBucketUserForClientA({
      levelNumber: 2,
      permKey: '_platform.workspace.view',
    });
    const cookie = await loginBucketUser(u.email, u.password, 'we-test-acme');
    const res = await workspaceExportHandler(
      buildReq(`?format=json`, { cookie }),
      CTX,
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/integration/workspace-export.test.ts`
Expected: all permission-matrix tests pass. If u-login has its own cookie name and the cookie-extraction fails, log the response headers from the helper and adjust.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-workspace-export-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add tests/integration/workspace-export.test.ts
git commit -m "test(ams): workspace export — bucket-user permission boundary

L1 Owner bypasses the matrix (200 without explicit perm). L2 without
perm → 403. L2 with _platform.workspace.view granted → 200.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: FE — WorkspaceExportCard component + permission check

**Files:**
- Create: `src/modules/ams/components/settings/WorkspaceExportCard.tsx`
- Create: `tests/unit/WorkspaceExportCard.test.tsx`
- Modify: `src/lib/components.css` (append)

- [ ] **Step 1: Write the failing component tests**

Create `tests/unit/WorkspaceExportCard.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkspaceExportCard from '../../src/modules/ams/components/settings/WorkspaceExportCard';
import { UserAuthCtxForTesting } from '../../src/modules/user-portal/user-auth-context';

function withAuth(opts: {
  permissions: Record<string, true>;
  level_number?: number | null;
  slug?: string;
}) {
  // Renders the card with a stubbed useUserAuth value.
  return (
    <UserAuthCtxForTesting.Provider
      value={{
        user: { id: 'u-1', display_name: 'Test', email: 't@x', level_number: opts.level_number ?? 5 } as never,
        client: { id: 'c-1', slug: opts.slug ?? 'acme', name: 'Acme' } as never,
        permissions: opts.permissions,
        enabledModules: [],
        loading: false,
        refresh: async () => {},
        signOut: async () => {},
      }}
    >
      <WorkspaceExportCard />
    </UserAuthCtxForTesting.Provider>
  );
}

beforeEach(() => {
  global.fetch = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as never;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('WorkspaceExportCard — visibility', () => {
  test('renders when _platform.workspace.view is true', () => {
    render(withAuth({ permissions: { '_platform.workspace.view': true } }));
    expect(screen.getByText(/workspace backup/i)).toBeTruthy();
  });

  test('renders null when no permission and level > 1', () => {
    const { container } = render(withAuth({ permissions: {}, level_number: 5 }));
    expect(container.textContent).toBe('');
  });

  test('L1 bypass: level_number === 1 renders even without explicit perm', () => {
    render(withAuth({ permissions: {}, level_number: 1 }));
    expect(screen.getByText(/workspace backup/i)).toBeTruthy();
  });
});

describe('WorkspaceExportCard — download click', () => {
  test('clicking "Download JSON" calls fetch with ?format=json exactly once', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    global.fetch = f as never;
    render(withAuth({ permissions: { '_platform.workspace.view': true }, slug: 'acme' }));
    fireEvent.click(screen.getByRole('button', { name: /download json/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0]![0] as string).includes('/api/workspace-export?format=json')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/WorkspaceExportCard.test.tsx`
Expected: module-not-found + missing `UserAuthCtxForTesting` export.

- [ ] **Step 3: Export the context for testing**

In `src/modules/user-portal/user-auth-context.tsx`, find the `Ctx` constant declaration and add a named re-export beside it:

```ts
// Exported for unit tests that need to inject a fake auth value without
// going through the provider's effect chain.
export const UserAuthCtxForTesting = Ctx;
```

- [ ] **Step 4: Implement the component**

Create `src/modules/ams/components/settings/WorkspaceExportCard.tsx`:

```tsx
import { useState } from 'react';
import { useUserAuth } from '../../../user-portal/user-auth-context';

function canExport(
  permissions: Record<string, true>,
  level_number: number | null | undefined,
): boolean {
  if (level_number == null || level_number === 1) return true;
  return permissions['_platform.workspace.view'] === true;
}

function isoFilenameStamp(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 19).replace(/:/g, '')}Z`;
}

export default function WorkspaceExportCard() {
  const { permissions, user, client } = useUserAuth();
  const [busy, setBusy] = useState<'json' | 'zip' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!canExport(permissions, (user as { level_number?: number | null }).level_number)) {
    return null;
  }

  async function download(format: 'json' | 'zip') {
    setBusy(format);
    setErr(null);
    try {
      const res = await fetch(`/api/workspace-export?format=${format}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        if (res.status === 413) setErr('Workspace is too large to export in one file. Contact support.');
        else setErr(`Export failed (${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace-${client.slug}-${isoFilenameStamp(new Date())}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr('Network error. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="ams-export-card">
      <h3>Workspace backup</h3>
      <p>
        Download a snapshot of this workspace's data. Includes users, structure,
        files metadata, and products metadata. Passwords are never included.
      </p>
      <div className="ams-export-card-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => download('json')}
        >
          {busy === 'json' ? 'Preparing…' : 'Download JSON'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => download('zip')}
        >
          {busy === 'zip' ? 'Preparing…' : 'Download ZIP'}
        </button>
      </div>
      {err && <p className="ams-export-card-error">{err}</p>}
    </section>
  );
}
```

- [ ] **Step 5: Add CSS**

Append to `src/lib/components.css`:

```css
/* ── Workspace export card ──────────────────────────────────────────── */
.ams-export-card {
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
  padding: 16px 20px;
  margin-top: 24px;
  background: var(--color-surface, #fff);
}
.ams-export-card h3 { margin: 0 0 8px 0; font-size: 16px; }
.ams-export-card p { margin: 0 0 12px 0; color: var(--color-text-muted, #666); }
.ams-export-card-actions { display: flex; gap: 8px; }
.ams-export-card-error { color: var(--color-danger, #c33); margin-top: 8px; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/WorkspaceExportCard.test.tsx`
Expected: all 4 tests pass.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-workspace-export-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add src/modules/ams/components/settings/WorkspaceExportCard.tsx src/modules/user-portal/user-auth-context.tsx src/lib/components.css tests/unit/WorkspaceExportCard.test.tsx
git commit -m "feat(ams): WorkspaceExportCard component

Two download buttons gated by _platform.workspace.view with L1 bypass.
JSON and ZIP via plain fetch + anchor-download. 413 surfaces as a
human-readable error message. CSS scoped under .ams-export-card.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Mount the card on UserManageTeam + smoke

**Files:**
- Modify: `src/modules/user-portal/pages/UserManageTeam.tsx`

- [ ] **Step 1: Mount the card**

In `src/modules/user-portal/pages/UserManageTeam.tsx`, add at the top of the imports (with the other shared-component imports):

```tsx
import WorkspaceExportCard from '../../ams/components/settings/WorkspaceExportCard';
```

Then locate the JSX `return (...)`. Find the closing tag of the page's outermost container (the last `</div>` or `</section>` before `</>`/`</Fragment>`). Immediately **before** that closing tag, mount:

```tsx
        <WorkspaceExportCard />
```

If the page returns a React Fragment `<>...</>`, mount the card at the bottom of the Fragment.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Full test suite**

Run: `npm run test`
Expected: all unit + integration tests green, including the existing suite.

- [ ] **Step 4: Local smoke (manual)**

Start dev:

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
npm run dev
```

Then in a browser:
- Sign in as L1 Owner of any existing test client → navigate to `/c/<slug>/team` → card visible at the bottom of the page.
- Click **Download JSON** → file saves as `workspace-<slug>-<stamp>.json`. Open in an editor — confirm `"schema_version": 1`, no string `password_hash` anywhere.
- Click **Download ZIP** → file saves as `workspace-<slug>-<stamp>.zip`. Open — `_manifest.json`, `README.txt`, and per-table CSVs present. Open `user_node_credentials.csv` in a spreadsheet and confirm no password columns.
- In a separate tab, sign in as a non-L1 user without the permission → navigate to `/c/<slug>/team` → card is NOT visible.
- Manual `curl -i 'http://localhost:8888/api/workspace-export?format=json' -H 'cookie: <that user cookie>'` → 403.
- Optional: sign in as a platform admin → `/c/<slug>/team` is admin-side; trigger directly via `curl -i 'http://localhost:8888/api/workspace-export?format=json&client=<clientId>' -H 'cookie: <admin cookie>'` → 200.

If any smoke step fails, fix the underlying issue and re-run from the failing step. Do not paper over a 5xx with a try/catch.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-workspace-export-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add src/modules/user-portal/pages/UserManageTeam.tsx
git commit -m "feat(ams): mount WorkspaceExportCard on UserManageTeam

L1 Owners (and L2+ with _platform.workspace.view) see a Workspace
backup card at the bottom of /c/:slug/team. Card self-gates on
permission, so no router change is needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

Run the full suite once more:

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
npm run typecheck
npm run test
git log --oneline origin/main..HEAD
```

Expected: typecheck + tests clean, 10 commits on the branch (one per task), no uncommitted changes.

## Handoff to parallel chat

After all tasks complete and smoke passes, the implementer should emit a "Work done." line followed by a paste-ready prompt summarising:

- Branch: `feat/ams-workspace-export-iso`
- HEAD SHA: (current)
- Files changed (one-line summary per task)
- No migrations (no `npm run migrate` needed on prod)
- No new env vars (unless Task 7 Step 3 was taken — then list `WORKSPACE_EXPORT_MAX_BYTES`)
- No native binary changes
- Suggested merge strategy: fast-forward into main; standard CI build
- Post-deploy smoke: hit `/api/workspace-export?format=json` as an L1 Owner on prod once

Do NOT push or merge from this chat.
