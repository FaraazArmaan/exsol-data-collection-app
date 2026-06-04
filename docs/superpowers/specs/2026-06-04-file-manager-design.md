# File Manager — Design

**Date:** 2026-06-04
**Branch (planned):** `feat/file-manager` (worktree at `../ExSol-file-manager`)
**Migrations reserved:** `030`–`036`
**Coordinates with:** `feat/audit-log-polish` (in flight, separate chat) — migrations `026`–`029`

---

## 1. Overview

A two-surface file-management module: an ExSol-admin vault and a per-workspace files area, sharing one storage backend (Netlify Blobs + Neon metadata). Files are organised by **type** (Document / Image / Video / Audio / External) and labeled with one or more of 11 fixed **business categories**. Each file carries a **security tier** (Public / Role-based / Restricted / Confidential) that drives per-file visibility against the existing AMS user-node tree.

The module adds one new platform surface (`files`) to the permission registry. Internal workspace users get full CRUD subject to permissions and Owner-capped tier-elevation. Bucket users (external customers/employees) get read-only access filtered by tier.

V1 ships **all eight optional add-ons** (search, sort, bulk, image thumbnails, versioning, folders, quota, share links) split across four sequential PRs.

---

## 2. Decision log (from brainstorming)

| # | Decision | Chosen | Notes |
|---|---|---|---|
| Q1 | Scope | **Both surfaces** | Admin vault (`client_id IS NULL`) + per-workspace (`client_id = X`), same schema |
| Q2 | Permission model | **Registry-gated** (`_platform.files.{view,create,edit,delete}`) | Tier-cap to Restricted/Confidential is hardcoded to L1 Owner — no new permission key |
| Q3 | "External" tab | **Auto-detected URL OR uploaded unsupported file** | One row shape; `storage_kind` discriminates |
| Q4 | Categories per file | **Multi, capped at 3** | Join table; OR-semantics filter |
| Q5 | Tier audience mechanics | **Flexible (multi-pick)** | Three join tables: `file_allowed_roles`, `file_allowed_nodes`, `file_allowed_users` |
| Q6 | MVP scope | **All 8 add-ons** | Phased across 4 PRs |
| Q7 | Bucket users | **Read-only** | Same tier-visibility filter, hard-block on write paths |

---

## 3. Architecture

### Module placement

```
src/modules/files/
  admin/
    AdminFilesPage.tsx
    components/
  workspace/
    WorkspaceFilesPage.tsx
    components/
  shared/
    FileGrid.tsx
    FileTile.tsx
    FolderTile.tsx
    FilterBar.tsx
    UploadModal.tsx
    FileDetailModal.tsx
    TierPicker.tsx
    BulkActionBar.tsx
    VersionHistoryModal.tsx
    ShareLinkModal.tsx
    CategoryChip.tsx
    TierBadge.tsx
    QuotaMeter.tsx
    NodePicker.tsx
    UserPicker.tsx
    RolePicker.tsx
    types.ts
    api.ts
    categories.ts            // source-of-truth enum for 11 categories
```

### Registry change

One line in `src/modules/registry/types.ts`:

```ts
export const PLATFORM_SURFACES = ['users', 'structure', 'settings', 'files'] as const;
```

Four implicit permission keys emerge: `_platform.files.view`, `.create`, `.edit`, `.delete`. The existing access-level dashboard auto-renders a "Files" row from this constant — no UI work needed there.

### Shared helpers (new in `netlify/functions/_shared/`)

| File | Responsibility |
|---|---|
| `files-access.ts` | Builds the tier-visibility WHERE clause; `assertCanWrite(session)` guard; `isL1Owner(session)` predicate; `ancestorsOf(sql, userNodeId)` helper |
| `files-storage.ts` | Blobs read/write/signed-URL helpers; thumbnail key derivation |
| `files-mime.ts` | MIME → `file_type` auto-classifier |

### Netlify Blobs stores

- `files` — uploaded file bytes
- `files-thumbnails` — server-generated 256×256 image thumbnails

