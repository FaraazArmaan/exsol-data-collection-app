# Admin Audit Log — Design

**Date:** 2026-06-04
**Status:** Approved — implementation plan to follow
**Predecessors:** [2026-05-26-ams-module-design.md](./2026-05-26-ams-module-design.md), [2026-06-03-manage-team-design.md](./2026-06-03-manage-team-design.md), [2026-06-03-onboarding-wizard-design.md](./2026-06-03-onboarding-wizard-design.md)

## 1. Problem

The `schema_ops_log` table has existed since migration 004 but is empty: zero rows, zero `INSERT` calls anywhere in `netlify/`. Its column shape (`schema_name NOT NULL`, `template_key`, `from_version`, `to_version`) is from the pre-AMS-v3 per-client-schema design that was demolished in migrations 010/011. Today there's no surface to answer "who did what, when, against which client" — neither for security investigation nor for ops triage. Manage Team just shipped permissions for bucket-users to mutate user rows, widening the actor set; without an audit log, attribution for any subtle break is reduced to scraping Netlify function logs (ephemeral, not queryable).

## 2. Goal (v1)

Ship a **populated** audit log with:

1. A repurposed `audit_log` table (renamed from `schema_ops_log`) with current-semantics columns.
2. An `logAudit` helper called from every mutating admin/bucket-user endpoint (~20 call sites) plus sensitive reads (temp-password peeks).
3. A `GET /api/audit-log` endpoint with filter + paginate query params, admin-only auth.
4. Two UI surfaces: a top-level `/audit` page in the admin sidebar, and a per-client view at `/clients/:id/audit` reached from an "Audit" header link in AccessDashboard. Both consume the same table component, with the per-client variant pre-filtered.

The shape supports forensics ("show me everything Admin X did last week") and per-client ops ("what happened in Joe's Hardware workspace yesterday").

## 3. Non-goals

- **Login event auditing**. The `login_attempts` table already captures auth attempts. A future iteration can union it into the audit UI; v1 leaves it separate.
- **Diff capture on PATCH** ("before" snapshot). The `detail` jsonb captures the request body / "after" state only. PATCH diff requires a `SELECT FOR UPDATE` pattern that's deferred.
- **Export to CSV / JSON**.
- **Real-time tailing or push updates** (poll/refresh only).
- **Retention or cleanup policy** (table grows unbounded; revisit when it actually matters).
- **Meta-audit** (auditing reads of the audit log itself).
- **Per-endpoint payload schemas** — `detail` stays freeform `jsonb`.
- **A user-facing audit view for bucket-users (Owners)** — admin-only for v1.
- **Email/Slack alerts on suspicious patterns** — future.

## 4. Architecture

### 4.1 Migration 025

```sql
-- Migration 025: schema_ops_log → audit_log with modern columns.
-- Table is empty (zero rows verified pre-migration) + zero code references
-- the old name, so the rename is a free clarity win.

ALTER TABLE public.schema_ops_log RENAME TO audit_log;

-- Drop dead per-client-schema-era columns.
ALTER TABLE public.audit_log DROP COLUMN schema_name;
ALTER TABLE public.audit_log DROP COLUMN template_key;
ALTER TABLE public.audit_log DROP COLUMN from_version;
ALTER TABLE public.audit_log DROP COLUMN to_version;

-- Add current-semantics columns. actor_user_node captures bucket-user-
-- initiated audit entries (mirrors the created_by_user_node invariant on
-- user_nodes from migration 024).
ALTER TABLE public.audit_log
  ADD COLUMN actor_user_node uuid REFERENCES public.user_nodes(id),
  ADD COLUMN target_type text,
  ADD COLUMN target_id text;

-- Index for the two most common query shapes: (a) recent entries by actor,
-- (b) "show me everything that touched <type:id>".
CREATE INDEX audit_log_occurred_actor_idx
  ON public.audit_log (occurred_at DESC, actor_admin);
CREATE INDEX audit_log_target_idx
  ON public.audit_log (target_type, target_id);
```

Result columns: `id, occurred_at, actor_admin?, actor_user_node?, op, client_id?, target_type?, target_id?, detail`. Exactly one of `{actor_admin, actor_user_node}` is non-null for any new row (enforced by `logAudit`, not by a CHECK constraint to keep the helper authoritative).

### 4.2 `logAudit` helper

