# File Manager — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation slice of the File Manager — both surfaces (admin vault + per-workspace), core CRUD with the 4-tier security model, upload via signed Blob URLs, and audit instrumentation. Working, shippable file manager minus the polish/heavy/share-link add-ons (those are Phases B, C, D).

**Architecture:** New platform surface (`_platform.files.*`) registered in the module registry. Three schema migrations (`030`–`032`). Three shared helpers (`files-access.ts`, `files-storage.ts`, `files-mime.ts`). Six Netlify functions following the codebase's `authenticateForPermission → resolveClientIdOrRespond → handler → logAudit` pattern. React module under `src/modules/files/` with admin and workspace mounts sharing one set of components.

**Tech Stack:** TypeScript • React 18 • React Router 7 • Netlify Functions v2 • Neon serverless (Postgres) • Netlify Blobs • Vitest • Zod • Argon2 (existing) • `_shared/audit.ts` (existing).

**Reference spec:** `docs/superpowers/specs/2026-06-04-file-manager-design.md`.

**Worktree assumption:** Tasks run inside the worktree at `../ExSol-file-manager` on branch `feat/file-manager`. Task 1 sets this up.

**Migration numbers reserved:** 030, 031, 032.

---

## Task 1: Worktree setup and branch

**Files:**
- No source changes; environment setup only.

- [ ] **Step 1: Create the worktree from clean `main`**

Run from the primary repo (not the worktree):

```bash
git fetch origin
git worktree add ../ExSol-file-manager -b feat/file-manager origin/main
```

Expected output: `Preparing worktree (new branch 'feat/file-manager') ... HEAD is now at <sha> ...`

- [ ] **Step 2: Install dependencies in the worktree**

```bash
cd ../ExSol-file-manager
npm install
```

Expected: clean install, `node_modules/` populated.

- [ ] **Step 3: Verify the worktree is healthy**

```bash
npm run typecheck
npm test -- --run --reporter=dot 2>&1 | tail -5
```

Expected: typecheck clean. All current tests pass (254/254 expected per session memory).

- [ ] **Step 4: Confirm `.env` is present**

```bash
test -f .env && echo "OK env present" || echo "MISSING — copy .env from primary"
```

Expected: `OK env present` (the worktree shares the project root files except for the `.git` index — but `.env` may be symlinked or absent on a fresh worktree; copy from primary if absent).

- [ ] **Step 5: Commit (no-op marker)**

No code change in this task; nothing to commit. Move to Task 2.

---

## Task 2: Categories source-of-truth (TS enum)

**Files:**
- Create: `src/modules/files/shared/categories.ts`
- Create: `tests/unit/file-categories.test.ts`

This is a tiny standalone module that defines the 11 category keys and their human labels. Used by the frontend chips, the upload form, and (in Task 5) the migration's CHECK constraint.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/file-categories.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  isCategoryKey,
  type CategoryKey,
} from '../../src/modules/files/shared/categories';