---

## 4. Data model

Seven migrations, numbered `030`–`036`.

### 4.1 Migration 030 — `files` table

```sql
CREATE TYPE file_type         AS ENUM ('document', 'image', 'video', 'audio', 'external');
CREATE TYPE file_storage_kind AS ENUM ('blob', 'url');
CREATE TYPE file_tier         AS ENUM ('public', 'role', 'restricted', 'confidential');

CREATE TABLE public.files (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid REFERENCES public.clients(id) ON DELETE CASCADE,  -- NULL = admin vault
  type                  file_type NOT NULL,
  storage_kind          file_storage_kind NOT NULL,
  blob_key              text,
  external_url          text,
  external_provider     text,                              -- 'youtube'|'vimeo'|'google-drive'|'dropbox'|'onedrive'|NULL
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

CREATE INDEX files_client_type_idx    ON public.files (client_id, type)            WHERE deleted_at IS NULL;
CREATE INDEX files_client_created_idx ON public.files (client_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX files_tier_idx           ON public.files (tier)                       WHERE deleted_at IS NULL;
```

`folder_id` column is added in migration `034`.

### 4.2 Migration 031 — `file_categories` join

```sql
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

The CHECK keeps the DB in lockstep with the TS `categories.ts` enum. Adding a category = code change + one-line migration.

Cap of 3 categories per file is enforced in the handler layer (cheaper than a CHECK with subquery).

### 4.3 Migration 032 — audience tables

```sql
CREATE TABLE public.file_allowed_roles (
  file_id uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.client_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, role_id)
);

CREATE TABLE public.file_allowed_nodes (
  file_id uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, node_id)
);

CREATE TABLE public.file_allowed_users (
  file_id      uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  user_node_id uuid NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, user_node_id)
);
```

Used only when `files.tier` matches: `role` reads `file_allowed_roles`, `restricted` reads `file_allowed_nodes`, `confidential` reads `file_allowed_users`. Rows for other tiers are ignored (or absent — application enforces).

### 4.4 Migration 033 — `file_versions`

```sql
CREATE TABLE public.file_versions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id               uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  version_no            int NOT NULL,
  blob_key              text NOT NULL,
  byte_size             bigint NOT NULL,
  mime                  text,
  filename              text,
  uploaded_by_user_node uuid REFERENCES public.user_nodes(id),
  uploaded_by_admin     uuid REFERENCES public.admins(id),
  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (file_id, version_no)
);
```

Versioning applies only to `storage_kind='blob'` files. URL externals don't version meaningfully; handler returns 400 on a version request for a URL row.

On revert: insert a new `file_versions` row with the current `files.blob_key`, then swap `files.blob_key` to the target version's `blob_key`. Old versions are never deleted by revert — only by hard-delete of the parent file.

### 4.5 Migration 034 — `file_folders`

```sql
CREATE TABLE public.file_folders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid REFERENCES public.clients(id) ON DELETE CASCADE,  -- NULL = admin vault
  parent_id             uuid REFERENCES public.file_folders(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  created_by_user_node  uuid REFERENCES public.user_nodes(id),
  created_by_admin      uuid REFERENCES public.admins(id),
  created_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (client_id, parent_id, name)
);

ALTER TABLE public.files
  ADD COLUMN folder_id uuid REFERENCES public.file_folders(id) ON DELETE SET NULL;