New file `netlify/functions/_shared/audit.ts`:

```typescript
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { AnySession } from './permissions';

export interface AuditArgs {
  session: AnySession;
  op: string;                                     // e.g., 'client.created'
  clientId?: string | null;
  targetType?: string | null;
  targetId?: string | null;                       // text — varies by type
  detail?: Record<string, unknown> | null;
}

export async function logAudit(
  sql: NeonQueryFunction<false, false>,
  args: AuditArgs,
): Promise<void> {
  const actorAdmin = args.session.kind === 'admin' ? args.session.admin.id : null;
  const actorUserNode = args.session.kind === 'bucket_user' ? args.session.user_node_id : null;
  try {
    await sql`
      INSERT INTO public.audit_log
        (actor_admin, actor_user_node, op, client_id, target_type, target_id, detail)
      VALUES
        (${actorAdmin}::uuid, ${actorUserNode}::uuid, ${args.op},
         ${args.clientId ?? null}::uuid, ${args.targetType ?? null}, ${args.targetId ?? null},
         ${args.detail ? JSON.stringify(args.detail) : null}::jsonb)
    `;
  } catch (err) {
    // Audit failures must NOT fail the parent request. Log to stderr and
    // swallow — losing one audit row is better than rolling back a real
    // business operation because of an audit issue.
    console.error('[audit] insert failed', { op: args.op, err: (err as Error).message });
  }
}
```