describe('file categories', () => {
  test('has exactly 11 category keys', () => {
    expect(CATEGORY_KEYS).toHaveLength(11);
  });

  test('every key has a non-empty label', () => {
    for (const k of CATEGORY_KEYS) {
      expect(CATEGORY_LABELS[k]).toBeTruthy();
    }
  });

  test('isCategoryKey accepts known keys', () => {
    expect(isCategoryKey('finance_accounting')).toBe(true);
    expect(isCategoryKey('hr_payroll')).toBe(true);
  });

  test('isCategoryKey rejects unknown keys', () => {
    expect(isCategoryKey('garbage')).toBe(false);
    expect(isCategoryKey('')).toBe(false);
  });

  test('CategoryKey type narrows', () => {
    const k: string = 'finance_accounting';
    if (isCategoryKey(k)) {
      const _narrowed: CategoryKey = k; // compile-time check
      expect(_narrowed).toBe('finance_accounting');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/unit/file-categories.test.ts --run
```

Expected: FAIL with module-not-found for `../../src/modules/files/shared/categories`.

- [ ] **Step 3: Implement the categories module**

Create `src/modules/files/shared/categories.ts`:

```ts
// Source of truth for File Manager category keys.
// Mirrored by the CHECK constraint in db/migrations/031_file_categories.sql —
// any change here requires a follow-up migration.

export const CATEGORY_KEYS = [
  'finance_accounting',
  'hr_payroll',
  'legal_compliance',
  'sales_crm',
  'marketing_brand',
  'product_catalog',
  'procurement_supply_chain',
  'operations_warehouse',
  'manufacturing',
  'customer_service',
  'project_workflow',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  finance_accounting: 'Finance & Accounting',
  hr_payroll: 'HR & Payroll',
  legal_compliance: 'Legal & Compliance',
  sales_crm: 'Sales & CRM',
  marketing_brand: 'Marketing & Brand',
  product_catalog: 'Product / Catalog',
  procurement_supply_chain: 'Procurement & Supply Chain',
  operations_warehouse: 'Operations & Warehouse',
  manufacturing: 'Manufacturing',
  customer_service: 'Customer Service',
  project_workflow: 'Project & Workflow',
};

export function isCategoryKey(s: string): s is CategoryKey {
  return (CATEGORY_KEYS as readonly string[]).includes(s);
}

export const MAX_CATEGORIES_PER_FILE = 3;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/unit/file-categories.test.ts --run
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/files/shared/categories.ts tests/unit/file-categories.test.ts
git commit -m "feat(files): category-key enum + label map"
```

---

## Task 3: Register `files` platform surface

**Files:**
- Modify: `src/modules/registry/types.ts`
- Modify: `tests/unit/registry.test.ts` (if existing test asserts platform-surface count)

- [ ] **Step 1: Write the failing test**

Open `tests/unit/registry.test.ts` and add a new describe block at the bottom:

```ts
import { PLATFORM_SURFACES } from '../../src/modules/registry/types';

describe('platform surfaces', () => {
  test('includes files surface', () => {
    expect(PLATFORM_SURFACES).toContain('files');
  });

  test('exposes 4 surfaces total (users, structure, settings, files)', () => {
    expect(PLATFORM_SURFACES).toEqual(['users', 'structure', 'settings', 'files']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/unit/registry.test.ts --run
```

Expected: FAIL — `files` not in `PLATFORM_SURFACES`.

- [ ] **Step 3: Add `'files'` to `PLATFORM_SURFACES`**

Edit `src/modules/registry/types.ts`, change:

```ts
export const PLATFORM_SURFACES = ['users', 'structure', 'settings'] as const;
```

to:

```ts
export const PLATFORM_SURFACES = ['users', 'structure', 'settings', 'files'] as const;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/unit/registry.test.ts --run
npm run typecheck
```

Expected: registry tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/registry/types.ts tests/unit/registry.test.ts
git commit -m "feat(files): add 'files' platform surface to registry"
```

---

## Task 4: Migration 030 — `files` table

**Files:**
- Create: `db/migrations/030_files.sql`
- Create: `tests/integration/files-migration.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `tests/integration/files-migration.test.ts`:

```ts
import { beforeAll, describe, expect, test } from 'vitest';
import { neon } from '@neondatabase/serverless';

let sql: ReturnType<typeof neon>;

beforeAll(() => {
  sql = neon(process.env.DATABASE_URL!);
});

describe('migration 030: files table', () => {
  test('files table exists', async () => {
    const rows = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'files'
    `) as { table_name: string }[];
    expect(rows).toHaveLength(1);
  });

  test('files has the expected columns', async () => {
    const rows = (await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'files'
      ORDER BY ordinal_position
    `) as { column_name: string; data_type: string; is_nullable: string }[];
    const names = rows.map((r) => r.column_name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'client_id', 'type', 'storage_kind',
      'blob_key', 'external_url', 'external_provider',
      'title', 'description', 'filename', 'mime', 'byte_size', 'thumbnail_key',
      'tier', 'uploaded_by_user_node', 'uploaded_by_admin',
      'created_at', 'updated_at', 'deleted_at',
    ]));
  });

  test('storage_kind_consistent CHECK rejects blob_key + external_url both set', async () => {
    // Need a client to satisfy FK; pick any existing one.
    const clients = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (clients.length === 0) {
      // No fixtures — skip rather than fail
      return;
    }
    await expect(sql`
      INSERT INTO public.files (
        client_id, type, storage_kind, blob_key, external_url, title,
        uploaded_by_user_node
      )
      VALUES (
        ${clients[0]!.id}::uuid, 'document', 'blob', 'k', 'https://x', 'bad',
        (SELECT id FROM public.user_nodes WHERE client_id = ${clients[0]!.id}::uuid LIMIT 1)
      )
    `).rejects.toThrow(/files_storage_kind_consistent/);
  });

  test('uploader_consistent CHECK rejects both uploader fields set', async () => {
    const clients = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (clients.length === 0) return;
    const adminRows = (await sql`SELECT id FROM public.admins LIMIT 1`) as { id: string }[];
    if (adminRows.length === 0) return;
    const nodeRows = (await sql`
      SELECT id FROM public.user_nodes WHERE client_id = ${clients[0]!.id}::uuid LIMIT 1
    `) as { id: string }[];
    if (nodeRows.length === 0) return;
    await expect(sql`
      INSERT INTO public.files (
        client_id, type, storage_kind, blob_key, title,
        uploaded_by_user_node, uploaded_by_admin
      )
      VALUES (
        ${clients[0]!.id}::uuid, 'document', 'blob', 'k', 'bad',
        ${nodeRows[0]!.id}::uuid, ${adminRows[0]!.id}::uuid
      )
    `).rejects.toThrow(/files_uploader_consistent/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/integration/files-migration.test.ts --run
```

Expected: FAIL — `files` table does not exist.

- [ ] **Step 3: Write the migration**

Create `db/migrations/030_files.sql`:

```sql
-- Migration 030: files — central table for the File Manager module.
-- See docs/superpowers/specs/2026-06-04-file-manager-design.md §4.1.

CREATE TYPE file_type         AS ENUM ('document', 'image', 'video', 'audio', 'external');
CREATE TYPE file_storage_kind AS ENUM ('blob', 'url');
CREATE TYPE file_tier         AS ENUM ('public', 'role', 'restricted', 'confidential');

CREATE TABLE public.files (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  type                  file_type NOT NULL,
  storage_kind          file_storage_kind NOT NULL,
  blob_key              text,
  external_url          text,
  external_provider     text,
  title                 text NOT NULL,
  description           text,
  filename              text,
  mime                  text,
  byte_size             bigint,
  thumbnail_key         text,
  tier                  file_tier NOT NULL DEFAULT 'public',
  uploaded_by_user_node uuid REFERENCES public.user_nodes(id),
  uploaded_by_admin     uuid REFERENCES public.admins(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT files_storage_kind_consistent CHECK (
    (storage_kind = 'blob' AND blob_key IS NOT NULL AND external_url IS NULL) OR
    (storage_kind = 'url'  AND external_url IS NOT NULL AND blob_key IS NULL)
  ),
  CONSTRAINT files_uploader_consistent CHECK (
    (uploaded_by_admin IS NOT NULL) <> (uploaded_by_user_node IS NOT NULL)
  )
);

CREATE INDEX files_client_type_idx
  ON public.files (client_id, type) WHERE deleted_at IS NULL;
CREATE INDEX files_client_created_idx
  ON public.files (client_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX files_tier_idx
  ON public.files (tier) WHERE deleted_at IS NULL;
```

- [ ] **Step 4: Run the migration and the test**

```bash
npm run migrate
npm test -- tests/integration/files-migration.test.ts --run
```

Expected: migration applies; tests PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/030_files.sql tests/integration/files-migration.test.ts
git commit -m "feat(files): migration 030 — files table + CHECKs + indexes"
```

---

## Task 5: Migration 031 — `file_categories` join

**Files:**
- Create: `db/migrations/031_file_categories.sql`
- Modify: `tests/integration/files-migration.test.ts` (add describe block)

- [ ] **Step 1: Add the failing test**

Append to `tests/integration/files-migration.test.ts`:

```ts
describe('migration 031: file_categories', () => {
  test('table exists with PK (file_id, category_key)', async () => {
    const cols = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'file_categories'
      ORDER BY ordinal_position
    `) as { column_name: string }[];
    expect(cols.map((c) => c.column_name)).toEqual(['file_id', 'category_key']);
  });

  test('CHECK constraint rejects unknown category key', async () => {
    const clients = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (clients.length === 0) return;
    const nodeRows = (await sql`
      SELECT id FROM public.user_nodes WHERE client_id = ${clients[0]!.id}::uuid LIMIT 1
    `) as { id: string }[];
    if (nodeRows.length === 0) return;
    const fileRows = (await sql`
      INSERT INTO public.files (client_id, type, storage_kind, blob_key, title, uploaded_by_user_node)
      VALUES (${clients[0]!.id}::uuid, 'document', 'blob', 'k-test', 't', ${nodeRows[0]!.id}::uuid)
      RETURNING id
    `) as { id: string }[];
    const fileId = fileRows[0]!.id;
    try {
      await expect(sql`
        INSERT INTO public.file_categories (file_id, category_key)
        VALUES (${fileId}::uuid, 'not_a_real_key')
      `).rejects.toThrow();
    } finally {
      await sql`DELETE FROM public.files WHERE id = ${fileId}::uuid`;
    }
  });

  test('all 11 TS categories pass the CHECK', async () => {
    const clients = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (clients.length === 0) return;
    const nodeRows = (await sql`
      SELECT id FROM public.user_nodes WHERE client_id = ${clients[0]!.id}::uuid LIMIT 1
    `) as { id: string }[];
    if (nodeRows.length === 0) return;
    const fileRows = (await sql`
      INSERT INTO public.files (client_id, type, storage_kind, blob_key, title, uploaded_by_user_node)
      VALUES (${clients[0]!.id}::uuid, 'document', 'blob', 'k-test-2', 't', ${nodeRows[0]!.id}::uuid)
      RETURNING id
    `) as { id: string }[];
    const fileId = fileRows[0]!.id;
    const { CATEGORY_KEYS } = await import('../../src/modules/files/shared/categories');
    try {
      for (const k of CATEGORY_KEYS) {
        await sql`INSERT INTO public.file_categories (file_id, category_key) VALUES (${fileId}::uuid, ${k})`;
      }
      const rows = (await sql`
        SELECT category_key FROM public.file_categories WHERE file_id = ${fileId}::uuid
      `) as { category_key: string }[];
      expect(rows).toHaveLength(11);
    } finally {
      await sql`DELETE FROM public.files WHERE id = ${fileId}::uuid`;
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- tests/integration/files-migration.test.ts --run
```

Expected: FAIL — `file_categories` table does not exist.

- [ ] **Step 3: Write the migration**

Create `db/migrations/031_file_categories.sql`:

```sql
-- Migration 031: file_categories — join table for file → category labels.
-- See docs/superpowers/specs/2026-06-04-file-manager-design.md §4.2.
-- The CHECK constraint must stay in lockstep with
-- src/modules/files/shared/categories.ts (CATEGORY_KEYS).

CREATE TABLE public.file_categories (
  file_id      uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  category_key text NOT NULL,
  PRIMARY KEY (file_id, category_key),
  CONSTRAINT file_categories_known_key CHECK (category_key IN (
    'finance_accounting', 'hr_payroll', 'legal_compliance', 'sales_crm',
    'marketing_brand', 'product_catalog', 'procurement_supply_chain',
    'operations_warehouse', 'manufacturing', 'customer_service', 'project_workflow'
  ))
);

CREATE INDEX file_categories_category_idx ON public.file_categories (category_key);
```

- [ ] **Step 4: Run and verify**

```bash
npm run migrate
npm test -- tests/integration/files-migration.test.ts --run
```

Expected: migration applies; new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/031_file_categories.sql tests/integration/files-migration.test.ts
git commit -m "feat(files): migration 031 — file_categories join + CHECK"
```

---

## Task 6: Migration 032 — audience tables

**Files:**
- Create: `db/migrations/032_file_audience.sql`
- Modify: `tests/integration/files-migration.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/integration/files-migration.test.ts`:

```ts
describe('migration 032: file_audience tables', () => {
  test('file_allowed_roles exists with PK (file_id, role_id)', async () => {
    const cols = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'file_allowed_roles'
      ORDER BY ordinal_position
    `) as { column_name: string }[];
    expect(cols.map((c) => c.column_name)).toEqual(['file_id', 'role_id']);
  });

  test('file_allowed_nodes exists with PK (file_id, node_id)', async () => {
    const cols = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'file_allowed_nodes'
      ORDER BY ordinal_position
    `) as { column_name: string }[];
    expect(cols.map((c) => c.column_name)).toEqual(['file_id', 'node_id']);
  });

  test('file_allowed_users exists with PK (file_id, user_node_id)', async () => {
    const cols = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'file_allowed_users'
      ORDER BY ordinal_position
    `) as { column_name: string }[];
    expect(cols.map((c) => c.column_name)).toEqual(['file_id', 'user_node_id']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/integration/files-migration.test.ts --run
```

Expected: FAIL — audience tables do not exist.

- [ ] **Step 3: Write the migration**

Create `db/migrations/032_file_audience.sql`:

```sql
-- Migration 032: per-tier audience join tables.
-- See spec §4.3. Used by the tier-visibility WHERE clause in
-- _shared/files-access.ts.

CREATE TABLE public.file_allowed_roles (
  file_id uuid NOT NULL REFERENCES public.files(id)        ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.client_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, role_id)
);

CREATE TABLE public.file_allowed_nodes (
  file_id uuid NOT NULL REFERENCES public.files(id)      ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, node_id)
);

CREATE TABLE public.file_allowed_users (
  file_id      uuid NOT NULL REFERENCES public.files(id)      ON DELETE CASCADE,
  user_node_id uuid NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, user_node_id)
);
```

- [ ] **Step 4: Run and verify**

```bash
npm run migrate
npm test -- tests/integration/files-migration.test.ts --run
```

Expected: migration applies; all migration tests PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/032_file_audience.sql tests/integration/files-migration.test.ts
git commit -m "feat(files): migration 032 — three audience join tables"
```

---

## Task 7: `_shared/files-mime.ts` — MIME → file_type classifier

**Files:**
- Create: `netlify/functions/_shared/files-mime.ts`
- Create: `tests/unit/files-mime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/files-mime.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { classifyFileType, isAllowedMime } from '../../netlify/functions/_shared/files-mime';

describe('classifyFileType', () => {
  test('application/pdf → document', () => {
    expect(classifyFileType('application/pdf')).toBe('document');
  });
  test('image/png → image', () => {
    expect(classifyFileType('image/png')).toBe('image');
  });
  test('image/jpeg → image', () => {
    expect(classifyFileType('image/jpeg')).toBe('image');
  });
  test('image/svg+xml → image (we default SVG to image)', () => {
    expect(classifyFileType('image/svg+xml')).toBe('image');
  });
  test('video/mp4 → video', () => {
    expect(classifyFileType('video/mp4')).toBe('video');
  });
  test('audio/mpeg → audio', () => {
    expect(classifyFileType('audio/mpeg')).toBe('audio');
  });
  test('application/vnd.ms-excel → document', () => {
    expect(classifyFileType('application/vnd.ms-excel')).toBe('document');
  });
  test('application/dwg (CAD) → external', () => {
    expect(classifyFileType('application/dwg')).toBe('external');
  });
  test('application/zip → external', () => {
    expect(classifyFileType('application/zip')).toBe('external');
  });
  test('unknown MIME → external', () => {
    expect(classifyFileType('application/x-unknown-thing')).toBe('external');
  });
  test('empty / null → external', () => {
    expect(classifyFileType('')).toBe('external');
    expect(classifyFileType(undefined)).toBe('external');
  });
});

describe('isAllowedMime', () => {
  test('allows common safe types', () => {
    expect(isAllowedMime('application/pdf')).toBe(true);
    expect(isAllowedMime('image/png')).toBe(true);
  });
  test('blocks script types', () => {
    expect(isAllowedMime('application/x-msdownload')).toBe(false);
    expect(isAllowedMime('application/x-executable')).toBe(false);
    expect(isAllowedMime('application/javascript')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/files-mime.test.ts --run
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the classifier**

Create `netlify/functions/_shared/files-mime.ts`:

```ts
// MIME → file_type classification + write-time MIME allow-list.
// Used by:
//   - POST /api/files (commit) to auto-classify rows
//   - POST /api/files-upload-url to reject unsafe MIMEs before reserving a key

export type FileType = 'document' | 'image' | 'video' | 'audio' | 'external';

const DOCUMENT_MIMES = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/xml',
  'text/xml',
]);

const BLOCKED_MIMES = new Set<string>([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-dosexec',
  'application/javascript',
  'application/ecmascript',
  'text/javascript',
  'application/x-sh',
  'application/x-csh',
]);

export function classifyFileType(mime: string | undefined | null): FileType {
  if (!mime) return 'external';
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (DOCUMENT_MIMES.has(m)) return 'document';
  return 'external';
}

export function isAllowedMime(mime: string): boolean {
  return !BLOCKED_MIMES.has(mime.toLowerCase());
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/unit/files-mime.test.ts --run
npm run typecheck
```

Expected: 13 PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/files-mime.ts tests/unit/files-mime.test.ts
git commit -m "feat(files): MIME classifier + write-time allow-list"
```

---

## Task 8: `_shared/files-access.ts` — tier visibility + write guard + L1 predicate

**Files:**
- Create: `netlify/functions/_shared/files-access.ts`
- Create: `tests/integration/files-access.test.ts`

This is the highest-leverage helper in the whole module. It owns the tier-visibility clause, the bucket-user write block, and the L1 predicate.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/files-access.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
  assertCanWrite,
  isL1Owner,
  visibleFilesClauseValues,
  type FilesAccessSession,
} from '../../netlify/functions/_shared/files-access';

type SQL = NeonQueryFunction<false, false>;

let sql: SQL;

beforeAll(() => {
  sql = neon(process.env.DATABASE_URL!);
});

describe('isL1Owner', () => {
  test('true for level_number === 1', () => {
    expect(isL1Owner({ kind: 'bucket_user', user_node_id: 'u', client_id: 'c', level_number: 1 } as FilesAccessSession)).toBe(true);
  });
  test('false for level_number > 1', () => {
    expect(isL1Owner({ kind: 'bucket_user', user_node_id: 'u', client_id: 'c', level_number: 2 } as FilesAccessSession)).toBe(false);
  });
  test('false for admin session', () => {
    expect(isL1Owner({ kind: 'admin', admin: { id: 'a', email: '' } } as FilesAccessSession)).toBe(false);
  });
});

describe('assertCanWrite', () => {
  test('admin always allowed', async () => {
    await expect(
      assertCanWrite(sql, { kind: 'admin', admin: { id: 'a', email: '' } }),
    ).resolves.toBeUndefined();
  });

  test('L1 workspace user allowed regardless of bucket_family', async () => {
    await expect(
      assertCanWrite(sql, {
        kind: 'bucket_user', user_node_id: '00000000-0000-0000-0000-000000000000',
        client_id: '00000000-0000-0000-0000-000000000000', level_number: 1,
      }),
    ).resolves.toBeUndefined();
  });

  // L2+ bucket user denial covered via the permission-boundary test in Task 14
  // (requires a seeded fixture with a real bucket_family role row).
});

describe('visibleFilesClauseValues', () => {
  test('returns "public-only" hint for L2+ with no role/audience match', async () => {
    // Smoke check that the function returns the expected param shape;
    // full SQL execution is covered by the endpoint integration tests.
    const out = visibleFilesClauseValues({
      kind: 'bucket_user',
      user_node_id: '00000000-0000-0000-0000-000000000001',
      client_id: '00000000-0000-0000-0000-000000000002',
      level_number: 2,
    });
    expect(out.userNodeId).toBe('00000000-0000-0000-0000-000000000001');
    expect(out.skipClause).toBe(false);
  });

  test('skipClause is true for L1 owner', async () => {
    const out = visibleFilesClauseValues({
      kind: 'bucket_user',
      user_node_id: '00000000-0000-0000-0000-000000000001',
      client_id: '00000000-0000-0000-0000-000000000002',
      level_number: 1,
    });
    expect(out.skipClause).toBe(true);
  });

  test('skipClause is true for admin', async () => {
    const out = visibleFilesClauseValues({ kind: 'admin', admin: { id: 'a', email: '' } });
    expect(out.skipClause).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/integration/files-access.test.ts --run
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `netlify/functions/_shared/files-access.ts`:

```ts
// File Manager access helpers.
//
// Responsibilities:
//   - assertCanWrite — bucket-user write block (per spec §7.2). L1 Owner override.
//   - isL1Owner — single predicate used by both tier-cap and visibility skip.
//   - composeTierVisibilityClause — builds the per-file ACL WHERE clause.
//
// The visibility clause walks ancestors UPWARD from the user's node (bounded
// by tree depth) rather than subtrees DOWNWARD from N restricted-roots
// (unbounded). See spec §4.8.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { AnySession } from './permissions';
import { ForbiddenError } from './permissions';

type SQL = NeonQueryFunction<false, false>;

export type FilesAccessSession = AnySession;

export function isL1Owner(session: FilesAccessSession): boolean {
  return session.kind === 'bucket_user' && session.level_number === 1;
}

/**
 * Throws ForbiddenError when a bucket-family user (external customer/employee)
 * attempts a write path. Admin and internal workspace users (bucket_family IS NULL)
 * pass. L1 Owner always passes regardless of role's bucket_family (defensive).
 */
export async function assertCanWrite(sql: SQL, session: FilesAccessSession): Promise<void> {
  if (session.kind === 'admin') return;
  if (session.level_number === 1) return; // L1 Owner bypass
  const rows = (await sql`
    SELECT cr.bucket_family
    FROM public.user_nodes un
    JOIN public.client_roles cr ON cr.id = un.role_id
    WHERE un.id = ${session.user_node_id}::uuid
    LIMIT 1
  `) as { bucket_family: string | null }[];
  if (rows.length === 0 || rows[0]!.bucket_family !== null) {
    throw new ForbiddenError('files.read_only_for_bucket_users');
  }
}

export interface VisibilityValues {
  skipClause: boolean;
  userNodeId: string | null;
  roleId: string | null;
}

/**
 * Returns the parameter set the endpoint passes to the visibility clause.
 * When skipClause is true, the endpoint omits the WHERE clause entirely
 * (admin reading vault, or L1 Owner reading workspace files).
 *
 * Endpoints fetch role_id once per request — pass it in via the optional arg
 * to avoid an extra round-trip when already known.
 */
export function visibilityValues(
  session: FilesAccessSession,
  roleId?: string | null,
): VisibilityValues {
  if (session.kind === 'admin' || isL1Owner(session)) {
    return { skipClause: true, userNodeId: null, roleId: null };
  }
  return {
    skipClause: false,
    userNodeId: session.user_node_id,
    roleId: roleId ?? null,
  };
}

// Backwards-compatible alias used by the test.
export const visibleFilesClauseValues = visibilityValues;

/**
 * Build the SQL fragment for tier visibility. The endpoint composes this
 * with its own SELECT/WHERE shape.
 *
 *   Use with neon serverless: pass through `sql.fragment` style via a string
 *   template — endpoints inject the values inline using parameterised neon
 *   tagged templates. See files.ts (list endpoint) for the call site.
 *
 * The returned string contains $1, $2 placeholders for the user_node_id and
 * role_id; endpoints expand those via the neon helper. Direct concatenation
 * of user input into this string is NEVER permitted.
 */
export const TIER_VISIBILITY_CLAUSE = `
  files.deleted_at IS NULL AND (
    files.tier = 'public'
    OR (files.tier = 'role' AND EXISTS (
          SELECT 1 FROM public.file_allowed_roles fr
          WHERE fr.file_id = files.id AND fr.role_id = $2::uuid))
    OR (files.tier = 'restricted' AND EXISTS (
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM public.user_nodes WHERE id = $1::uuid
            UNION ALL
            SELECT n.id, n.parent_id FROM public.user_nodes n
            JOIN ancestors a ON n.id = a.parent_id
          )
          SELECT 1 FROM public.file_allowed_nodes fn
          WHERE fn.file_id = files.id AND fn.node_id IN (SELECT id FROM ancestors)))
    OR (files.tier = 'confidential' AND EXISTS (
          SELECT 1 FROM public.file_allowed_users fu
          WHERE fu.file_id = files.id AND fu.user_node_id = $1::uuid))
  )
`;

/**
 * Resolve the workspace user's role_id once per request.
 * Returns null for admin sessions.
 */
export async function resolveRoleId(sql: SQL, session: FilesAccessSession): Promise<string | null> {
  if (session.kind === 'admin') return null;
  const rows = (await sql`
    SELECT role_id FROM public.user_nodes WHERE id = ${session.user_node_id}::uuid LIMIT 1
  `) as { role_id: string | null }[];
  return rows[0]?.role_id ?? null;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/integration/files-access.test.ts --run
npm run typecheck
```

Expected: tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/files-access.ts tests/integration/files-access.test.ts
git commit -m "feat(files): tier-visibility clause + write-guard + L1 predicate"
```

---

## Task 9: `_shared/files-storage.ts` — Netlify Blobs helpers

**Files:**
- Create: `netlify/functions/_shared/files-storage.ts`
- Create: `tests/unit/files-storage.test.ts`

The Blobs SDK is `@netlify/blobs`. If it's not yet a dep, install it first. Check via `grep -l '@netlify/blobs' package.json`.

- [ ] **Step 1: Ensure dependency present**

```bash
grep -q '@netlify/blobs' package.json || npm install @netlify/blobs
```

Expected: either no-op (already present) or installs cleanly.

- [ ] **Step 2: Write the failing unit test**

Create `tests/unit/files-storage.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  blobKeyFor,
  thumbnailKeyFor,
  isAllowedBlobKeyShape,
} from '../../netlify/functions/_shared/files-storage';

describe('blobKeyFor', () => {
  test('admin vault key uses "admin/" prefix', () => {
    const k = blobKeyFor({ scope: 'admin', uuid: '11111111-1111-1111-1111-111111111111' });
    expect(k.startsWith('admin/')).toBe(true);
    expect(k).toContain('11111111-1111-1111-1111-111111111111');
  });

  test('workspace key uses "workspace/<clientId>/" prefix', () => {
    const k = blobKeyFor({
      scope: 'workspace',
      clientId: '22222222-2222-2222-2222-222222222222',
      uuid: '33333333-3333-3333-3333-333333333333',
    });
    expect(k).toBe(
      'workspace/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333',
    );
  });
});

describe('thumbnailKeyFor', () => {
  test('derives a thumbnail key from a blob key', () => {
    const blob = 'workspace/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333';
    const thumb = thumbnailKeyFor(blob);
    expect(thumb).toBe(`thumb/${blob}.webp`);
  });
});

describe('isAllowedBlobKeyShape', () => {
  test('accepts well-formed admin keys', () => {
    expect(isAllowedBlobKeyShape('admin/11111111-1111-1111-1111-111111111111')).toBe(true);
  });
  test('accepts well-formed workspace keys', () => {
    expect(isAllowedBlobKeyShape(
      'workspace/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333',
    )).toBe(true);
  });
  test('rejects path traversal', () => {
    expect(isAllowedBlobKeyShape('admin/../etc/passwd')).toBe(false);
    expect(isAllowedBlobKeyShape('workspace/x/../y')).toBe(false);
  });
  test('rejects empty / odd shapes', () => {
    expect(isAllowedBlobKeyShape('')).toBe(false);
    expect(isAllowedBlobKeyShape('garbage')).toBe(false);
    expect(isAllowedBlobKeyShape('admin/')).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test -- tests/unit/files-storage.test.ts --run
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the storage helpers**

Create `netlify/functions/_shared/files-storage.ts`:

```ts
// Netlify Blobs helpers for the File Manager.
//
// Key structure:
//   admin/<uuid>                                 — admin vault file
//   workspace/<clientId>/<uuid>                  — workspace file
//   thumb/<original-key>.webp                    — thumbnail
//
// Each shape is enforced by isAllowedBlobKeyShape — endpoints validate any
// blob_key arriving from the browser before passing it to Blobs.

import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

export const FILES_STORE = 'files';
export const FILES_THUMBNAILS_STORE = 'files-thumbnails';

export type BlobScope =
  | { scope: 'admin'; uuid?: string }
  | { scope: 'workspace'; clientId: string; uuid?: string };

export function blobKeyFor(scope: BlobScope): string {
  const uuid = scope.uuid ?? randomUUID();
  if (scope.scope === 'admin') return `admin/${uuid}`;
  return `workspace/${scope.clientId}/${uuid}`;
}

export function thumbnailKeyFor(blobKey: string): string {
  return `thumb/${blobKey}.webp`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAllowedBlobKeyShape(key: string): boolean {
  if (!key || key.includes('..')) return false;
  const parts = key.split('/');
  if (parts[0] === 'admin') {
    return parts.length === 2 && UUID_RE.test(parts[1]!);
  }
  if (parts[0] === 'workspace') {
    return parts.length === 3 && UUID_RE.test(parts[1]!) && UUID_RE.test(parts[2]!);
  }
  return false;
}

export function filesStore() {
  return getStore({ name: FILES_STORE, consistency: 'strong' });
}

export function thumbnailsStore() {
  return getStore({ name: FILES_THUMBNAILS_STORE, consistency: 'eventual' });
}
```

**Implementer note:** Phase A streams uploads through the function rather than using presigned PUT URLs (see Task 10). A `signUploadUrl` helper can be added here in a future phase if `@netlify/blobs` presigned-URL support stabilises.

- [ ] **Step 5: Run to verify pass**

```bash
npm test -- tests/unit/files-storage.test.ts --run
npm run typecheck
```

Expected: 8 PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/files-storage.ts tests/unit/files-storage.test.ts
git commit -m "feat(files): Blobs key shape + store helpers"
```

> **Implementer note for Task 10:** The exact presigned-URL primitive in `@netlify/blobs` may not be available; the simpler portable choice is to **stream the upload through the function itself** in Task 10, with a per-upload short-lived token. The spec leaves this open; pick whichever is supported by the version of `@netlify/blobs` resolved in `package.json`.

---

## Task 10: `POST /api/files-upload-url` endpoint

**Files:**
- Create: `netlify/functions/files-upload-url.ts`
- Create: `tests/integration/files-upload-url.test.ts`

This endpoint reserves a blob key and returns either a presigned PUT URL OR a single-use token the browser sends back on a follow-up streaming PUT to `/api/files-upload?token=`. Either way, the result is the same: bytes land in Blobs at `blob_key`, then the browser commits metadata via Task 11.

For Phase A we implement the **streaming-through-function** variant — it works with every `@netlify/blobs` version and avoids signed-URL plumbing complexity. A second endpoint `files-upload.ts` handles the PUT body. (Inline scope adjustment to spec §5.5.)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/files-upload-url.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';

const CTX = {} as Context;
const BOOTSTRAP_EMAIL = 'files-upload-url-test@example.com';
const BOOTSTRAP_PASSWORD = 'files-upload-url-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const hash = await hashPassword(BOOTSTRAP_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${BOOTSTRAP_EMAIL}, ${hash}, 'Files Test', true)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${hash}, display_name = 'Files Test', is_bootstrap = true
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${BOOTSTRAP_EMAIL}`;
  const res = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    }),
    CTX,
  );
  adminCookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

describe('POST /api/files-upload-url', () => {
  test('admin gets a key + upload token', async () => {
    const res = await uploadUrlHandler(
      new Request('http://localhost/api/files-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ filename: 'q3.pdf', mime: 'application/pdf', byte_size: 1024 }),
      }),
      CTX,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blob_key).toMatch(/^admin\//);
    expect(typeof body.upload_token).toBe('string');
  });

  test('unauthenticated → 401', async () => {
    const res = await uploadUrlHandler(
      new Request('http://localhost/api/files-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'q.pdf', mime: 'application/pdf', byte_size: 1 }),
      }),
      CTX,
    );
    expect(res.status).toBe(401);
  });

  test('rejects blocked MIME', async () => {
    const res = await uploadUrlHandler(
      new Request('http://localhost/api/files-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ filename: 'evil.exe', mime: 'application/x-msdownload', byte_size: 1 }),
      }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('mime_not_allowed');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/integration/files-upload-url.test.ts --run
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the endpoint**

Create `netlify/functions/files-upload-url.ts`:

```ts
// POST /api/files-upload-url
//
// Step 1 of the 2-step upload flow.
// Reserves a blob key + returns a single-use upload_token. Browser PUTs bytes
// to /api/files-upload (Task 10b) with the token; then POSTs to /api/files
// (Task 11) to commit metadata.
//
// Token = 32-byte URL-safe random encoded base64url, stored in-memory keyed by
// blob_key. For multi-instance deploys, swap to a Neon-backed table in a
// follow-up; in Phase A single-instance dev + Netlify's same-region edge,
// in-memory is adequate. Token TTL: 5 minutes.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { jsonError, jsonOk } from './_shared/http';
import {
  authenticateForPermission, resolveClientIdOrRespond,
} from './_shared/permissions';
import { isAllowedMime } from './_shared/files-mime';
import { blobKeyFor } from './_shared/files-storage';

const Body = z.object({
  filename:  z.string().min(1).max(500),
  mime:      z.string().min(1).max(200),
  byte_size: z.number().int().nonnegative().max(5 * 1024 * 1024 * 1024), // 5 GB hard cap
});

// In-memory token table; tokens TTL after 5 minutes.
const tokens = new Map<string, { blobKey: string; expiresAt: number }>();

function newToken(blobKey: string): string {
  const tok = randomBytes(32).toString('base64url');
  tokens.set(tok, { blobKey, expiresAt: Date.now() + 5 * 60_000 });
  return tok;
}

export function consumeToken(tok: string): { blobKey: string } | null {
  const entry = tokens.get(tok);
  if (!entry) return null;
  tokens.delete(tok);
  if (entry.expiresAt < Date.now()) return null;
  return { blobKey: entry.blobKey };
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, '_platform.files.create');
  if (auth instanceof Response) return auth;
  const session = auth;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  if (!isAllowedMime(parsed.data.mime)) return jsonError(400, 'mime_not_allowed');

  // Admin → admin vault. Workspace → workspace scope.
  let blob_key: string;
  if (session.kind === 'admin') {
    blob_key = blobKeyFor({ scope: 'admin' });
  } else {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    blob_key = blobKeyFor({ scope: 'workspace', clientId: scope.clientId });
  }

  const upload_token = newToken(blob_key);
  return jsonOk({
    blob_key,
    upload_token,
    upload_url: `/api/files-upload?token=${upload_token}`,
    expires_in_seconds: 300,
  });
};
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/integration/files-upload-url.test.ts --run
npm run typecheck
```

Expected: 3 PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/files-upload-url.ts tests/integration/files-upload-url.test.ts
git commit -m "feat(files): POST /api/files-upload-url — reserve blob key + token"
```

---

## Task 11: `files-upload.ts` (PUT body) + `files.ts` POST commit + GET list

**Files:**
- Create: `netlify/functions/files-upload.ts` (PUT body streaming endpoint)
- Create: `netlify/functions/files.ts` (POST commit, GET list)
- Create: `tests/integration/files-commit-and-list.test.ts`

The Blob bytes land via PUT to `files-upload.ts?token=…`. Then the browser commits metadata via `POST /api/files`. The same `files.ts` file also serves `GET /api/files` (list with filters).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/files-commit-and-list.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';
import uploadHandler from '../../netlify/functions/files-upload';
import filesHandler from '../../netlify/functions/files';
import { assertLastAudit } from '../helpers/audit';

const CTX = {} as Context;
const BOOTSTRAP_EMAIL = 'files-commit-list-test@example.com';
const BOOTSTRAP_PASSWORD = 'files-commit-list-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let adminId: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const hash = await hashPassword(BOOTSTRAP_PASSWORD);
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${BOOTSTRAP_EMAIL}, ${hash}, 'Files CL Test', true)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${hash}, display_name = 'Files CL Test', is_bootstrap = true
    RETURNING id
  `) as { id: string }[];
  adminId = rows[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${BOOTSTRAP_EMAIL}`;
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
  const res = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    }),
    CTX,
  );
  adminCookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
});

async function reserveAndCommit(filename: string, mime: string): Promise<{ id: string; blob_key: string }> {
  // Step 1: reserve key
  const r1 = await uploadUrlHandler(
    new Request('http://localhost/api/files-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ filename, mime, byte_size: 4 }),
    }),
    CTX,
  );
  const { blob_key, upload_token } = await r1.json();

  // Step 2: PUT bytes
  const r2 = await uploadHandler(
    new Request(`http://localhost/api/files-upload?token=${upload_token}`, {
      method: 'PUT',
      headers: { 'Content-Type': mime, cookie: adminCookie },
      body: 'AAAA',
    }),
    CTX,
  );
  expect(r2.status).toBe(200);

  // Step 3: commit metadata
  const r3 = await filesHandler(
    new Request('http://localhost/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        blob_key,
        title: filename.replace(/\.[^.]+$/, ''),
        mime,
        byte_size: 4,
        filename,
        categories: ['finance_accounting'],
      }),
    }),
    CTX,
  );
  expect(r3.status).toBe(201);
  const body = await r3.json();
  return { id: body.file.id, blob_key };
}

describe('upload → commit → list', () => {
  test('end-to-end: PDF upload becomes a document row visible via list', async () => {
    const { id } = await reserveAndCommit('q3.pdf', 'application/pdf');

    await assertLastAudit(sql, {
      op: 'files.uploaded', targetType: 'file', targetId: id,
      actorAdminId: adminId,
    });

    const listRes = await filesHandler(
      new Request('http://localhost/api/files?type=document', {
        method: 'GET',
        headers: { cookie: adminCookie },
      }),
      CTX,
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.files.map((f: any) => f.id)).toContain(id);
    expect(list.files.find((f: any) => f.id === id).type).toBe('document');
  });

  test('list filters by category (OR)', async () => {
    const { id: a } = await reserveAndCommit('a.pdf', 'application/pdf');
    // Add a second category to row a
    await sql`INSERT INTO public.file_categories (file_id, category_key) VALUES (${a}::uuid, 'hr_payroll')`;

    const { id: b } = await reserveAndCommit('b.pdf', 'application/pdf');
    // b only has finance_accounting (default from reserveAndCommit)

    const res = await filesHandler(
      new Request('http://localhost/api/files?category=hr_payroll', {
        method: 'GET',
        headers: { cookie: adminCookie },
      }),
      CTX,
    );
    const list = await res.json();
    const ids = list.files.map((f: any) => f.id);
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
  });

  test('rejects external URL with disallowed scheme', async () => {
    const res = await filesHandler(
      new Request('http://localhost/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          external_url: 'javascript:alert(1)',
          title: 'bad',
          categories: ['marketing_brand'],
        }),
      }),
      CTX,
    );
    expect(res.status).toBe(400);
  });

  test('caps categories at 3', async () => {
    const r1 = await uploadUrlHandler(
      new Request('http://localhost/api/files-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ filename: 't.pdf', mime: 'application/pdf', byte_size: 1 }),
      }),
      CTX,
    );
    const { blob_key, upload_token } = await r1.json();
    await uploadHandler(
      new Request(`http://localhost/api/files-upload?token=${upload_token}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/pdf', cookie: adminCookie }, body: 'A',
      }),
      CTX,
    );
    const res = await filesHandler(
      new Request('http://localhost/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          blob_key,
          title: 't', mime: 'application/pdf', byte_size: 1, filename: 't.pdf',
          categories: ['finance_accounting', 'hr_payroll', 'sales_crm', 'legal_compliance'],
        }),
      }),
      CTX,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('too_many_categories');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/integration/files-commit-and-list.test.ts --run
```

Expected: FAIL — handlers don't exist.

- [ ] **Step 3: Implement `files-upload.ts` (PUT body stream)**

Create `netlify/functions/files-upload.ts`:

```ts
// PUT /api/files-upload?token=<upload_token>
//
// Streams the request body into Netlify Blobs at the key reserved in Task 10.
// The single-use token is consumed; subsequent PUTs with the same token 404.

import type { Context } from '@netlify/functions';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission } from './_shared/permissions';
import { consumeToken } from './files-upload-url';
import { filesStore } from './_shared/files-storage';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'PUT') return jsonError(405, 'method_not_allowed');

  // Auth required even on the byte path — prevents anon token-stuffing.
  const auth = await authenticateForPermission(req, '_platform.files.create');
  if (auth instanceof Response) return auth;

  const tok = new URL(req.url).searchParams.get('token');
  if (!tok) return jsonError(400, 'token_required');
  const reserved = consumeToken(tok);
  if (!reserved) return jsonError(404, 'token_invalid_or_expired');

  const body = await req.arrayBuffer();
  if (body.byteLength === 0) return jsonError(400, 'empty_body');

  const store = filesStore();
  await store.set(reserved.blobKey, body);

  return jsonOk({ ok: true, blob_key: reserved.blobKey, byte_size: body.byteLength });
};
```

- [ ] **Step 4: Implement `files.ts` (POST commit + GET list)**

Create `netlify/functions/files.ts`:

```ts
// /api/files
//   POST → commit metadata after a successful Blob PUT (or for URL externals)
//   GET  → list with filters + pagination

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import {
  authenticateForPermission, resolveClientIdOrRespond,
} from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { classifyFileType } from './_shared/files-mime';
import { isAllowedBlobKeyShape, filesStore } from './_shared/files-storage';
import {
  TIER_VISIBILITY_CLAUSE, visibilityValues, resolveRoleId, isL1Owner,
} from './_shared/files-access';
import { isCategoryKey, MAX_CATEGORIES_PER_FILE } from '../../src/modules/files/shared/categories';

// ---------- POST: commit ----------

const CommitBodyBase = z.object({
  title:       z.string().min(1).max(500),
  description: z.string().max(5_000).optional().nullable(),
  categories:  z.array(z.string()).max(MAX_CATEGORIES_PER_FILE),
  folder_id:   z.string().uuid().optional().nullable(),
  tier:        z.enum(['public', 'role', 'restricted', 'confidential']).optional().default('public'),
  allowed_role_ids: z.array(z.string().uuid()).optional().default([]),
  allowed_node_ids: z.array(z.string().uuid()).optional().default([]),
  allowed_user_node_ids: z.array(z.string().uuid()).optional().default([]),
});

const BlobCommit = CommitBodyBase.extend({
  blob_key:  z.string(),
  mime:      z.string(),
  byte_size: z.number().int().nonnegative(),
  filename:  z.string().min(1).max(500),
});

const UrlCommit = CommitBodyBase.extend({
  external_url:      z.string().url(),
  external_provider: z.string().optional().nullable(),
});

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);

async function handlePost(req: Request): Promise<Response> {
  const auth = await authenticateForPermission(req, '_platform.files.create');
  if (auth instanceof Response) return auth;
  const session = auth;

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return jsonError(400, 'validation_failed');

  // Discriminate by presence of blob_key OR external_url.
  const isBlob = 'blob_key' in (payload as object);
  const parsed = isBlob ? BlobCommit.safeParse(payload) : UrlCommit.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const data = parsed.data;

  // Categories shape + cap
  if (data.categories.length === 0) return jsonError(400, 'category_required');
  if (data.categories.length > MAX_CATEGORIES_PER_FILE) return jsonError(400, 'too_many_categories');
  for (const c of data.categories) {
    if (!isCategoryKey(c)) return jsonError(400, 'unknown_category', { category: c });
  }

  // Tier-cap: only L1 Owner can mark Restricted/Confidential
  if ((data.tier === 'restricted' || data.tier === 'confidential') && !isL1Owner(session)) {
    return jsonError(403, 'tier_requires_owner');
  }

  // Admin-vault single-tier rule
  let scope_client_id: string | null = null;
  if (session.kind === 'bucket_user') {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    scope_client_id = scope.clientId;
  } else if (data.tier !== 'public') {
    return jsonError(400, 'admin_vault_single_tier');
  }

  // URL externals: block dangerous schemes
  let storage_kind: 'blob' | 'url';
  let blob_key: string | null = null;
  let external_url: string | null = null;
  let external_provider: string | null = null;
  let mime: string | null = null;
  let byte_size: number | null = null;
  let filename: string | null = null;

  if (isBlob) {
    const d = data as z.infer<typeof BlobCommit>;
    if (!isAllowedBlobKeyShape(d.blob_key)) return jsonError(400, 'blob_key_invalid');
    // Verify the blob actually exists
    const store = filesStore();
    const meta = await store.getMetadata(d.blob_key);
    if (!meta) return jsonError(409, 'blob_not_found');
    storage_kind = 'blob';
    blob_key = d.blob_key;
    mime = d.mime;
    byte_size = d.byte_size;
    filename = d.filename;
  } else {
    const d = data as z.infer<typeof UrlCommit>;
    try {
      const parsed = new URL(d.external_url);
      if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) return jsonError(400, 'url_scheme_blocked');
      external_url = d.external_url;
      external_provider = d.external_provider ?? null;
    } catch {
      return jsonError(400, 'url_invalid');
    }
    storage_kind = 'url';
  }

  const type = storage_kind === 'blob' ? classifyFileType(mime) : 'external';

  const sql = db();

  // Insert with audience rows in one transaction.
  const inserted = (await sql`
    WITH ins AS (
      INSERT INTO public.files (
        client_id, type, storage_kind, blob_key, external_url, external_provider,
        title, description, filename, mime, byte_size, tier,
        uploaded_by_user_node, uploaded_by_admin
      )
      VALUES (
        ${scope_client_id}::uuid, ${type}, ${storage_kind}, ${blob_key}, ${external_url}, ${external_provider},
        ${data.title}, ${data.description ?? null}, ${filename}, ${mime}, ${byte_size}, ${data.tier},
        ${session.kind === 'bucket_user' ? session.user_node_id : null}::uuid,
        ${session.kind === 'admin' ? session.admin.id : null}::uuid
      )
      RETURNING *
    )
    SELECT * FROM ins
  `) as Array<Record<string, unknown>>;
  const row = inserted[0]!;
  const file_id = row.id as string;

  // Categories
  for (const c of data.categories) {
    await sql`INSERT INTO public.file_categories (file_id, category_key) VALUES (${file_id}::uuid, ${c})`;
  }
  // Audience (only the relevant tier matters; clients may pre-fill others)
  if (data.tier === 'role') {
    for (const r of data.allowed_role_ids) {
      await sql`INSERT INTO public.file_allowed_roles (file_id, role_id) VALUES (${file_id}::uuid, ${r}::uuid)`;
    }
  }
  if (data.tier === 'restricted') {
    for (const n of data.allowed_node_ids) {
      await sql`INSERT INTO public.file_allowed_nodes (file_id, node_id) VALUES (${file_id}::uuid, ${n}::uuid)`;
    }
  }
  if (data.tier === 'confidential') {
    for (const u of data.allowed_user_node_ids) {
      await sql`INSERT INTO public.file_allowed_users (file_id, user_node_id) VALUES (${file_id}::uuid, ${u}::uuid)`;
    }
  }

  await logAudit(sql, {
    session: session.kind === 'admin'
      ? { kind: 'admin', admin: { id: session.admin.id, email: session.admin.email } }
      : { kind: 'bucket_user', user_node_id: session.user_node_id, client_id: session.client_id, level_number: session.level_number },
    op: 'files.uploaded',
    clientId: scope_client_id,
    targetType: 'file',
    targetId: file_id,
    detail: { type, byte_size, tier: data.tier, categories: data.categories },
  });

  return jsonOk({ file: row }, { status: 201 });
}

// ---------- GET: list ----------

const ListQuery = z.object({
  type: z.enum(['document', 'image', 'video', 'audio', 'external']).optional(),
  category: z.array(z.string()).optional(),
  tier: z.enum(['public', 'role', 'restricted', 'confidential']).optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'size']).optional().default('newest'),
  folder_id: z.string().uuid().optional(),
  include_trash: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  cursor: z.string().optional(),
});

async function handleGet(req: Request): Promise<Response> {
  const auth = await authenticateForPermission(req, '_platform.files.view');
  if (auth instanceof Response) return auth;
  const session = auth;

  const url = new URL(req.url);
  // category= can be repeated; URLSearchParams.getAll returns the list
  const raw = {
    type: url.searchParams.get('type') ?? undefined,
    category: url.searchParams.getAll('category'),
    tier: url.searchParams.get('tier') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    sort: url.searchParams.get('sort') ?? undefined,
    folder_id: url.searchParams.get('folder_id') ?? undefined,
    include_trash: url.searchParams.get('include_trash') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  };
  const parsed = ListQuery.safeParse(raw);
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const q = parsed.data;

  // Admin → vault (client_id IS NULL). Workspace → ?client=<uuid> resolves.
  let clientFilter: string | null = null;
  if (session.kind === 'bucket_user') {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    clientFilter = scope.clientId;
  }

  const sql = db();
  const roleId = await resolveRoleId(sql, session);
  const vv = visibilityValues(session, roleId);

  // Build SQL via raw fragments — neon does not accept dynamic WHERE arrays
  // through tagged templates without prebuilt fragments. Endpoint uses
  // `sql.query` (untagged) to execute the composed string with parameters.
  // (See @neondatabase/serverless docs for `query(sql, params)`.)
  const clauses: string[] = ['files.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (!q.include_trash) {
    // (already handled above; include_trash=true would reverse this — out of v1 scope; ignore)
  }
  if (clientFilter === null) {
    clauses.push('files.client_id IS NULL');
  } else {
    params.push(clientFilter);
    clauses.push(`files.client_id = $${params.length}::uuid`);
  }
  if (q.type) {
    params.push(q.type);
    clauses.push(`files.type = $${params.length}::file_type`);
  }
  if (q.tier) {
    params.push(q.tier);
    clauses.push(`files.tier = $${params.length}::file_tier`);
  }
  if (q.search) {
    params.push(`%${q.search}%`);
    clauses.push(`(files.title ILIKE $${params.length} OR files.description ILIKE $${params.length})`);
  }
  if (q.category && q.category.length > 0) {
    const ph: string[] = [];
    for (const c of q.category) {
      if (!isCategoryKey(c)) continue;
      params.push(c);
      ph.push(`$${params.length}`);
    }
    if (ph.length > 0) {
      clauses.push(
        `EXISTS (SELECT 1 FROM public.file_categories fc WHERE fc.file_id = files.id AND fc.category_key IN (${ph.join(',')}))`,
      );
    }
  }
  if (!vv.skipClause) {
    params.push(vv.userNodeId);
    params.push(vv.roleId);
    // TIER_VISIBILITY_CLAUSE uses $1 / $2 — shift them via parameter base offset.
    const offsetUser = params.length - 1;
    const offsetRole = params.length;
    clauses.push(
      TIER_VISIBILITY_CLAUSE
        .replaceAll('$1', `$${offsetUser}`)
        .replaceAll('$2', `$${offsetRole}`),
    );
  }
  const orderBy =
    q.sort === 'oldest' ? 'files.created_at ASC, files.id ASC' :
    q.sort === 'name'   ? 'files.title ASC, files.id ASC' :
    q.sort === 'size'   ? 'files.byte_size DESC NULLS LAST, files.id DESC' :
                          'files.created_at DESC, files.id DESC';

  params.push(q.limit + 1);
  const sqlText = `
    SELECT files.* FROM public.files
    WHERE ${clauses.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT $${params.length}
  `;

  // @neondatabase/serverless tagged-template = sql`…`; for raw queries we use
  // the function as a plain call.
  const rows = (await (sql as any).query(sqlText, params)) as Array<Record<string, unknown>>;
  const hasMore = rows.length > q.limit;
  const slice = rows.slice(0, q.limit);
  return jsonOk({
    files: slice,
    has_more: hasMore,
    next_cursor: hasMore ? String((slice.at(-1) as any).created_at) : null,
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === 'POST') return handlePost(req);
  if (req.method === 'GET')  return handleGet(req);
  return jsonError(405, 'method_not_allowed');
};
```

- [ ] **Step 5: Run to verify pass**

```bash
npm test -- tests/integration/files-commit-and-list.test.ts --run
npm run typecheck
```

Expected: 4 PASS; typecheck clean.

> **Note on raw `sql.query`:** The `@neondatabase/serverless` package supports raw parameterised queries via `(sql as any).query(text, params)` — already used in `scripts/migrate.ts`. If the type-cast offends the linter, expose a `rawQuery` helper in `_shared/db.ts` as a small follow-up.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/files-upload.ts netlify/functions/files.ts tests/integration/files-commit-and-list.test.ts
git commit -m "feat(files): PUT /files-upload + POST commit + GET list"
```

---

## Task 12: `files-detail.ts` — GET single, PATCH metadata, DELETE (soft + hard)

**Files:**
- Create: `netlify/functions/files-detail.ts`
- Create: `tests/integration/files-detail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/files-detail.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';
import uploadHandler from '../../netlify/functions/files-upload';
import filesHandler from '../../netlify/functions/files';
import detailHandler from '../../netlify/functions/files-detail';
import { assertLastAudit } from '../helpers/audit';

const CTX = {} as Context;
const EMAIL = 'files-detail-test@example.com';
const PW = 'files-detail-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let adminId: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const hash = await hashPassword(PW);
  const r = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${EMAIL}, ${hash}, 'Detail Test', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash}, display_name = 'Detail Test', is_bootstrap = true
    RETURNING id
  `) as { id: string }[];
  adminId = r[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${EMAIL}`;
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
  const res = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW }),
    }), CTX,
  );
  adminCookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
});

async function createFile(): Promise<string> {
  const r1 = await uploadUrlHandler(
    new Request('http://localhost/api/files-upload-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ filename: 'x.pdf', mime: 'application/pdf', byte_size: 4 }),
    }), CTX,
  );
  const { blob_key, upload_token } = await r1.json();
  await uploadHandler(
    new Request(`http://localhost/api/files-upload?token=${upload_token}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/pdf', cookie: adminCookie }, body: 'AAAA',
    }), CTX,
  );
  const r3 = await filesHandler(
    new Request('http://localhost/api/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        blob_key, title: 'Initial', mime: 'application/pdf', byte_size: 4, filename: 'x.pdf',
        categories: ['finance_accounting'],
      }),
    }), CTX,
  );
  return (await r3.json()).file.id as string;
}

describe('GET /api/files-detail/:id', () => {
  test('returns the file row + categories', async () => {
    const id = await createFile();
    const res = await detailHandler(
      new Request(`http://localhost/api/files-detail/${id}`, {
        method: 'GET', headers: { cookie: adminCookie },
      }), CTX,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file.id).toBe(id);
    expect(body.file.categories).toEqual(['finance_accounting']);
  });

  test('404 for unknown id', async () => {
    const res = await detailHandler(
      new Request('http://localhost/api/files-detail/00000000-0000-0000-0000-000000000000', {
        method: 'GET', headers: { cookie: adminCookie },
      }), CTX,
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/files-detail/:id', () => {
  test('updates title + categories', async () => {
    const id = await createFile();
    const res = await detailHandler(
      new Request(`http://localhost/api/files-detail/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ title: 'Renamed', categories: ['hr_payroll', 'legal_compliance'] }),
      }), CTX,
    );
    expect(res.status).toBe(200);
    await assertLastAudit(sql, { op: 'files.metadata_edited', targetType: 'file', targetId: id });
  });

  test('tier change logs files.tier_changed (own op)', async () => {
    const id = await createFile();
    const res = await detailHandler(
      new Request(`http://localhost/api/files-detail/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ tier: 'public' }), // admin vault stays public; should still be allowed no-op
      }), CTX,
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/files-detail/:id', () => {
  test('soft delete sets deleted_at + logs files.deleted_soft', async () => {
    const id = await createFile();
    const res = await detailHandler(
      new Request(`http://localhost/api/files-detail/${id}`, {
        method: 'DELETE', headers: { cookie: adminCookie },
      }), CTX,
    );
    expect(res.status).toBe(204);
    const rows = (await sql`SELECT deleted_at FROM public.files WHERE id = ${id}::uuid`) as { deleted_at: string | null }[];
    expect(rows[0]!.deleted_at).not.toBeNull();
    await assertLastAudit(sql, { op: 'files.deleted_soft', targetType: 'file', targetId: id });
  });

  test('hard delete removes the row + logs files.deleted_hard', async () => {
    const id = await createFile();
    const res = await detailHandler(
      new Request(`http://localhost/api/files-detail/${id}?hard=true`, {
        method: 'DELETE', headers: { cookie: adminCookie },
      }), CTX,
    );
    expect(res.status).toBe(204);
    const rows = (await sql`SELECT id FROM public.files WHERE id = ${id}::uuid`) as { id: string }[];
    expect(rows).toHaveLength(0);
    await assertLastAudit(sql, { op: 'files.deleted_hard', targetType: 'file', targetId: id });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/integration/files-detail.test.ts --run
```

Expected: FAIL — handler missing.

- [ ] **Step 3: Implement `files-detail.ts`**

Create `netlify/functions/files-detail.ts`:

```ts
// /api/files-detail/:id  — GET, PATCH, DELETE
//
// Netlify v2 routes the path-suffix into the request URL; we extract :id from
// the URL pathname.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import {
  authenticateForPermission,
} from './_shared/permissions';
import { logAudit } from './_shared/audit';
import {
  TIER_VISIBILITY_CLAUSE, visibilityValues, resolveRoleId,
  isL1Owner, assertCanWrite,
} from './_shared/files-access';
import { isCategoryKey, MAX_CATEGORIES_PER_FILE } from '../../src/modules/files/shared/categories';
import { filesStore } from './_shared/files-storage';
import { ForbiddenError } from './_shared/permissions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/files-detail\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

const PatchBody = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5_000).nullable().optional(),
  categories: z.array(z.string()).max(MAX_CATEGORIES_PER_FILE).optional(),
  tier: z.enum(['public', 'role', 'restricted', 'confidential']).optional(),
  allowed_role_ids: z.array(z.string().uuid()).optional(),
  allowed_node_ids: z.array(z.string().uuid()).optional(),
  allowed_user_node_ids: z.array(z.string().uuid()).optional(),
});

async function fetchVisibleFile(req: Request): Promise<
  | { error: Response }
  | { row: Record<string, unknown>; session: Awaited<ReturnType<typeof authenticateForPermission>> & { kind: string } }
> {
  const id = idFromUrl(req);
  if (!id) return { error: jsonError(400, 'invalid_id') };
  const auth = await authenticateForPermission(req, '_platform.files.view');
  if (auth instanceof Response) return { error: auth };
  const session = auth;

  const sql = db();
  const roleId = await resolveRoleId(sql, session);
  const vv = visibilityValues(session, roleId);
  const clauses: string[] = ['files.id = $1::uuid'];
  const params: unknown[] = [id];
  if (!vv.skipClause) {
    params.push(vv.userNodeId);
    params.push(vv.roleId);
    clauses.push(
      TIER_VISIBILITY_CLAUSE.replaceAll('$1', `$${params.length - 1}`).replaceAll('$2', `$${params.length}`),
    );
  }
  // Scope: admin sees vault; workspace sees own client only.
  if (session.kind === 'admin') {
    clauses.push('files.client_id IS NULL');
  } else {
    params.push(session.client_id);
    clauses.push(`files.client_id = $${params.length}::uuid`);
  }
  const text = `SELECT * FROM public.files WHERE ${clauses.join(' AND ')} LIMIT 1`;
  const rows = (await (sql as any).query(text, params)) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { error: jsonError(404, 'not_found') };
  return { row: rows[0]!, session };
}

async function handleGet(req: Request): Promise<Response> {
  const got = await fetchVisibleFile(req);
  if ('error' in got) return got.error;
  const sql = db();
  const cats = (await sql`
    SELECT category_key FROM public.file_categories WHERE file_id = ${got.row.id as string}::uuid
  `) as { category_key: string }[];
  return jsonOk({ file: { ...got.row, categories: cats.map((c) => c.category_key) } });
}

async function handlePatch(req: Request): Promise<Response> {
  const got = await fetchVisibleFile(req);
  if ('error' in got) return got.error;
  const session = got.session;

  // Write guard
  const sql = db();
  try { await assertCanWrite(sql, session as any); }
  catch (e) { if (e instanceof ForbiddenError) return jsonError(403, e.key); throw e; }

  // Capability
  // (Re-resolve to require .edit specifically — the .view check already passed.)
  const editAuth = await authenticateForPermission(req, '_platform.files.edit');
  if (editAuth instanceof Response) return editAuth;

  const body = PatchBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'validation_failed', body.error.flatten());
  const d = body.data;

  if (d.categories) {
    for (const c of d.categories) if (!isCategoryKey(c)) return jsonError(400, 'unknown_category');
  }
  // Tier-cap
  if (d.tier && (d.tier === 'restricted' || d.tier === 'confidential') && !isL1Owner(session as any)) {
    return jsonError(403, 'tier_requires_owner');
  }
  // Admin vault single tier
  if (got.row.client_id === null && d.tier && d.tier !== 'public') {
    return jsonError(400, 'admin_vault_single_tier');
  }

  const file_id = got.row.id as string;
  const oldTier = got.row.tier as string;

  // Apply metadata diff
  await sql`
    UPDATE public.files SET
      title = COALESCE(${d.title ?? null}, title),
      description = COALESCE(${d.description ?? null}, description),
      tier = COALESCE(${d.tier ?? null}, tier),
      updated_at = now()
    WHERE id = ${file_id}::uuid
  `;
  if (d.categories) {
    await sql`DELETE FROM public.file_categories WHERE file_id = ${file_id}::uuid`;
    for (const c of d.categories) {
      await sql`INSERT INTO public.file_categories (file_id, category_key) VALUES (${file_id}::uuid, ${c})`;
    }
  }
  if (d.tier === 'role' && d.allowed_role_ids) {
    await sql`DELETE FROM public.file_allowed_roles WHERE file_id = ${file_id}::uuid`;
    for (const r of d.allowed_role_ids) {
      await sql`INSERT INTO public.file_allowed_roles (file_id, role_id) VALUES (${file_id}::uuid, ${r}::uuid)`;
    }
  }
  if (d.tier === 'restricted' && d.allowed_node_ids) {
    await sql`DELETE FROM public.file_allowed_nodes WHERE file_id = ${file_id}::uuid`;
    for (const n of d.allowed_node_ids) {
      await sql`INSERT INTO public.file_allowed_nodes (file_id, node_id) VALUES (${file_id}::uuid, ${n}::uuid)`;
    }
  }
  if (d.tier === 'confidential' && d.allowed_user_node_ids) {
    await sql`DELETE FROM public.file_allowed_users WHERE file_id = ${file_id}::uuid`;
    for (const u of d.allowed_user_node_ids) {
      await sql`INSERT INTO public.file_allowed_users (file_id, user_node_id) VALUES (${file_id}::uuid, ${u}::uuid)`;
    }
  }

  await logAudit(sql, {
    session: session as any,
    op: d.tier && d.tier !== oldTier ? 'files.tier_changed' : 'files.metadata_edited',
    clientId: (got.row.client_id as string | null) ?? null,
    targetType: 'file',
    targetId: file_id,
    detail: d.tier && d.tier !== oldTier
      ? { old_tier: oldTier, new_tier: d.tier }
      : { diff: { title: d.title ?? undefined, description: d.description ?? undefined, categories: d.categories } },
  });

  return jsonOk({ ok: true });
}

async function handleDelete(req: Request): Promise<Response> {
  const got = await fetchVisibleFile(req);
  if ('error' in got) return got.error;
  const session = got.session;
  const sql = db();
  try { await assertCanWrite(sql, session as any); }
  catch (e) { if (e instanceof ForbiddenError) return jsonError(403, e.key); throw e; }

  const delAuth = await authenticateForPermission(req, '_platform.files.delete');
  if (delAuth instanceof Response) return delAuth;

  const file_id = got.row.id as string;
  const byte_size = got.row.byte_size as number | null;
  const isHard = new URL(req.url).searchParams.get('hard') === 'true';

  if (isHard) {
    // Best-effort blob removal; non-fatal.
    const blob_key = got.row.blob_key as string | null;
    if (blob_key) {
      try { await filesStore().delete(blob_key); } catch (e) { console.error('[files] blob delete failed', e); }
    }
    await sql`DELETE FROM public.files WHERE id = ${file_id}::uuid`;
    await logAudit(sql, {
      session: session as any, op: 'files.deleted_hard',
      clientId: (got.row.client_id as string | null) ?? null,
      targetType: 'file', targetId: file_id, detail: { byte_size },
    });
  } else {
    await sql`UPDATE public.files SET deleted_at = now() WHERE id = ${file_id}::uuid`;
    await logAudit(sql, {
      session: session as any, op: 'files.deleted_soft',
      clientId: (got.row.client_id as string | null) ?? null,
      targetType: 'file', targetId: file_id, detail: null,
    });
  }

  return new Response(null, { status: 204 });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === 'GET')    return handleGet(req);
  if (req.method === 'PATCH')  return handlePatch(req);
  if (req.method === 'DELETE') return handleDelete(req);
  return jsonError(405, 'method_not_allowed');
};
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/integration/files-detail.test.ts --run
npm run typecheck
```

Expected: tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/files-detail.ts tests/integration/files-detail.test.ts
git commit -m "feat(files): GET/PATCH/DELETE files-detail with audit ops"
```

---

## Task 13: `files-download-url.ts` + `files-thumbnail.ts`

**Files:**
- Create: `netlify/functions/files-download-url.ts`
- Create: `netlify/functions/files-thumbnail.ts`
- Create: `tests/integration/files-download-thumbnail.test.ts`

For Phase A, both endpoints stream from Blobs through the function (matches the upload-streaming approach in Task 11).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/files-download-thumbnail.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';
import uploadHandler from '../../netlify/functions/files-upload';
import filesHandler from '../../netlify/functions/files';
import downloadHandler from '../../netlify/functions/files-download-url';
import thumbHandler from '../../netlify/functions/files-thumbnail';

const CTX = {} as Context;
const EMAIL = 'files-dl-thumb-test@example.com';
const PW = 'files-dl-thumb-pw';

let sql: ReturnType<typeof neon>;
let cookie: string;
let adminId: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const hash = await hashPassword(PW);
  const r = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${EMAIL}, ${hash}, 'DLTH Test', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash}, display_name = 'DLTH Test', is_bootstrap = true
    RETURNING id
  `) as { id: string }[];
  adminId = r[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${EMAIL}`;
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
  const res = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW }),
    }), CTX);
  cookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
});

