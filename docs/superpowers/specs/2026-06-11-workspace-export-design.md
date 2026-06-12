# Workspace Data Export — Design

**Date:** 2026-06-11
**Module:** AMS (close-off backlog item #4)
**Status:** Drafted — awaiting user review
**Predecessor context:** `project_close_off_login_ams_2026_06.md` (Login + AMS close-off backlog)
**Sibling spec (pattern reuse):** `docs/superpowers/specs/2026-06-09-platform-exports-design.md` — same ZIP-wrap + format-dispatch convention, scoped to products

---

## 1. Goal

Let an L1 Owner (or any user granted the new `_platform.workspace.view` permission) download a single-file snapshot of their workspace — users, structure, files metadata, products metadata — in either JSON or ZIP-of-CSVs form. The export is intended for offline backup, ad-hoc audit, and external analysis. It is **not** an import format in v1; round-tripping is a future capability.

## 2. Scope

**In scope**

- New endpoint `GET /api/workspace-export?format=json|zip` (file `netlify/functions/workspace-export.ts`).
- New shared helpers:
  - `netlify/functions/_shared/workspace-export-collect.ts` — runs per-table queries, returns a typed `WorkspaceSnapshot`, enforces redactions.
  - `netlify/functions/_shared/workspace-export-format.ts` — two formatters: `toJsonResponse(snapshot)` and `toZipResponse(snapshot)`.
- New permission key `_platform.workspace.view` registered by extending `PLATFORM_SURFACES` in `src/modules/registry/types.ts` with `'workspace'`. The four standard verbs (view, create, edit, delete) are unchanged; only `_platform.workspace.view` is wired as the export gate (the other three surface/verb combinations on `workspace` exist for type-system completeness but are unused in v1). L1 Owner bypasses the matrix entirely (see `requirePermission` at `_shared/permissions.ts`); admin can grant `_platform.workspace.view` to L2+ via `/access-levels`.
- New audit op `workspace.exported` with label registered in `src/modules/ams/components/audit/op-labels.ts`.
- New FE card `src/modules/ams/components/settings/WorkspaceExportCard.tsx` (placement: existing AMS workspace settings area; exact mount file confirmed during implementation).
- Small helper `src/lib/content-disposition.ts` (parse `filename=` from response header) — only added if a comparable helper does not already exist in the codebase.
- Tests per §7.

**Out of scope**

- Audit log (`audit_log`) inclusion. Can grow unbounded; future v2 with date-range filter.
- File binaries and product image binaries. Only metadata + storage keys are included.
- Workspace re-import / round-trip. v1 is export-only.
- Filters (`?since=…`, exclude-module flags). v1 is whole-workspace.
- Async / job-queue / Blob-storage delivery. The 4 MB sync cap is fine for v1; the upgrade path to async is clean (FE keeps the same entry point).
- Self-serve export for platform admins (the `admins` table). Admins use a different surface.
- Encrypting the download. Treated as sensitive plaintext; admin/L1 is responsible for handling.

## 3. Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Audience scope | Bucket-users + platform admins (matrix-gated) | Permission key approach lets L1 Owner self-export and lets admin grant to compliance roles without code change. Mirrors `_platform.users.edit` model. |
| Format | JSON **and** ZIP-of-CSVs, both in v1 | JSON preserves nested shape for tooling; ZIP-of-CSVs is spreadsheet-friendly for non-technical owners. Both share one collector; adding the second formatter is cheap. |
| Endpoint shape | Single route, `?format=` dispatch | Mirrors `u-products-export.ts` exactly. One auth path, one audit path, one collector. |
| Sync vs async | Sync, with 4 MB cap → 413 | Reuses existing `ExportTooLargeError` machinery. A 10k-node workspace fits comfortably under the cap. Async deferred until evidence of overflow. |
| Snapshot versioning | `schema_version: 1` field | Future schema changes can bump and gate consumers. Cheap to add now, expensive to retrofit. |
| Redaction enforcement | In the **collector**, not the formatter | Format branches cannot accidentally leak. One place to audit the rule. |
| Redacted fields | `password_hash`, `temp_password_plain`, `password_reset_requested_at` | Hashes have no external use and high liability. Temp passwords are working credentials. The reset flag is harmless but redacting all three together makes the policy "no password columns, period" — easier to reason about. |
| Audit op written | Before the response is streamed | If the stream fails the audit row still exists, which is the right failure mode for compliance ("we attempted to export at time T"). |
| Cross-tenant safety | Single test, asserted explicitly | Per-client `client_id` filter is on every collector query; the test prevents regression. The highest-value test in the suite. |
| FE entry point | Single card with two download buttons | No multi-step modal, no progress bar. Sync response; click → fetch → browser saves. |

## 4. Architecture

```
GET /api/workspace-export?format=json|zip
  │
  ├─ authenticateForPermission('_platform.workspace.view')
  ├─ resolveClientIdOrRespond(session, req)
  │
  ▼
collectWorkspaceSnapshot(sql, clientId): WorkspaceSnapshot
  │ (one collector, redactions applied here)
  ▼
┌─────────────────┬─────────────────┐
│ format === json │ format === zip  │
│  toJsonResponse │  toZipResponse  │
└────────┬────────┴────────┬────────┘
         │                 │
         ▼                 ▼
   stream JSON          wrapInZip(...)  (existing helper from _shared/exporters/zip.ts)
         │                 │
         ▼                 ▼
   ──── logAudit(sql, { session, op: 'workspace.exported', clientId, detail: { format, byte_count, table_counts } }) ────
                            │
                            ▼
              200 with Content-Disposition
              413 export_too_large if over cap
```

## 5. Data model

### 5.1 `WorkspaceSnapshot` (TypeScript shape)

```ts
type WorkspaceSnapshot = {
  schema_version: 1;
  exported_at: string;          // ISO 8601 UTC
  exported_by: {
    kind: 'admin' | 'user_node';
    id: string;
    email: string;
  };
  client: ClientRow;            // one row from public.clients
  enabled_products: string[];   // e.g. ['saloon-booking', 'products']
  levels: ClientLevelRow[];
  roles: ClientRoleRow[];
  cardinality_rules: ClientCardinalityRuleRow[];
  user_nodes: UserNodeRow[];    // flattened tree; parent_id refs preserved
  credentials: CredentialRow[]; // user_node_credentials MINUS the three redacted fields
  files: {
    files: FileRow[];
    categories: FileCategoryRow[];
    allowed_nodes: FileAllowedNodeRow[];
    allowed_roles: FileAllowedRoleRow[];
    allowed_users: FileAllowedUserRow[];
  };
  products: {
    products: ProductRow[];
    categories: ProductCategoryRow[];
    images: ProductImageRow[];  // metadata only; storage_key kept, no binaries
  };
};
```

Each `*Row` type mirrors its source table columns 1:1 except for the three universally redacted credential columns.

### 5.2 Redaction rule

The collector strips these fields before the snapshot leaves the function:

- `user_node_credentials.password_hash`
- `user_node_credentials.temp_password_plain`
- `user_node_credentials.password_reset_requested_at`

Stripping happens by `SELECT`-list omission, not by post-filter. The fields are never read into JS memory inside the function. A guard test asserts `JSON.stringify(snapshot)` contains none of the three field names anywhere.

### 5.3 ZIP layout

```
workspace-<slug>-<YYYYMMDDTHHMMSSZ>.zip
├── _manifest.json
│     { schema_version, exported_at, exported_by, client_id, slug, table_counts }
├── README.txt
│     Human-readable: what each CSV is, what was redacted, schema version, contact.
├── client.csv                       # 1 row
├── enabled_products.csv             # 1 column: product_key
├── client_levels.csv
├── client_roles.csv
├── client_cardinality_rules.csv
├── user_nodes.csv                   # parent_id preserved
├── user_node_credentials.csv        # redacted columns absent
├── files/
│   ├── files.csv
│   ├── file_categories.csv
│   ├── file_allowed_nodes.csv
│   ├── file_allowed_roles.csv
│   └── file_allowed_users.csv
└── products/
    ├── products.csv
    ├── product_categories.csv
    └── product_images.csv
```

CSV stringifier rules:

- Embedded commas, quotes, newlines → standard RFC 4180 quoting.
- NULL → empty cell.
- `jsonb` columns (`user_nodes.fields`) → JSON string in cell, no pretty-printing.

### 5.4 Foreign keys

All FK columns (`parent_id`, `role_id`, `level_number`, `category_id`, `file_id`, `product_id`, `created_by_admin`) preserved as their original UUIDs / integers. The export does **not** rewrite or namespace IDs. Rows from `admins` and `audit_log` are NOT included; `created_by_admin` UUIDs are opaque references.

## 6. Endpoint contract

### 6.1 Request

```
GET /api/workspace-export?format=json|zip
Authorization: (existing JWT cookie or header)
```

Query params:
- `format` — required. `json` or `zip`. Anything else → 400 `invalid_format`.

No body, no other filters.

### 6.2 Responses

| Code | Body | Notes |
|---|---|---|
| 200 (json) | `application/json` snapshot | `Content-Disposition: attachment; filename="workspace-<slug>-<iso>.json"` |
| 200 (zip)  | `application/zip` bytes      | `Content-Disposition: attachment; filename="workspace-<slug>-<iso>.zip"` |
| 400 | `{ error: 'invalid_format' }` | Unknown `format`. |
| 401 | `{ error: 'unauthorized' }` | No session. |
| 403 | `{ error: 'forbidden' }` | Session has no `_platform.workspace.view` (and no L1 bypass). |
| 405 | `{ error: 'method_not_allowed' }` | Non-GET. |
| 413 | `{ error: 'export_too_large', size_bytes, limit_bytes }` | Snapshot exceeds the 4 MB cap. |
| 500 | (generic) | DB or formatter failure. |

Filename ISO format: `YYYYMMDDTHHMMSSZ` (filesystem-safe; no colons or hyphens in the time portion).

### 6.3 Audit row

Written via the existing `logAudit(sql, args)` helper (`_shared/audit.ts`) to `public.audit_log` immediately before the response stream. The call shape:

```ts
await logAudit(sql, {
  session,
  op: 'workspace.exported',
  clientId,
  targetType: 'workspace',
  targetId: clientId,
  detail: {
    format: 'json' | 'zip',
    byte_count: <number>,
    table_counts: {
      user_nodes: N,
      credentials: N,
      levels: N,
      roles: N,
      cardinality_rules: N,
      files: N,
      file_categories: N,
      products: N,
      product_categories: N,
      product_images: N,
    },
  },
});
```

`logAudit` derives `actor_admin` / `actor_user_node` from `session.kind`; INSERT failures are caught and stderr-logged (do not roll back the export). Op label registered in `src/modules/ams/components/audit/op-labels.ts`.

### 6.4 Permission key registration

- Add `'workspace'` to the `PLATFORM_SURFACES` constant in `src/modules/registry/types.ts`. The four standard verbs (view, create, edit, delete) apply automatically by virtue of the `_platform.${PlatformSurface}.${Verb}` template type. The matrix UI enumerates the new key into a "Workspace" row.
- Server side: `_shared/permission-keys.ts` already enumerates from the constants. No code change there.
- `defaultPermissionsForLevel(1, ...)` returns all platform keys, so L1 Owner gets it on workspace create with no migration backfill needed for existing L1 owners (the matrix is computed live).
- `/access-levels` matrix UI renders the new row automatically.

## 7. Testing strategy

### 7.1 Unit tests — `tests/unit/workspace-export.test.ts`

~15 tests covering the pure pieces, no DB or HTTP.

- **Collector redactions** — fixture credential row with all three sensitive fields populated; returned row omits each; one guard test asserts none of the three field names appear anywhere in `JSON.stringify(snapshot)`.
- **Collector shape** — fixture with 3 levels, 5 roles, 12 user_nodes, 4 files, 2 products. Asserts `schema_version === 1`, `client.id` matches, each section's array length, FK preservation.
- **JSON formatter** — pretty-prints; parsing the output reproduces the snapshot; no `undefined` leakage.
- **CSV stringifier** — per-table round-trip. Edge cases: embedded commas, quotes, newlines, NULL → empty, jsonb → JSON-string-in-cell.
- **ZIP layout** — generated ZIP contains exactly the expected file list (manifest + README + per-table CSVs); `_manifest.json` lists correct `table_counts`.
- **Filename generator** — ISO timestamp matches `YYYYMMDDTHHMMSSZ`; slug is filesystem-safe.

### 7.2 Integration tests — `tests/integration/workspace-export.test.ts`

~12 tests over the real handler against the test DB.

- **Method gate** — POST → 405.
- **Format gate** — missing `format`, `format=foo` → 400.
- **Auth** — no JWT → 401; valid JWT without perm → 403.
- **Permission boundary matrix** — L1 Owner without explicit key → 200 (bypass); L2 with key granted → 200; L2 without key → 403; platform admin → 200.
- **JSON 200** — Content-Type, Content-Disposition filename matches pattern, body parses, redacted fields absent.
- **ZIP 200** — Content-Type `application/zip`, body is a valid ZIP (read with `adm-zip` or repo equivalent), file list matches.
- **Audit row written** — exactly one new `audit_log` row with `op='workspace.exported'`, correct `client_id`, correct actor kind (`actor_admin` vs `actor_user_node`), `detail.format` matches, `detail.byte_count > 0`, `detail.table_counts` populated.
- **Cross-tenant safety (highest-value test)** — seed two clients; export as client A's L1 Owner; assert client B's `user_nodes` IDs do not appear anywhere in the response body.
- **413 over-cap** — mock the snapshot or cap to force overflow; assert 413 with `{ size_bytes, limit_bytes }`.

### 7.3 FE tests — `tests/unit/WorkspaceExportCard.test.tsx`

~4 tests, lightweight.

- Renders when `permissions['_platform.workspace.view']` is true; returns null when false.
- L1 bypass: `level_number === 1` shows the card without the explicit key.
- Click "Download JSON" → calls `fetch('/api/workspace-export?format=json')` exactly once.
- "Last exported" line reads from the mocked audit fetch and shows relative time + email; hides when no audit rows exist.

### 7.4 Explicitly not tested in v1

- 4 MB cap behavior on a real workspace (mocked path is the proxy).
- Multi-megabyte ZIP integrity end-to-end (`adm-zip` round-trip on a small fixture is the proxy).
- Streaming chunked transfer — we return one Response, not chunked.
- Audit-row visibility in the Admin Audit UI — op-label registration is compile-checked and trivially correct.

## 8. Smoke checklist (pre-handoff)

1. `npm run typecheck` clean.
2. `npm run test` — unit + integration green.
3. Local `netlify dev` — log in as L1 Owner:
   - Click "Download JSON". Open in an editor: valid, no `password_hash` string anywhere.
   - Click "Download ZIP". Open: `_manifest.json` + `README.txt` + CSVs present. `user_nodes.csv` opens in a spreadsheet.
4. Audit UI shows a new `workspace.exported` row.
5. Log in as a workspace user without the permission → card not visible. Manual `GET /api/workspace-export?format=json` → 403.

## 9. Implementation file inventory

**New files**
- `db/migrations/` — none. (Permission is data-driven from constants; no schema change.)
- `netlify/functions/workspace-export.ts`
- `netlify/functions/_shared/workspace-export-collect.ts`
- `netlify/functions/_shared/workspace-export-format.ts`
- `src/modules/ams/components/settings/WorkspaceExportCard.tsx`
- `src/lib/content-disposition.ts` (only if not already present)
- `tests/unit/workspace-export.test.ts`
- `tests/integration/workspace-export.test.ts`
- `tests/unit/WorkspaceExportCard.test.tsx`

**Modified files**
- `src/modules/registry/types.ts` — add `'workspace'` to the `PLATFORM_SURFACES` tuple.
- `src/modules/ams/components/audit/op-labels.ts` — register `workspace.exported` label.
- The AMS settings page file (exact path verified during implementation) — mount `<WorkspaceExportCard />`.
- `src/lib/components.css` — add `.ams-export-card` namespaced styles.

**Files NOT modified**
- `_shared/permission-keys.ts` — enumerates from constants.
- `_shared/exporters/zip.ts` — used as-is.
- Any access-levels matrix UI code — renders new key automatically.

## 10. Operational notes

- **`WORKSPACE_EXPORT_MAX_BYTES`** — optional env var override for the 4 MB wire-byte cap. Useful for emergencies (temporarily raising the cap for a large export without a code deploy) and for testing (set to `'1'` to force a 413 from any real snapshot). When absent or `'0'`, the default 4 194 304-byte cap applies. The value is re-read on each call, so changing it in the environment takes effect immediately without a restart.
- No other env vars. No external dependencies. No new npm packages (`adm-zip` already in the repo per the products export).
- Net deploy risk: low. Single new endpoint, no schema change, no existing endpoint behavior change.
- Rollback: delete the endpoint file, remove the permission key. No data to clean up beyond the audit rows (which are valid history).