The helper is async-but-fire-and-forget-friendly: parent endpoints `await` it (so we don't unhandled-promise-reject), but its catch suppression means an audit failure never propagates.

### 4.3 Sensitive-payload filtering

`detail` is the freeform jsonb attached to each entry. Hardcoded redactions in `logAudit` call sites — NEVER inside the helper itself, because the call site knows what's sensitive:

- **`credential.reset`**: detail = `{ has_temp_password: true }`. The temp pw plaintext is NEVER stored.
- **`credential.peeked`**: detail = `{ views_left_after: <number> }`. The pw plaintext is NEVER stored.
- **`user_node.updated`**: detail = the request body (display_name, email, etc.) — these are not sensitive.
- **`onboard-client.onboarded`**: detail = summary stats `{ enabled_products_count, roles_count, levels_count, cardinality_rules_count, owner_email }` — NOT the temp_password.

### 4.4 Instrumentation matrix

Every mutating endpoint gets one `await logAudit(...)` after its success path. Endpoint groups:

| File | Method | op | target_type | client_id source | detail shape |
|---|---|---|---|---|---|
| `clients.ts` | POST | `client.created` | client | new id | `{name, slug}` |
| `clients-detail.ts` | PATCH | `client.updated` | client | from row | request body |
| `clients-detail.ts` | DELETE | `client.deleted` | client | from row | `{name}` |
| `client-roles.ts` | POST | `role.created` | role | query param | `{key, label}` |
| `client-roles-detail.ts` | PATCH | `role.updated` | role | from row | request body |
| `client-roles-detail.ts` | DELETE | `role.deleted` | role | from row | `{key}` |
| `client-levels.ts` | POST | `level.created` | level | query param | `{level_number, label}` |
| `client-levels-detail.ts` | PATCH | `level.updated` | level | from row | request body |
| `client-levels-detail.ts` | DELETE | `level.deleted` | level | from row | `{level_number}` |
| `client-cardinality.ts` | PUT | `cardinality.replaced` | client | query param | `{rules_count}` |
| `admin-client-products.ts` | PUT | `products.replaced` | client | query param | `{keys}` |
| `client-levels-permissions.ts` | PUT | `permissions.updated` | level | query param (id) | `{keys_count}` |
| `user-nodes.ts` | POST | `user_node.created` | user_node | scoped | `{display_name, role_id, level_number, has_login}` |
| `user-nodes-detail.ts` | PATCH | `user_node.updated` | user_node | from row | request body |
| `user-nodes-detail.ts` | DELETE | `user_node.deleted` | user_node | from row | `{display_name}` |
| `user-nodes-move.ts` | POST | `user_node.moved` | user_node | from row | `{new_parent_id, new_level_number}` |
| `user-node-credential.ts` | GET?peek=1 | `credential.peeked` | user_node | from row | `{views_left_after}` |
| `user-node-credential.ts` | POST | `credential.reset` | user_node | from row | `{has_temp_password: true}` |
| `user-node-credential.ts` | DELETE | `credential.deleted` | user_node | from row | `{}` |
| `onboard-client.ts` | POST | `client.onboarded` | client | new id | summary stats per §4.3 |
| `admin-team.ts` | POST | `admin.created` | admin | null | `{email, display_name}` |
| `admin-team-detail.ts` | PATCH | `admin.updated` | admin | null | request body |
| `admin-team-detail.ts` | DELETE | `admin.deleted` | admin | null | `{email}` |

For PATCH/DELETE on `*-detail` endpoints, `client_id` is read from the existing row fetch (already done for authorization). For credential endpoints, `client_id` is on the credential row.

### 4.5 New endpoint — `GET /api/audit-log`

Admin-only (`requireAdmin`). Query params (all optional):

- `actor_admin` — UUID
- `actor_user_node` — UUID
- `client_id` — UUID
- `op` — exact string match
- `target_type` — exact string match
- `target_id` — exact text match
- `since` — ISO timestamp; `occurred_at >= since`
- `until` — ISO timestamp; `occurred_at < until`
- `page` — int, 1-based, default 1
- `page_size` — int, default 50, max 200

Returns:

```typescript
{
  entries: Array<{
    id: number;
    occurred_at: string;                 // ISO
    actor: { kind: 'admin' | 'bucket_user' | 'unknown'; id: string | null; label: string };
    op: string;
    client_id: string | null;
    client_name: string | null;          // joined
    target_type: string | null;
    target_id: string | null;
    detail: Record<string, unknown> | null;
  }>;
  total: number;                          // total matching the filter
  page: number;
  page_size: number;
}
```

`actor.label` is joined server-side: for `actor_admin`, the admin's email; for `actor_user_node`, the user_node's `display_name`. `client_name` is joined from `clients`. Both are LEFT JOINs (rows survive if the FK target was deleted; label falls back to `'(deleted)'`).

Default sort: `occurred_at DESC`. `total` uses a second `COUNT(*)` over the same WHERE clause.

### 4.6 Frontend

**Routes:**
- `/audit` — top-level. New sidebar entry "Audit" added to AMS Sidebar.
- `/clients/:clientId/audit` — per-client. Reached from a new "Audit" link in `AccessDashboard.tsx` header alongside "Access levels" and "Configure".

**Components:**

```
src/modules/ams/pages/AuditLog.tsx                # top-level wrapper
src/modules/ams/pages/ClientAuditLog.tsx          # per-client wrapper (reads :clientId, pre-filters)
src/modules/ams/components/audit/AuditFilters.tsx # the filter bar
src/modules/ams/components/audit/AuditTable.tsx   # paginated table — both pages mount this
src/modules/ams/components/audit/AuditDetailDrawer.tsx  # side panel for the jsonb
```

`AuditTable.tsx` takes the filter state + the data + onClick handlers as props. Page-level wrappers own the filter state. Per-client variant hides the client dropdown in `AuditFilters`.

**Filter bar UX:**
- Actor dropdown: 3 options (Any / Admin / Bucket-user). When Admin/Bucket-user is chosen, a second dropdown appears with the specific actors (admins from `/api/admin-team`; bucket users requires a per-client query — skip the second-level user-node picker for v1 and rely on `target_id` for filtering by target).
- Op multi-select: pre-populated from a known list of ops.
- Date range: two ISO datetime-local inputs; default = last 7 days.
- Apply button (don't auto-fetch on every keystroke).

**Detail drawer:**
- Slides in from the right when a row is clicked.
- Shows: actor (with hover-tooltip = full id), occurred_at (ISO + relative), op, client+target, full `detail` as syntax-colored JSON (just `JSON.stringify(detail, null, 2)` in a `<pre>` is fine for v1).
- Close button + Escape + outside-click all close it.

### 4.7 API wrapper

Add to `src/modules/ams/api.ts`:

```typescript
export interface AuditLogEntry { /* ... matches §4.5 */ }
export interface AuditLogFilter {
  actor_admin?: string;
  actor_user_node?: string;
  client_id?: string;
  op?: string;
  target_type?: string;
  target_id?: string;
  since?: string;
  until?: string;
  page?: number;
  page_size?: number;
}
export const listAuditLog = (filter: AuditLogFilter) => apiFetch<...>(...)
```

## 5. Error handling

| Scenario | Behavior |
|---|---|
| `logAudit` INSERT fails | `console.error` + swallow. Parent request returns success. |
| Bad query params on `/api/audit-log` | Zod returns 400 `validation_failed` with the offending field. |
| `page_size > 200` | Clamped to 200, no error. |
| Non-admin caller | 401 `unauthorized` (existing pattern). |
| Detail jsonb too large | Postgres handles up to 1GB; no soft limit enforced in v1. Worth a TODO if abuse appears. |

## 6. Testing

### 6.1 Server — instrumentation

Each instrumented endpoint's existing happy-path test gains ONE assertion: after the success response, the most recent `audit_log` row matches `{op, target_type, target_id, actor}`. ~20 tests touched, ~20 assertions added.

To avoid each test fanning out a SELECT, add a small helper `assertLastAudit(sql, expected)` in a new `tests/helpers/audit.ts`.

### 6.2 Server — `audit-log.ts` endpoint

New test file `tests/integration/audit-log.test.ts` (~8 cases):

- Auth: 401 for unauthenticated; 200 for admin.
- Empty result set: returns `{entries: [], total: 0}`.
- Pagination: 75 inserted rows + page_size=50, page=1 → 50 entries + total=75; page=2 → 25 entries.
- Filter by `actor_admin`: returns only rows matching.
- Filter by `client_id`: returns only rows matching.
- Filter by `op`: exact match.
- Filter by date range (`since`/`until`).
- `client_name` and `actor.label` correctly joined; both fall back when the FK target is deleted.

### 6.3 Unit — `logAudit` helper

`tests/unit/log-audit.test.ts`:
- Admin session: writes `actor_admin = session.admin.id` and `actor_user_node = null`.
- Bucket-user session: writes `actor_user_node = session.user_node_id` and `actor_admin = null`.
- SQL throws → helper resolves (no propagated rejection); the thrown error is logged to stderr.

### 6.4 Manual smoke (Task 8 of the plan)

After ship:
1. Admin onboards a fresh client via the wizard → 1 row in audit_log with op `client.onboarded`.
2. Admin adds + edits + deletes a user via the AMS → 3 rows.
3. Admin peeks the new user's temp pw twice → 2 rows with op `credential.peeked` and decreasing `views_left_after`.
4. Visit `/audit` → see all 6 rows in DESC order. Click a row → detail drawer shows the JSON.
5. Filter by op = `credential.peeked` → 2 rows.
6. Visit `/clients/<new-id>/audit` → see only this client's 5 rows (excludes the cross-client onboard from another workspace).
7. Sign in as Joe (Owner) → no "Audit" entry visible in his sidebar (admin-only).
8. Direct visit to `/audit` while signed in as Joe → admin redirect (existing `RequireAdmin` gate handles this).

## 7. Migration / backwards-compat

- Migration 025 must hit prod before push (per saved feedback `feedback_migration_before_deploy`).
- The table rename is safe — verified via `grep -rn "schema_ops_log" src/ netlify/` returns zero hits at design time.
- New endpoint `/api/audit-log` is additive; no existing route shape changes.

## 8. Open questions deferred to implementation

- **Op enumeration**: should there be a typed `Op` enum in TS, or just freeform strings? **Decision:** start with freeform strings + a comment listing known ops. Future enum if drift becomes a problem.
- **Pagination cursor vs offset**: offset is simpler; cursor (`occurred_at + id` after) scales better. **Decision:** offset for v1 — log size is small (we just started populating it).
- **Filter UI for user_node picker**: requires a per-client fetch. **Decision:** skip in v1; users filter by `target_id` text input instead.
- **Detail jsonb in detail drawer rendering**: pretty-print JSON only, no syntax highlighting library. **Decision:** keep deps minimal.

## 9. Suggested next steps

1. User reviews this spec.
2. `superpowers:writing-plans` → implementation plan (~8 tasks: migration, helper + unit tests, instrumentation pass 1 (clients/roles/levels/cardinality/products/permissions), instrumentation pass 2 (user-nodes/credential/onboard/admin-team), endpoint + integration tests, API wrapper + Sidebar nav, AuditTable + filter + drawer, page wrappers + per-client header link + smoke).
3. `superpowers:subagent-driven-development` to execute.