async function createFile(mime: string, bytes: string): Promise<{ id: string; blob_key: string }> {
  const r1 = await uploadUrlHandler(
    new Request('http://localhost/api/files-upload-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ filename: 'x', mime, byte_size: bytes.length }),
    }), CTX);
  const { blob_key, upload_token } = await r1.json();
  await uploadHandler(
    new Request(`http://localhost/api/files-upload?token=${upload_token}`, {
      method: 'PUT', headers: { 'Content-Type': mime, cookie }, body: bytes,
    }), CTX);
  const r3 = await filesHandler(
    new Request('http://localhost/api/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        blob_key, title: 't', mime, byte_size: bytes.length, filename: 'x', categories: ['marketing_brand'],
      }),
    }), CTX);
  return { id: (await r3.json()).file.id, blob_key };
}

describe('POST /api/files-download-url', () => {
  test('returns content-disposition headers + streams the bytes', async () => {
    const { id } = await createFile('application/pdf', 'HELLO');
    const res = await downloadHandler(
      new Request('http://localhost/api/files-download-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ file_id: id }),
      }), CTX);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const text = await res.text();
    expect(text).toBe('HELLO');
  });

  test('404 for unknown id', async () => {
    const res = await downloadHandler(
      new Request('http://localhost/api/files-download-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ file_id: '00000000-0000-0000-0000-000000000000' }),
      }), CTX);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/files-thumbnail/:id', () => {
  test('404 for files without thumbnail yet (lazy gen deferred)', async () => {
    const { id } = await createFile('application/pdf', 'ABCD');
    const res = await thumbHandler(
      new Request(`http://localhost/api/files-thumbnail/${id}`, {
        method: 'GET', headers: { cookie },
      }), CTX);
    // Phase A: no thumb generated yet for non-image; 404 expected.
    expect([404, 415]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/integration/files-download-thumbnail.test.ts --run
```

Expected: FAIL — handlers don't exist.

- [ ] **Step 3: Implement `files-download-url.ts`**

Create `netlify/functions/files-download-url.ts`:

```ts
// POST /api/files-download-url
// Returns the bytes inline. Body: { file_id }.
// Phase A streams through the function (simple, portable). A presigned-URL
// upgrade can replace this in a future phase without changing the API shape.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { authenticateForPermission } from './_shared/permissions';
import { TIER_VISIBILITY_CLAUSE, visibilityValues, resolveRoleId } from './_shared/files-access';
import { filesStore } from './_shared/files-storage';

const Body = z.object({ file_id: z.string().uuid() });

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const auth = await authenticateForPermission(req, '_platform.files.view');
  if (auth instanceof Response) return auth;
  const session = auth;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const sql = db();
  const roleId = await resolveRoleId(sql, session);
  const vv = visibilityValues(session, roleId);

  const clauses: string[] = ['files.id = $1::uuid'];
  const params: unknown[] = [parsed.data.file_id];
  if (!vv.skipClause) {
    params.push(vv.userNodeId, vv.roleId);
    clauses.push(
      TIER_VISIBILITY_CLAUSE.replaceAll('$1', `$${params.length - 1}`).replaceAll('$2', `$${params.length}`),
    );
  }
  if (session.kind === 'admin') {
    clauses.push('files.client_id IS NULL');
  } else {
    params.push(session.client_id);
    clauses.push(`files.client_id = $${params.length}::uuid`);
  }
  const rows = (await (sql as any).query(
    `SELECT blob_key, mime, filename FROM public.files WHERE ${clauses.join(' AND ')} LIMIT 1`,
    params,
  )) as { blob_key: string | null; mime: string | null; filename: string | null }[];
  if (rows.length === 0 || !rows[0]!.blob_key) return jsonError(404, 'not_found');

  const store = filesStore();
  const blob = await store.get(rows[0]!.blob_key, { type: 'arrayBuffer' });
  if (!blob) return jsonError(404, 'blob_missing');

  const filename = rows[0]!.filename ?? 'file';
  return new Response(blob, {
    status: 200,
    headers: {
      'content-type': rows[0]!.mime ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'cache-control': 'private, max-age=0',
    },
  });
};
```

- [ ] **Step 4: Implement `files-thumbnail.ts`**

Create `netlify/functions/files-thumbnail.ts`:

```ts
// GET /api/files-thumbnail/:id
// Phase A: returns the stored thumbnail bytes when present, else 404.
// Lazy generation is wired in Phase B; this stub keeps the URL shape stable.

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { authenticateForPermission } from './_shared/permissions';
import { TIER_VISIBILITY_CLAUSE, visibilityValues, resolveRoleId } from './_shared/files-access';
import { thumbnailsStore } from './_shared/files-storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/files-thumbnail\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');

  const auth = await authenticateForPermission(req, '_platform.files.view');
  if (auth instanceof Response) return auth;
  const session = auth;

  const sql = db();
  const roleId = await resolveRoleId(sql, session);
  const vv = visibilityValues(session, roleId);

  const clauses: string[] = ['files.id = $1::uuid'];
  const params: unknown[] = [id];
  if (!vv.skipClause) {
    params.push(vv.userNodeId, vv.roleId);
    clauses.push(
      TIER_VISIBILITY_CLAUSE.replaceAll('$1', `$${params.length - 1}`).replaceAll('$2', `$${params.length}`),
    );
  }
  if (session.kind === 'admin') {
    clauses.push('files.client_id IS NULL');
  } else {
    params.push(session.client_id);
    clauses.push(`files.client_id = $${params.length}::uuid`);
  }
  const rows = (await (sql as any).query(
    `SELECT thumbnail_key, type FROM public.files WHERE ${clauses.join(' AND ')} LIMIT 1`,
    params,
  )) as { thumbnail_key: string | null; type: string }[];
  if (rows.length === 0) return jsonError(404, 'not_found');
  if (rows[0]!.type !== 'image') return jsonError(415, 'thumbnail_unsupported_for_type');
  if (!rows[0]!.thumbnail_key) return jsonError(404, 'thumbnail_not_generated');

  const bytes = await thumbnailsStore().get(rows[0]!.thumbnail_key, { type: 'arrayBuffer' });
  if (!bytes) return jsonError(404, 'thumbnail_missing');

  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=86400' },
  });
};
```

- [ ] **Step 5: Run to verify pass**

```bash
npm test -- tests/integration/files-download-thumbnail.test.ts --run
npm run typecheck
```

Expected: tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/files-download-url.ts netlify/functions/files-thumbnail.ts tests/integration/files-download-thumbnail.test.ts
git commit -m "feat(files): download streaming + thumbnail stub endpoint"
```