CREATE INDEX files_folder_idx ON public.files (folder_id) WHERE deleted_at IS NULL;
```

Folders are pure organisation — they do NOT carry tier. Each file's own tier is authoritative regardless of folder. Deleting a folder is allowed only when empty (handler check); ON DELETE CASCADE in the FK is a safety net.

### 4.6 Migration 035 — `file_share_tokens`

```sql
CREATE TABLE public.file_share_tokens (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id               uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  token                 text NOT NULL UNIQUE,         -- 32-byte URL-safe random
  created_by_user_node  uuid REFERENCES public.user_nodes(id),
  created_by_admin      uuid REFERENCES public.admins(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  revoked_at            timestamptz,

  CHECK (expires_at > created_at)
);

CREATE INDEX file_share_tokens_token_idx ON public.file_share_tokens (token) WHERE revoked_at IS NULL;
CREATE INDEX file_share_tokens_file_idx  ON public.file_share_tokens (file_id);
```

Application rule (not DB-enforced): `files.tier='confidential'` cannot have an active share token. Handler refuses creation; existing-token check returns 404 when the file is tier-changed to Confidential.

### 4.7 Migration 036 — `workspace_storage_quota`

```sql
CREATE TABLE public.workspace_storage_quota (
  client_id          uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  byte_limit         bigint NOT NULL DEFAULT 5368709120,  -- 5 GB
  bytes_used_cached  bigint NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

Authoritative usage is recomputed on every upload commit:
```sql
SELECT COALESCE(SUM(byte_size), 0) FROM files WHERE client_id = $1 AND deleted_at IS NULL;
```
The cached column is for the header meter only.

### 4.8 Tier-visibility WHERE clause

Single function in `_shared/files-access.ts`, used by every list/read endpoint:

```sql
files.deleted_at IS NULL AND (
  files.tier = 'public'
  OR (files.tier = 'role' AND EXISTS (
        SELECT 1 FROM file_allowed_roles fr
        WHERE fr.file_id = files.id AND fr.role_id = $role_id))
  OR (files.tier = 'restricted' AND EXISTS (
        WITH RECURSIVE ancestors AS (
          SELECT id, parent_id FROM user_nodes WHERE id = $user_node_id
          UNION ALL
          SELECT n.id, n.parent_id FROM user_nodes n
          JOIN ancestors a ON n.id = a.parent_id
        )
        SELECT 1 FROM file_allowed_nodes fn
        WHERE fn.file_id = files.id AND fn.node_id IN (SELECT id FROM ancestors)))
  OR (files.tier = 'confidential' AND EXISTS (
        SELECT 1 FROM file_allowed_users fu
        WHERE fu.file_id = files.id AND fu.user_node_id = $user_node_id))
)
```

L1 Owner skips the entire parenthesised clause. Walks ancestors **upward** from the user node — bounded by tree depth, cheaper than walking subtrees downward from N allowed-nodes.

---

## 5. API surface

### 5.1 Endpoints

| Method | Path | Function file |
|---|---|---|
| GET | `/api/files` | `files.ts` |
| POST | `/api/files` | `files.ts` (commit step) |
| GET | `/api/files-detail/:id` | `files-detail.ts` |
| PATCH | `/api/files-detail/:id` | `files-detail.ts` |
| DELETE | `/api/files-detail/:id` | `files-detail.ts` |
| POST | `/api/files-upload-url` | `files-upload-url.ts` |
| POST | `/api/files-download-url` | `files-download-url.ts` |
| GET | `/api/files-thumbnail/:id` | `files-thumbnail.ts` |
| POST | `/api/files-bulk` | `files-bulk.ts` |
| GET | `/api/files-versions` | `files-versions.ts` |
| POST | `/api/files-versions` | `files-versions.ts` |
| GET | `/api/files-folders` | `files-folders.ts` |
| POST | `/api/files-folders` | `files-folders.ts` |
| PATCH | `/api/files-folders-detail/:id` | `files-folders-detail.ts` |
| DELETE | `/api/files-folders-detail/:id` | `files-folders-detail.ts` |
| POST | `/api/files-share-link` | `files-share-link.ts` |
| DELETE | `/api/files-share-link-detail/:id` | `files-share-link-detail.ts` |
| GET | `/api/files-share-public/:token` | `files-share-public.ts` |
| GET | `/api/files-quota` | `files-quota.ts` |
| PATCH | `/api/files-quota` | `files-quota.ts` |

Per `feedback_netlify_routing.md`, list endpoints and `:id` endpoints live in separate function files to avoid path collisions.

### 5.2 `GET /api/files` query parameters

```
client_id     uuid    required for workspace; absent for admin vault
type          string  document|image|video|audio|external
category      string  repeatable: ?category=hr_payroll&category=finance_accounting (OR)
tier          string  filter by tier (debug / admin)
search        string  ILIKE on title + description
sort          string  newest(default)|oldest|name|size
folder_id     uuid    NULL → root
include_trash bool    default false
cursor        string  opaque pagination cursor
limit         int     default 50, max 200
```

### 5.3 Auth matrix

| Endpoint | Admin | Internal | Bucket | Anon |
|---|---|---|---|---|
| `GET /api/files` | ✓ vault-only | ✓ tier-filtered | ✓ tier-filtered, read | ✗ |
| `POST /api/files*` write | ✓ vault-only | ✓ needs `files.create` | ✗ | ✗ |
| `PATCH /api/files-detail` | ✓ vault-only | ✓ needs `files.edit` | ✗ | ✗ |
| `DELETE /api/files-detail` | ✓ vault-only | ✓ needs `files.delete` | ✗ | ✗ |
| `GET /api/files-thumbnail/:id` | ✓ vault-only | ✓ tier-checked | ✓ tier-checked | ✗ |
| `POST /api/files-share-link` | ✗ | ✓ needs `files.edit` | ✗ | ✗ |
| `GET /api/files-share-public/:token` | ✗ | ✗ | ✗ | ✓ token-gated |
| `PATCH /api/files-quota` | ✓ only | ✗ | ✗ | ✗ |

### 5.4 Rate-limits (extends `_shared/rate-limit.ts`)

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/files-upload-url` | 30 | per session, per minute |
| `POST /api/files-share-link` | 20 | per session, per minute |
| `GET /api/files-share-public/:token` | 60 / 600 | per IP per min / per token per hour |

### 5.5 Upload flow (2-step)

```
Browser                       Server                        Blobs
  │                              │                            │
  │── POST /files-upload-url ───▶│ reserve key, sign PUT URL ─▶│
  │◀── {upload_url, blob_key} ──│                            │
  │                                                            │
  │── PUT bytes ──────────────────────────────────────────────▶│
  │◀── 200 ───────────────────────────────────────────────────│
  │                                                            │
  │── POST /api/files (commit)─▶│ verify blob, INSERT row     │
  │◀── {id, ...} ──────────────│ enqueue thumbnail            │
  │                              │ logAudit('files.uploaded') │
```

For URL externals: skip steps 1–2, single `POST /api/files` with `{external_url, title, type:'external'}`.

Orphan blobs (uploaded but never committed) are reaped by a daily GC cron (existing image-pipeline pattern).

---

## 6. UI surface

### 6.1 Routes

- `/files` — admin vault (admin session required)
- `/u/:slug/files` — per-workspace (matches user-portal slug pattern)

Same `FilesPage` component, two route mounts. Differs only in the `client_id` passed (null for admin, slug-resolved UUID for workspace).

### 6.2 Page layout

```
┌─ Files ──────────────────────────────  Search [____________]  Sort [Newest ▾] ─┐
│                                                                                 │
│  📦 12.3 GB / 5.0 GB used  ▓▓▓▓▓░░░░░       (workspace only; admin omits)       │
│                                                                                 │
│  Home › Marketing › Q3 Launch                                  + Upload         │
│                                                                                 │
│  ┌─ Docs ─┬─ Images ─┬─ Videos ─┬─ Audio ─┬─ External ─┐                       │
│  └────────┴──────────┴──────────┴─────────┴────────────┘                       │
│                                                                                 │
│  Categories: [Finance ×] [HR ×] [+ Add filter]    Clear filters                 │
│                                                                                 │
│  📁 Subfolder A    📁 Subfolder B                                               │
│                                                                                 │
│  [📄 PDF] [📄 PDF] [📄 PDF] [📄 PDF] [📄 DOC] [📄 DOC]                          │
│  [📊 CSV] [📊 XLSX] [📄 PDF]                                                    │
│                                                                                 │
│  ── 9 of 47 — Load more ──                                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

A `BulkActionBar` slides up from the bottom when ≥1 tile is selected (reuses pattern from `feat/bulk-operations`).

### 6.3 Modal inventory

| Modal | Trigger | Key fields |
|---|---|---|
| `UploadModal` | `+ Upload` or drag-drop | File picker / URL input → title, description, type (auto-detected, override), categories (chips, max 3), folder, `TierPicker` |
| `FileDetailModal` | Click tile | Left: preview pane. Right: edit form + Version-history + Share-link + Download buttons |
| `TierPicker` (embedded) | Inside Upload + Detail | Stepper: pick tier → conditional audience picker reveals below |
| `VersionHistoryModal` | "Version history" in detail | List of versions, ⟲ Revert button |
| `ShareLinkModal` | "Share link" in detail | Generate/copy URL, show expiry (24h default), Revoke |
| `FolderCreateModal` | `+ Folder` inline | Name only |
| Trash view | Header toggle | Same grid with soft-deleted files; Restore + Delete-permanently actions |

### 6.4 TierPicker UX

Stepper: pick tier first → audience picker reveals.

- **Public** — no audience input
- **Role-based** — `RolePicker` multi-select chips
- **Restricted** — `NodePicker` (tree, multi-select roots)
- **Confidential** — `UserPicker` searchable multi-select

Restricted and Confidential are disabled with tooltip "Only Owner can mark Restricted/Confidential" when the current user is not L1. A small ⚠ banner appears when Confidential is selected.

L1 Owner sees a 🔒 indicator on Confidential files they're viewing via override, so they know the file isn't normally visible to them.

### 6.5 Reusable components

`FileTile` (variants per type), `FolderTile`, `CategoryChip` (11 fixed colors), `TierBadge`, `QuotaMeter`, `NodePicker`, `UserPicker`, `RolePicker`.

`NodePicker` reuses the AMS hierarchical-tree component from the 2026-06-03 work if cleanly extractable; else a fresh slimmer picker.

### 6.6 UX decisions

1. Drag-drop AND `+ Upload` button — drop a file anywhere on the page opens the modal pre-filled.
2. Breadcrumb folder nav (click any segment to jump up; URL encodes folder path).
3. Stepper TierPicker (reveal audience after tier choice).
4. Confidential warning banner (informational, no acknowledgement required).
5. Soft-delete → Trash view with 30-day auto-purge cron.
6. Owner-override 🔒 indicator on confidential files.

---

## 7. Permission enforcement

### 7.1 Three-layer model

Every endpoint runs:

```
① Session resolution    (_shared/auth.ts)
   → AdminSession | WorkspaceSession{internal} | WorkspaceSession{bucket}

② Coarse capability     requirePermission(session, '_platform.files.<verb>')
   • Admin: allowed for vault paths
   • Bucket on write: HARD 403 via assertCanWrite(session)
   • Internal: client_levels.permissions JSONB check

③ Tier-cap (write paths) If body sets tier ∈ {restricted, confidential},
                          require isL1Owner(session) else 403

④ Per-file ACL          Compose tier-visibility WHERE via _shared/files-access.ts
                          L1 Owner: skip clause
                          Others: clause from §4.8

⑤ Execute, return
```

### 7.2 Bucket-user enforcement

```ts
// _shared/files-access.ts
export function assertCanWrite(session: AnySession): void {
  if (session.kind === 'admin') return;
  if (session.kind === 'workspace' && session.role.bucket_family === null) return;
  throw new HttpError(403, 'files.read_only_for_bucket_users');
}
```

Called at the top of every POST/PATCH/DELETE handler.

### 7.3 L1 Owner predicate

```ts
export function isL1Owner(session: WorkspaceSession): boolean {
  return session.user_node.level === 1;
}
```

Used in two places: tier-visibility skip + tier-cap allowance.

### 7.4 Boundary rules (not in code but enforced)

- Confidential files cannot have an active share token (creation refuses; existing tokens are revoked-on-tier-change).
- Admin sessions cannot view or write workspace files; workspace sessions cannot view or write admin-vault files. Enforced by `client_id` comparison in `_shared/files-access.ts`.
- **Admin-vault files are single-tier.** Any row with `client_id IS NULL` must have `tier='public'` and no audience-table rows. The tier picker is hidden in the admin UI; the commit handler rejects non-`public` tiers when `client_id` is null. Rationale: there is no admin tree, no admin roles, and no `user_nodes`-equivalent for admins — the audience tables are workspace-only by definition.

---

## 8. Audit instrumentation

`target_type='file'` on all file events, `target_id=<file_uuid>`.

### Write events
- `files.uploaded` `{file_id, type, byte_size, tier, categories[]}`
- `files.metadata_edited` `{file_id, diff: {title?, description?, categories?}}`
- `files.tier_changed` `{file_id, old_tier, new_tier, audience_diff}` (security-sensitive — own op)
- `files.folder_moved` `{file_id, from_folder_id, to_folder_id}`
- `files.deleted_soft` `{file_id}`
- `files.restored` `{file_id}`
- `files.deleted_hard` `{file_id, byte_size}` (irrecoverable — own op)
- `files.version_added` `{file_id, version_no, byte_size}`
- `files.version_reverted` `{file_id, reverted_to_version_no}`
- `files.folder_created` `{folder_id, parent_id, name}`
- `files.folder_renamed` `{folder_id, old_name, new_name}`
- `files.folder_deleted` `{folder_id, name}`
- `files.bulk_action` `{action, file_ids[], result_counts}`

### Share-link events
- `files.share_link_created` `{file_id, token_id, expires_at}`
- `files.share_link_revoked` `{token_id}`
- `files.shared_url_accessed` `{token_id, file_id, ip}` — only audit on a public, session-less path

### Quota event
- `files.quota_changed` `{client_id, old_limit, new_limit}` (admin-only)

### Not logged (intentional)
- `files.viewed` / list reads — high frequency, low signal
- `files.thumbnail_*` — high frequency
- `files.downloaded` — deferred; schema supports adding later

### Coordination with `feat/audit-log-polish`
- This design assumes `audit_log.op` stays `text`. If polish enums it, our `files.*` ops are added to the enum in the same migration.
- The final task of phase A adds human labels / summaries for each `files.*` op (consistent with the polish branch's approach).

---

## 9. Phasing

Four PRs landing sequentially into `main` from `feat/file-manager`.

### Phase A — Foundation (PR 1 + PR 2)
- Migrations: 030, 031, 032
- Registry: add `'files'` to `PLATFORM_SURFACES`
- Backend: `files.ts`, `files-detail.ts`, `files-upload-url.ts`, `files-download-url.ts`, `files-thumbnail.ts`; `_shared/files-access.ts`, `files-storage.ts`, `files-mime.ts`
- Frontend: admin + workspace pages, tabs, `FileGrid`, `FileTile`, `UploadModal`, `FileDetailModal`, `TierPicker`, `CategoryChip`, `TierBadge`, `NodePicker`, `UserPicker`, `RolePicker`
- Audit: `files.uploaded`, `.metadata_edited`, `.tier_changed`, `.deleted_soft`, `.restored`, `.deleted_hard`
- ~25 tests

### Phase B — Polish (PR 3)
- Migrations: 036 (`workspace_storage_quota`)
- Backend: `files-bulk.ts`, `files-quota.ts`, thumbnail lazy-gen
- Frontend: Search input, Sort dropdown, `BulkActionBar`, `QuotaMeter`
- Audit: `files.bulk_action`, `.quota_changed`
- ~10 tests

### Phase C — Heavyweights (PR 4)
- Migrations: 033 (`file_versions`), 034 (`file_folders` + `files.folder_id`)
- Backend: `files-versions.ts`, `files-folders.ts`, `files-folders-detail.ts`
- Frontend: `FolderTile`, breadcrumbs, `FolderCreateModal`, `VersionHistoryModal`, drag-to-folder
- Audit: `files.version_added`, `.version_reverted`, `.folder_*`, `.folder_moved`
- ~15 tests

### Phase D — Share links (PR 5)
- Migration: 035 (`file_share_tokens`)
- Backend: `files-share-link.ts`, `files-share-link-detail.ts`, `files-share-public.ts`; rate-limit additions
- Frontend: `ShareLinkModal`, 🔗 tile indicator
- Audit: `files.share_link_created`, `.share_link_revoked`, `.shared_url_accessed`
- ~12 tests

Total: ~62 new tests (`254 → ~316`).

---

## 10. Test strategy

| Layer | Tool | Targets |
|---|---|---|
| Unit | vitest | `files-access.ts` clause composition (4 tiers × Owner-override × bucket-user-readonly = 8 branches each); `files-mime.ts` classification; token entropy |
| Integration | vitest + Neon test branch | Every endpoint × every session kind × every tier. Upload→commit happy path + orphan detection. Migration up/down idempotency |
| Permission boundary | vitest | Matrix test: for each endpoint, wrong session kind returns 403 (not 404, not 500). Catches "info disclosure via error code" bugs |
| E2E | playwright | Five golden paths: (1) Owner-uploads-Confidential → other user can't see, (2) Public file → bucket user reads but cannot edit, (3) Versioning round-trip, (4) Share link works then expires, (5) Quota rejects upload at limit |

---

## 11. Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | Migration 030 number collision with `feat/audit-log-polish` | Low | Range reserved (this chat: 030–039; polish: 026–029) |
| R2 | `audit_log.op` column shape changed by polish branch | Low | This design assumes `op` stays `text`; coordinate before merge |
| R3 | L1 Owner override misconfigured → access leak | Medium | Dedicated test: non-Owner with all 4 `files.*` perms cannot see a Confidential file they're not in the user list for |
| R4 | Blob upload-without-commit orphans | Medium | Daily GC cron (mirrors image-pipeline pattern) |
| R5 | Share-link token guess | Low | 32-byte URL-safe random + per-token rate-limit + 24h default expiry |
| R6 | Storage quota race | Low | Recompute on each upload commit; cached column is for header display only |
| R7 | Netlify Functions edge-registration miss | Medium | Probe each new endpoint post-deploy; `restoreSiteDeploy` if needed (per `feedback_netlify_new_function_404.md`) |
| R8 | Per-context `DATABASE_URL` mismatch | Medium | 4-item Netlify deploy checklist before promoting each phase (per `feedback_netlify_deploy_checklist.md`) |
| R9 | Confidential file public-share leak | Low | Hard rule in share-link create handler + revocation on tier-change to Confidential |
| R10 | Folder inheritance ambiguity (does folder carry tier?) | N/A | Resolved: folders are pure organisation; tier is per-file |

---

## 12. Worktree setup

```bash
git fetch origin
git worktree add ../ExSol-file-manager -b feat/file-manager origin/main
cd ../ExSol-file-manager
npm install
netlify dev --port 8889
```

Sibling checkout branched from clean `main`. In-flight `feat/onboarding-import` work in the current directory stays untouched.

---

## 13. Pre-merge checklist (per phase)

1. `npm run typecheck` clean
2. `npm test` — all new + no regression
3. Migrations run cleanly on a fresh Neon test branch
4. Dev preview tested for golden path
5. Audit log entries verified for each instrumented op
6. Netlify deploy 4-item check (NPM_FLAGS, `external_node_modules`, env coverage, per-context `DATABASE_URL`)
7. Probe each new endpoint post-deploy + `restoreSiteDeploy` if needed

---

## 14. Open follow-ups (intentionally deferred)

- `files.downloaded` audit instrumentation — schema supports it; defer unless compliance asks
- Folder-level permission inheritance — explicit non-goal for v1; design supports adding via a `folder_tier_inherit` column later
- Image variants beyond thumbnails (webp, AVIF) — defer to a phase-E if user demand emerges
- External-link health check (dead-link detection) — defer
- File search across full text of indexed PDFs/docs — defer; v1 search is title+description only