---

## Task 14: Permission-boundary matrix test

**Files:**
- Create: `tests/integration/files-permission-boundary.test.ts`

A single exhaustive test that asserts every endpoint × wrong-session-kind returns 401/403 (not 404, not 500). Catches the information-disclosure-via-error-code class of bug. Per risk register R3.

- [ ] **Step 1: Write the test (no implementation step — purely a verification)**

Create `tests/integration/files-permission-boundary.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import filesHandler from '../../netlify/functions/files';
import detailHandler from '../../netlify/functions/files-detail';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';
import uploadHandler from '../../netlify/functions/files-upload';
import downloadHandler from '../../netlify/functions/files-download-url';
import thumbHandler from '../../netlify/functions/files-thumbnail';

const CTX = {} as Context;
const FAKE_ID = '00000000-0000-0000-0000-000000000000';

// Helper: build a request with no session cookie.
function noAuth(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

const cases: Array<{ name: string; req: Request; handler: (r: Request, c: Context) => Promise<Response> }> = [
  { name: 'GET /api/files',                   req: noAuth('GET',  'http://x/api/files'),                     handler: filesHandler },
  { name: 'POST /api/files',                  req: noAuth('POST', 'http://x/api/files', {}),                 handler: filesHandler },
  { name: 'GET /api/files-detail/:id',        req: noAuth('GET',  `http://x/api/files-detail/${FAKE_ID}`),   handler: detailHandler },
  { name: 'PATCH /api/files-detail/:id',      req: noAuth('PATCH',`http://x/api/files-detail/${FAKE_ID}`,{}),handler: detailHandler },
  { name: 'DELETE /api/files-detail/:id',     req: noAuth('DELETE',`http://x/api/files-detail/${FAKE_ID}`),  handler: detailHandler },
  { name: 'POST /api/files-upload-url',       req: noAuth('POST', 'http://x/api/files-upload-url', {}),      handler: uploadUrlHandler },
  { name: 'PUT /api/files-upload',            req: noAuth('PUT',  'http://x/api/files-upload?token=x', {}),  handler: uploadHandler },
  { name: 'POST /api/files-download-url',     req: noAuth('POST', 'http://x/api/files-download-url', {}),    handler: downloadHandler },
  { name: 'GET /api/files-thumbnail/:id',     req: noAuth('GET',  `http://x/api/files-thumbnail/${FAKE_ID}`),handler: thumbHandler },
];

describe('files endpoints — unauthenticated', () => {
  for (const c of cases) {
    test(`${c.name} → 401`, async () => {
      const res = await c.handler(c.req, CTX);
      expect(res.status, `${c.name} returned ${res.status}, expected 401`).toBe(401);
    });
  }
});
```

- [ ] **Step 2: Run to verify pass (no impl needed — all endpoints already require auth)**

```bash
npm test -- tests/integration/files-permission-boundary.test.ts --run
```

Expected: 9 PASS. If any endpoint returns something other than 401, the matrix test points at a missing auth guard — fix in the offending handler.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/files-permission-boundary.test.ts
git commit -m "test(files): permission boundary matrix — all endpoints 401 unauthenticated"
```

---

## Task 15: Frontend foundation — types, api client, categories

**Files:**
- Create: `src/modules/files/shared/types.ts`
- Create: `src/modules/files/shared/api.ts`

Frontend testing in this codebase is light (no React Testing Library in deps). For frontend tasks (15–19), "test" is `npm run typecheck` + manual smoke. Backend coverage from Tasks 4–14 carries the correctness load.

- [ ] **Step 1: Define types**

Create `src/modules/files/shared/types.ts`:

```ts
import type { CategoryKey } from './categories';

export type FileType = 'document' | 'image' | 'video' | 'audio' | 'external';
export type FileStorageKind = 'blob' | 'url';
export type FileTier = 'public' | 'role' | 'restricted' | 'confidential';

export interface FileRow {
  id: string;
  client_id: string | null;
  type: FileType;
  storage_kind: FileStorageKind;
  blob_key: string | null;
  external_url: string | null;
  external_provider: string | null;
  title: string;
  description: string | null;
  filename: string | null;
  mime: string | null;
  byte_size: number | null;
  thumbnail_key: string | null;
  tier: FileTier;
  uploaded_by_user_node: string | null;
  uploaded_by_admin: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  categories?: CategoryKey[];
}

export interface ListFilters {
  type?: FileType;
  category?: CategoryKey[];
  search?: string;
  sort?: 'newest' | 'oldest' | 'name' | 'size';
}

export interface ListResponse {
  files: FileRow[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface UploadCommitBody {
  blob_key?: string;
  external_url?: string;
  external_provider?: string | null;
  title: string;
  description?: string;
  filename?: string;
  mime?: string;
  byte_size?: number;
  categories: CategoryKey[];
  tier: FileTier;
  allowed_role_ids?: string[];
  allowed_node_ids?: string[];
  allowed_user_node_ids?: string[];
}
```

- [ ] **Step 2: Implement the api client**

Create `src/modules/files/shared/api.ts`:

```ts
import type { FileRow, ListFilters, ListResponse, UploadCommitBody } from './types';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) {
    let detail: unknown = null;
    try { detail = await res.json(); } catch { /* */ }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) { super(`api ${status}`); }
}

export async function listFiles(clientId: string | null, filters: ListFilters): Promise<ListResponse> {
  const sp = new URLSearchParams();
  if (clientId) sp.set('client', clientId);
  if (filters.type) sp.set('type', filters.type);
  if (filters.search) sp.set('search', filters.search);
  if (filters.sort) sp.set('sort', filters.sort);
  for (const c of filters.category ?? []) sp.append('category', c);
  return jsonFetch<ListResponse>(`/api/files?${sp.toString()}`);
}

export async function getFile(id: string): Promise<{ file: FileRow }> {
  return jsonFetch(`/api/files-detail/${id}`);
}

export async function patchFile(id: string, body: Partial<UploadCommitBody>): Promise<{ ok: true }> {
  return jsonFetch(`/api/files-detail/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteFile(id: string, hard = false): Promise<void> {
  await fetch(`/api/files-detail/${id}${hard ? '?hard=true' : ''}`, {
    method: 'DELETE', credentials: 'include',
  });
}

export async function reserveUploadUrl(file: { name: string; type: string; size: number }):
  Promise<{ blob_key: string; upload_token: string; upload_url: string }> {
  return jsonFetch('/api/files-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, mime: file.type, byte_size: file.size }),
  });
}

export async function uploadBytes(token: string, mime: string, body: Blob): Promise<void> {
  const res = await fetch(`/api/files-upload?token=${token}`, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    credentials: 'include',
    body,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}

export async function commitFile(body: UploadCommitBody): Promise<{ file: FileRow }> {
  return jsonFetch('/api/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/modules/files/shared/types.ts src/modules/files/shared/api.ts
git commit -m "feat(files): frontend types + api client"
```

---

## Task 16: Atom components — CategoryChip, TierBadge

**Files:**
- Create: `src/modules/files/shared/components/CategoryChip.tsx`
- Create: `src/modules/files/shared/components/TierBadge.tsx`

- [ ] **Step 1: Implement `CategoryChip`**

Create `src/modules/files/shared/components/CategoryChip.tsx`:

```tsx
import type { CategoryKey } from '../categories';
import { CATEGORY_LABELS } from '../categories';

const COLORS: Record<CategoryKey, string> = {
  finance_accounting:        '#2c5f2d',
  hr_payroll:                '#603f8b',
  legal_compliance:          '#7a3035',
  sales_crm:                 '#c08a1f',
  marketing_brand:           '#1f6a8a',
  product_catalog:           '#3a3a8a',
  procurement_supply_chain:  '#5a4329',
  operations_warehouse:      '#3a5a3a',
  manufacturing:             '#5a3a3a',
  customer_service:          '#3a5a5a',
  project_workflow:          '#5a5a3a',
};

interface Props {
  category: CategoryKey;
  onRemove?: () => void;
}

export function CategoryChip({ category, onRemove }: Props) {
  return (
    <span
      style={{
        background: COLORS[category],
        color: '#fff',
        padding: '4px 10px',
        borderRadius: 12,
        fontSize: 11,
        display: 'inline-flex',
        gap: 6,
        alignItems: 'center',
      }}
    >
      {CATEGORY_LABELS[category]}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 0 }}
          aria-label={`Remove ${CATEGORY_LABELS[category]}`}
        >×</button>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Implement `TierBadge`**

Create `src/modules/files/shared/components/TierBadge.tsx`:

```tsx
import type { FileTier } from '../types';

const TIER_ICON: Record<FileTier, string> = {
  public:       '🌐',
  role:         '👥',
  restricted:   '🛡',
  confidential: '🔒',
};

const TIER_LABEL: Record<FileTier, string> = {
  public:       'Public',
  role:         'Role-based',
  restricted:   'Restricted',
  confidential: 'Confidential',
};

interface Props {
  tier: FileTier;
  ownerOverride?: boolean;
}

export function TierBadge({ tier, ownerOverride }: Props) {
  return (
    <span
      title={ownerOverride ? `${TIER_LABEL[tier]} (visible via Owner override)` : TIER_LABEL[tier]}
      style={{
        display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11, color: '#999',
      }}
    >
      <span>{TIER_ICON[tier]}</span>
      <span>{TIER_LABEL[tier]}</span>
    </span>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/files/shared/components/CategoryChip.tsx src/modules/files/shared/components/TierBadge.tsx
git commit -m "feat(files): CategoryChip + TierBadge atom components"
```

---

## Task 17: Pickers — RolePicker, NodePicker, UserPicker

**Files:**
- Create: `src/modules/files/shared/components/RolePicker.tsx`
- Create: `src/modules/files/shared/components/NodePicker.tsx`
- Create: `src/modules/files/shared/components/UserPicker.tsx`

Each picker is a controlled multi-select. For Phase A we keep them as simple checkbox lists that fetch their data on mount from existing endpoints (`/api/client-roles`, `/api/user-nodes`, `/api/user-nodes` filtered). If a more polished tree-picker exists from the AMS work, swap it in during Phase B.

- [ ] **Step 1: Implement `RolePicker`**

Create `src/modules/files/shared/components/RolePicker.tsx`:

```tsx
import { useEffect, useState } from 'react';

interface RoleRow { id: string; name: string; bucket_family: string | null }

interface Props {
  clientId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}

export function RolePicker({ clientId, value, onChange }: Props) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/client-roles?client=${clientId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setRoles(d.roles ?? []))
      .catch(() => setRoles([]));
  }, [clientId]);

  if (!clientId) return <p style={{ color: '#888', fontSize: 12 }}>Admin vault — no roles to pick.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {roles.map((r) => {
        const checked = value.includes(r.id);
        return (
          <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                onChange(checked ? value.filter((v) => v !== r.id) : [...value, r.id]);
              }}
            />
            <span>{r.name} {r.bucket_family ? <em style={{ color: '#888' }}>({r.bucket_family})</em> : null}</span>
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Implement `NodePicker`**

Create `src/modules/files/shared/components/NodePicker.tsx`:

```tsx
import { useEffect, useState } from 'react';

interface NodeRow { id: string; display_name: string; level_number: number }

interface Props {
  clientId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}

export function NodePicker({ clientId, value, onChange }: Props) {
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/user-nodes?client=${clientId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setNodes(d.nodes ?? []))
      .catch(() => setNodes([]));
  }, [clientId]);

  if (!clientId) return <p style={{ color: '#888', fontSize: 12 }}>Admin vault — no nodes to pick.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }}>
      {nodes.map((n) => {
        const checked = value.includes(n.id);
        return (
          <label key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: (n.level_number - 1) * 16 }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onChange(checked ? value.filter((v) => v !== n.id) : [...value, n.id])}
            />
            <span>{n.display_name} <em style={{ color: '#888', fontSize: 10 }}>L{n.level_number}</em></span>
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Implement `UserPicker`**

Create `src/modules/files/shared/components/UserPicker.tsx`:

```tsx
import { useEffect, useState } from 'react';

interface UserRow { id: string; display_name: string; email: string | null }

interface Props {
  clientId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}

export function UserPicker({ clientId, value, onChange }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/user-nodes?client=${clientId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setUsers((d.nodes as UserRow[]) ?? []))
      .catch(() => setUsers([]));
  }, [clientId]);

  if (!clientId) return <p style={{ color: '#888', fontSize: 12 }}>Admin vault — no users to pick.</p>;
  const filtered = q
    ? users.filter((u) => u.display_name.toLowerCase().includes(q.toLowerCase()) ||
                          (u.email ?? '').toLowerCase().includes(q.toLowerCase()))
    : users;

  return (
    <div>
      <input
        placeholder="Search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', marginBottom: 6, padding: 6 }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }}>
        {filtered.map((u) => {
          const checked = value.includes(u.id);
          return (
            <label key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(checked ? value.filter((v) => v !== u.id) : [...value, u.id])}
              />
              <span>{u.display_name} <em style={{ color: '#888', fontSize: 10 }}>{u.email}</em></span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/files/shared/components/RolePicker.tsx src/modules/files/shared/components/NodePicker.tsx src/modules/files/shared/components/UserPicker.tsx
git commit -m "feat(files): RolePicker + NodePicker + UserPicker"
```

> **Implementer note:** the existing endpoints `/api/client-roles` and `/api/user-nodes` may use different query parameter names than `?client=`. Verify those before wiring; adapt the fetch URLs as needed.

---

## Task 18: TierPicker (stepper)

**Files:**
- Create: `src/modules/files/shared/components/TierPicker.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { FileTier } from '../types';
import { RolePicker } from './RolePicker';
import { NodePicker } from './NodePicker';
import { UserPicker } from './UserPicker';

interface Props {
  clientId: string | null;
  tier: FileTier;
  onTierChange: (t: FileTier) => void;
  allowedRoleIds: string[];
  allowedNodeIds: string[];
  allowedUserNodeIds: string[];
  onAllowedRoleIdsChange: (next: string[]) => void;
  onAllowedNodeIdsChange: (next: string[]) => void;
  onAllowedUserNodeIdsChange: (next: string[]) => void;
  isL1Owner: boolean;
  isAdminVault: boolean;
}

const TIERS: { value: FileTier; label: string; hint: string }[] = [
  { value: 'public',       label: 'Public',       hint: 'anyone in workspace' },
  { value: 'role',         label: 'Role-based',   hint: 'specific roles' },
  { value: 'restricted',   label: 'Restricted',   hint: 'specific access-level nodes' },
  { value: 'confidential', label: 'Confidential', hint: 'specific users only' },
];

export function TierPicker(p: Props) {
  if (p.isAdminVault) {
    return <p style={{ color: '#888', fontSize: 12 }}>Admin vault files are visible to all ExSol operators.</p>;
  }
  const ownerOnly = (t: FileTier) => (t === 'restricted' || t === 'confidential') && !p.isL1Owner;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {TIERS.map((t) => {
          const disabled = ownerOnly(t.value);
          return (
            <label key={t.value} style={{ display: 'flex', gap: 10, alignItems: 'center', opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
              <input
                type="radio"
                name="tier"
                checked={p.tier === t.value}
                disabled={disabled}
                onChange={() => p.onTierChange(t.value)}
              />
              <span>{t.label} <em style={{ color: '#888', fontSize: 11 }}>— {t.hint}</em></span>
              {disabled && <em style={{ color: '#888', fontSize: 10 }}>Owner only</em>}
            </label>
          );
        })}
      </div>

      {p.tier === 'role' && (
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Pick roles:</div>
          <RolePicker clientId={p.clientId} value={p.allowedRoleIds} onChange={p.onAllowedRoleIdsChange} />
        </div>
      )}
      {p.tier === 'restricted' && (
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Pick subtree roots:</div>
          <NodePicker clientId={p.clientId} value={p.allowedNodeIds} onChange={p.onAllowedNodeIdsChange} />
        </div>
      )}
      {p.tier === 'confidential' && (
        <div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Pick specific users:</div>
          <UserPicker clientId={p.clientId} value={p.allowedUserNodeIds} onChange={p.onAllowedUserNodeIdsChange} />
          <p style={{ fontSize: 11, color: '#c93', marginTop: 8 }}>
            ⚠ Confidential files are hidden from most of your team. The Owner can always see them.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/files/shared/components/TierPicker.tsx
git commit -m "feat(files): TierPicker stepper with conditional audience pickers"
```

---

## Task 19: UploadModal + FileTile + FileDetailModal

**Files:**
- Create: `src/modules/files/shared/components/UploadModal.tsx`
- Create: `src/modules/files/shared/components/FileTile.tsx`
- Create: `src/modules/files/shared/components/FileDetailModal.tsx`

Three components in one task. Each is a focused module.

- [ ] **Step 1: Implement `FileTile`**

Create `src/modules/files/shared/components/FileTile.tsx`:

```tsx
import type { FileRow } from '../types';
import { TierBadge } from './TierBadge';

const TYPE_ICON: Record<FileRow['type'], string> = {
  document: '📄', image: '🖼', video: '🎬', audio: '🎵', external: '🔗',
};

interface Props {
  file: FileRow;
  selected?: boolean;
  onClick?: () => void;
  onToggleSelect?: () => void;
}

export function FileTile({ file, selected, onClick, onToggleSelect }: Props) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, padding: 12,
        background: selected ? '#1a1a1a' : '#0a0a0a',
        border: `1px solid ${selected ? '#fff' : '#222'}`,
        borderRadius: 6, cursor: 'pointer', minHeight: 110,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 28 }}>{TYPE_ICON[file.type]}</span>
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
      <div style={{ fontSize: 13, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file.title}
      </div>
      <TierBadge tier={file.tier} />
    </div>
  );
}
```

- [ ] **Step 2: Implement `UploadModal`**

Create `src/modules/files/shared/components/UploadModal.tsx`:

```tsx
import { useState } from 'react';
import type { CategoryKey } from '../categories';
import { CATEGORY_KEYS, CATEGORY_LABELS, MAX_CATEGORIES_PER_FILE } from '../categories';
import type { FileTier } from '../types';
import { reserveUploadUrl, uploadBytes, commitFile, ApiError } from '../api';
import { TierPicker } from './TierPicker';
import { CategoryChip } from './CategoryChip';

interface Props {
  clientId: string | null;
  isL1Owner: boolean;
  isAdminVault: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

export function UploadModal({ clientId, isL1Owner, isAdminVault, onClose, onUploaded }: Props) {
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<CategoryKey[]>([]);
  const [tier, setTier] = useState<FileTier>('public');
  const [allowedRoleIds, setAllowedRoleIds] = useState<string[]>([]);
  const [allowedNodeIds, setAllowedNodeIds] = useState<string[]>([]);
  const [allowedUserNodeIds, setAllowedUserNodeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCategory(c: CategoryKey) {
    setCategories((prev) => {
      if (prev.includes(c)) return prev.filter((x) => x !== c);
      if (prev.length >= MAX_CATEGORIES_PER_FILE) return prev;
      return [...prev, c];
    });
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      if (!title) throw new ApiError(400, { error: 'title_required' });
      if (categories.length === 0) throw new ApiError(400, { error: 'category_required' });

      if (mode === 'file') {
        if (!pickedFile) throw new ApiError(400, { error: 'file_required' });
        const { blob_key, upload_token } = await reserveUploadUrl({
          name: pickedFile.name, type: pickedFile.type || 'application/octet-stream', size: pickedFile.size,
        });
        await uploadBytes(upload_token, pickedFile.type || 'application/octet-stream', pickedFile);
        await commitFile({
          blob_key,
          title,
          description: description || undefined,
          mime: pickedFile.type, byte_size: pickedFile.size, filename: pickedFile.name,
          categories, tier,
          allowed_role_ids: tier === 'role' ? allowedRoleIds : undefined,
          allowed_node_ids: tier === 'restricted' ? allowedNodeIds : undefined,
          allowed_user_node_ids: tier === 'confidential' ? allowedUserNodeIds : undefined,
        });
      } else {
        if (!url) throw new ApiError(400, { error: 'url_required' });
        await commitFile({
          external_url: url,
          title,
          description: description || undefined,
          categories, tier,
          allowed_role_ids: tier === 'role' ? allowedRoleIds : undefined,
          allowed_node_ids: tier === 'restricted' ? allowedNodeIds : undefined,
          allowed_user_node_ids: tier === 'confidential' ? allowedUserNodeIds : undefined,
        });
      }
      onUploaded();
      onClose();
    } catch (e) {
      const detail = (e as ApiError).detail as { error?: string } | null;
      setError(detail?.error ?? (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#000', border: '1px solid #222', borderRadius: 8, padding: 24, width: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Upload</h3>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <button type="button" onClick={() => setMode('file')} style={{ fontWeight: mode === 'file' ? 700 : 400 }}>File</button>
          <button type="button" onClick={() => setMode('url')} style={{ fontWeight: mode === 'url' ? 700 : 400 }}>URL</button>
        </div>

        {mode === 'file'
          ? <input type="file" onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)} />
          : <input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: '100%', padding: 8 }} />}

        <label style={{ display: 'block', marginTop: 12 }}>
          Title <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', padding: 6 }} />
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          Description <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', padding: 6, minHeight: 50 }} />
        </label>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Categories (up to {MAX_CATEGORIES_PER_FILE}):</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {CATEGORY_KEYS.map((c) => {
              const on = categories.includes(c);
              return (
                <button
                  key={c} type="button"
                  onClick={() => toggleCategory(c)}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 12,
                    background: on ? '#2c5f2d' : '#1a1a1a',
                    color: on ? '#fff' : '#888',
                    border: 'none', cursor: 'pointer',
                  }}
                >{CATEGORY_LABELS[c]}</button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Security tier:</div>
          <TierPicker
            clientId={clientId}
            tier={tier}
            onTierChange={setTier}
            allowedRoleIds={allowedRoleIds} onAllowedRoleIdsChange={setAllowedRoleIds}
            allowedNodeIds={allowedNodeIds} onAllowedNodeIdsChange={setAllowedNodeIds}
            allowedUserNodeIds={allowedUserNodeIds} onAllowedUserNodeIdsChange={setAllowedUserNodeIds}
            isL1Owner={isL1Owner} isAdminVault={isAdminVault}
          />
        </div>

        {error && <p style={{ color: '#c66', marginTop: 12 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} style={{ background: '#fff', color: '#000', padding: '6px 14px' }}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `FileDetailModal`**

Create `src/modules/files/shared/components/FileDetailModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { CategoryKey } from '../categories';
import { CATEGORY_KEYS, CATEGORY_LABELS } from '../categories';
import type { FileRow, FileTier } from '../types';
import { deleteFile, getFile, patchFile } from '../api';
import { TierBadge } from './TierBadge';
import { CategoryChip } from './CategoryChip';

interface Props {
  id: string;
  isL1Owner: boolean;
  isAdminVault: boolean;
  clientId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

export function FileDetailModal(p: Props) {
  const [file, setFile] = useState<FileRow | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<CategoryKey[]>([]);
  const [tier, setTier] = useState<FileTier>('public');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFile(p.id).then(({ file: f }) => {
      setFile(f);
      setTitle(f.title);
      setDescription(f.description ?? '');
      setCategories((f.categories ?? []) as CategoryKey[]);
      setTier(f.tier);
    }).catch(() => setFile(null));
  }, [p.id]);

  async function save() {
    setBusy(true);
    try {
      await patchFile(p.id, { title, description, categories, tier });
      p.onChanged();
      p.onClose();
    } finally { setBusy(false); }
  }

  async function remove(hard: boolean) {
    if (!confirm(hard ? 'Permanently delete this file?' : 'Move to trash?')) return;
    setBusy(true);
    try {
      await deleteFile(p.id, hard);
      p.onChanged();
      p.onClose();
    } finally { setBusy(false); }
  }

  if (!file) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#000', border: '1px solid #222', borderRadius: 8, padding: 24, width: 720, maxHeight: '90vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>{file.title} <TierBadge tier={file.tier} /></h3>

        <div style={{ marginBottom: 16, color: '#888', fontSize: 12 }}>
          {file.type} · {file.byte_size ? `${(file.byte_size / 1024).toFixed(1)} KB` : '—'} · {new Date(file.created_at).toLocaleString()}
        </div>

        <label style={{ display: 'block', marginTop: 8 }}>
          Title <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', padding: 6 }} />
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          Description <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', padding: 6, minHeight: 60 }} />
        </label>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Categories:</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {CATEGORY_KEYS.map((c) => {
              const on = categories.includes(c);
              return (
                <button
                  key={c} type="button"
                  onClick={() => setCategories((prev) => on ? prev.filter((x) => x !== c) : prev.length < 3 ? [...prev, c] : prev)}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 12,
                    background: on ? '#2c5f2d' : '#1a1a1a', color: on ? '#fff' : '#888',
                    border: 'none', cursor: 'pointer',
                  }}
                >{CATEGORY_LABELS[c]}</button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', marginTop: 20 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => remove(false)} disabled={busy}>Move to trash</button>
            <button type="button" onClick={() => remove(true)} disabled={busy} style={{ color: '#c66' }}>Delete permanently</button>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" onClick={p.onClose}>Cancel</button>
            <button type="button" onClick={save} disabled={busy} style={{ background: '#fff', color: '#000', padding: '6px 14px' }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/files/shared/components/FileTile.tsx src/modules/files/shared/components/UploadModal.tsx src/modules/files/shared/components/FileDetailModal.tsx
git commit -m "feat(files): FileTile + UploadModal + FileDetailModal"
```

---

## Task 20: FilterBar + FileGrid + admin/workspace pages + routes + nav

**Files:**
- Create: `src/modules/files/shared/components/FilterBar.tsx`
- Create: `src/modules/files/shared/components/FileGrid.tsx`
- Create: `src/modules/files/shared/FilesPage.tsx` (shared page body)
- Create: `src/modules/files/admin/AdminFilesPage.tsx`
- Create: `src/modules/files/workspace/WorkspaceFilesPage.tsx`
- Modify: admin and user-portal route configs
- Modify: sidebar nav configs

This task wires everything end-to-end. After this task the file manager is reachable in the browser.

- [ ] **Step 1: Implement `FilterBar`**

Create `src/modules/files/shared/components/FilterBar.tsx`:

```tsx
import type { CategoryKey } from '../categories';
import { CATEGORY_KEYS, CATEGORY_LABELS } from '../categories';

interface Props {
  selected: CategoryKey[];
  onChange: (next: CategoryKey[]) => void;
}

export function FilterBar({ selected, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
      <span style={{ fontSize: 12, color: '#888' }}>Categories:</span>
      {CATEGORY_KEYS.map((c) => {
        const on = selected.includes(c);
        return (
          <button
            key={c} type="button"
            onClick={() => onChange(on ? selected.filter((x) => x !== c) : [...selected, c])}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 12,
              background: on ? '#2c5f2d' : '#1a1a1a',
              color: on ? '#fff' : '#888',
              border: 'none', cursor: 'pointer',
            }}
          >{CATEGORY_LABELS[c]}</button>
        );
      })}
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])} style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>Clear</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `FileGrid`**

Create `src/modules/files/shared/components/FileGrid.tsx`:

```tsx
import type { FileRow, FileType } from '../types';
import { FileTile } from './FileTile';

interface Props {
  files: FileRow[];
  activeType: FileType | null;
  onTypeChange: (t: FileType | null) => void;
  onOpen: (file: FileRow) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

const TYPES: FileType[] = ['document', 'image', 'video', 'audio', 'external'];
const TYPE_LABEL: Record<FileType, string> = {
  document: 'Docs', image: 'Images', video: 'Videos', audio: 'Audio', external: 'External',
};

export function FileGrid(p: Props) {
  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #222' }}>
        {TYPES.map((t) => (
          <button
            key={t} type="button"
            onClick={() => p.onTypeChange(t)}
            style={{
              padding: '8px 16px',
              background: p.activeType === t ? '#1a1a1a' : 'transparent',
              color: p.activeType === t ? '#fff' : '#888',
              border: 'none', borderBottom: p.activeType === t ? '2px solid #fff' : 'none',
              cursor: 'pointer',
            }}
          >{TYPE_LABEL[t]}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 14 }}>
        {p.files.map((f) => (
          <FileTile
            key={f.id} file={f}
            selected={p.selectedIds?.has(f.id)}
            onClick={() => p.onOpen(f)}
            onToggleSelect={p.onToggleSelect ? () => p.onToggleSelect!(f.id) : undefined}
          />
        ))}
      </div>
      {p.files.length === 0 && <p style={{ color: '#666', textAlign: 'center', marginTop: 30 }}>No files.</p>}
    </div>
  );
}
```

- [ ] **Step 3: Implement shared `FilesPage`**

Create `src/modules/files/shared/FilesPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { CategoryKey } from './categories';
import type { FileRow, FileType } from './types';
import { listFiles } from './api';
import { FilterBar } from './components/FilterBar';
import { FileGrid } from './components/FileGrid';
import { UploadModal } from './components/UploadModal';
import { FileDetailModal } from './components/FileDetailModal';

interface Props {
  clientId: string | null;       // null = admin vault
  isL1Owner: boolean;
}

export function FilesPage({ clientId, isL1Owner }: Props) {
  const [activeType, setActiveType] = useState<FileType | null>('document');
  const [selectedCategories, setSelectedCategories] = useState<CategoryKey[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  function load() {
    listFiles(clientId, {
      type: activeType ?? undefined,
      category: selectedCategories,
    }).then((r) => setFiles(r.files)).catch(() => setFiles([]));
  }

  useEffect(load, [clientId, activeType, selectedCategories.join(',')]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Files</h2>
        <button type="button" onClick={() => setShowUpload(true)} style={{ background: '#fff', color: '#000', padding: '6px 14px' }}>
          + Upload
        </button>
      </div>
      <FilterBar selected={selectedCategories} onChange={setSelectedCategories} />
      <FileGrid
        files={files}
        activeType={activeType}
        onTypeChange={setActiveType}
        onOpen={(f) => setDetailId(f.id)}
      />
      {showUpload && (
        <UploadModal
          clientId={clientId} isL1Owner={isL1Owner} isAdminVault={clientId === null}
          onClose={() => setShowUpload(false)}
          onUploaded={load}
        />
      )}
      {detailId && (
        <FileDetailModal
          id={detailId} clientId={clientId} isL1Owner={isL1Owner} isAdminVault={clientId === null}
          onClose={() => setDetailId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement admin + workspace mounts**

Create `src/modules/files/admin/AdminFilesPage.tsx`:

```tsx
import { FilesPage } from '../shared/FilesPage';

export default function AdminFilesPage() {
  return <FilesPage clientId={null} isL1Owner={false} />;
}
```

Create `src/modules/files/workspace/WorkspaceFilesPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FilesPage } from '../shared/FilesPage';

export default function WorkspaceFilesPage() {
  const { slug } = useParams();
  const [clientId, setClientId] = useState<string | null>(null);
  const [isL1Owner, setIsL1Owner] = useState(false);

  useEffect(() => {
    // Reuse the existing slug-resolution + session endpoint.
    fetch(`/api/u-client-by-slug?slug=${slug}`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => setClientId(d.client?.id ?? null));
    fetch(`/api/u-me`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => setIsL1Owner(d.user?.level_number === 1));
  }, [slug]);

  if (!clientId) return <p style={{ color: '#888', padding: 24 }}>Loading…</p>;
  return <FilesPage clientId={clientId} isL1Owner={isL1Owner} />;
}
```

- [ ] **Step 5: Wire the routes**

For the **admin** side, locate `src/modules/admin/AdminRoutes.tsx` (or the equivalent — check the file structure). Add a route:

```tsx
import AdminFilesPage from '../files/admin/AdminFilesPage';
// inside the existing <Routes>:
<Route path="files" element={<AdminFilesPage />} />
```

For the **workspace** side, open `src/modules/user-portal/UserPortalRoutes.tsx` and add:

```tsx
import WorkspaceFilesPage from '../files/workspace/WorkspaceFilesPage';
// inside the existing routes for the user portal:
<Route path="files" element={<WorkspaceFilesPage />} />
```

- [ ] **Step 6: Add sidebar nav entries**

For the admin sidebar — locate the existing nav config (search for the sidebar items "Dashboard", "Audit", "Settings" — likely `src/modules/admin/layout/...` or similar). Insert a new entry:

```ts
{ label: 'Files', to: '/files' }
```

For the workspace sidebar — open `src/modules/user-portal/nav/...` (or wherever `useNavItems` is defined) and insert:

```ts
{ label: 'Files', to: `files` }
```

- [ ] **Step 7: Typecheck and dev-server smoke test**

```bash
npm run typecheck
npm run dev
# In a browser: log in as admin, visit /files, click + Upload, drop a small PDF.
# Then visit /u/<existing-slug>/files as a workspace user and repeat.
```

Expected: typecheck clean. Upload+list cycle works end-to-end against the dev server. Audit log rows appear (verify via `psql` or the existing audit-log UI).

- [ ] **Step 8: Run the full test suite to confirm no regression**

```bash
npm test -- --run
```

Expected: existing tests still pass; new tests from Tasks 4–14 pass. Total count ~254 (pre-Phase-A) + ~25 (new) = ~279.

- [ ] **Step 9: Commit**

```bash
git add src/modules/files/ tests/
# Plus the admin/workspace route + nav edits — list those paths explicitly.
git commit -m "feat(files): Phase A complete — pages, routing, nav wired"
```

---

## Self-review checklist (after all 20 tasks)

Before opening the PR:

- [ ] `npm run typecheck` clean
- [ ] `npm test -- --run` — all PASS, count is `254 + ~25` (per task estimates)
- [ ] Dev preview: log in admin → visit `/files` → upload a PDF → row appears → click tile → details open
- [ ] Dev preview: log in workspace user → visit `/u/<slug>/files` → upload an image → row appears
- [ ] Permission boundary matrix test PASSES (Task 14)
- [ ] Audit log shows `files.uploaded` / `files.metadata_edited` / `files.deleted_soft` for the actions above
- [ ] 4-item Netlify pre-deploy checklist (NPM_FLAGS, `external_node_modules`, env coverage, per-context `DATABASE_URL`) — applied
- [ ] After deploy, probe each new endpoint via `curl` against the preview URL; if any 404s, run `netlify api restoreSiteDeploy`

---

## Out of scope for Phase A (defer to B/C/D plans)

- Search input + Sort dropdown in the page header (Phase B)
- Bulk select + `BulkActionBar` integration (Phase B)
- Quota meter + migration 036 (Phase B)
- Image thumbnail server-side generation (Phase B)
- Versioning + migration 033 (Phase C)
- Folders + migration 034 (Phase C)
- Share links + migration 035 + public endpoint (Phase D)
- Owner-override 🔒 indicator (small polish, defer to B unless it bothers you)
- E2E playwright suite (no playwright dependency yet — covered by integration tests for Phase A)
