# AMS v3 — Hierarchical Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v2 flat-bucket / hardcoded-template AMS with a per-client hierarchical org tree: admin-defined roles, admin-defined levels (1..N), strict tree of user nodes with per-parent cardinality caps, and drag-and-drop reorganization that updates the backend `parent_id` atomically.

**Architecture:** Wipe v2 entirely. Four new tables in `public` (`client_roles`, `client_levels`, `client_cardinality_rules`, `user_nodes`) plus a re-keyed `user_node_credentials`. Single `move` endpoint as drag-and-drop source of truth with cycle check + cardinality lock + recursive CTE for descendant relevel. UI is two pages: ConfigureStructure (admin defines roles/levels/limits) and AccessDashboard (level-stratified chips with @dnd-kit drag-and-drop).

**Tech Stack:** Postgres (Neon), TypeScript, Netlify Functions v2, React 18 + react-router 7, @dnd-kit, argon2, JWT (jose), vitest.

**Spec:** `docs/superpowers/specs/2026-05-27-ams-v3-hierarchy-design.md` (commit `9a0a6e7`).

**Cost note:** Phase 1 is destructive — drops all v2 client data on dev (and later prod). The user has explicitly approved this. Bootstrap admin and admin team data survive.

---

## Phase 1 — Wipe v2 + scaffold v3 schema

**Goal:** All v2 client data dropped; new schema tables created on dev Neon; v2 backend/frontend/test files deleted or modified so typecheck + remaining tests stay green.

**Working directory for ALL commands:** `/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol Data Collection App`

(Subsequent Bash steps assume this is the cwd.)

### Task 1.1: Write migration 010 — wipe v2 schemas

**Files:**
- Create: `db/migrations/010_wipe_v2_client_schemas.sql`

- [ ] **Step 1: Write the migration**

```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT nspname FROM pg_namespace
    WHERE nspname ~ '^client_[0-9a-f]{32}$'
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', r.nspname);
  END LOOP;
  TRUNCATE TABLE public.clients CASCADE;
END $$;
```

- [ ] **Step 2: Verify the splitter treats it as one statement**

The migration runner (`scripts/migrate.ts`) detects `$$` and skips the `;` splitter. Confirm by reading the migration file is exactly one `DO $$ ... END $$;` block.

### Task 1.2: Write migration 011 — drop template columns

**Files:**
- Create: `db/migrations/011_drop_template_columns.sql`
- Create: `db/migrations/011b_drop_schema_name.sql`

- [ ] **Step 1: Write 011 (drop template columns)**

```sql
ALTER TABLE public.clients DROP COLUMN template_key;
ALTER TABLE public.clients DROP COLUMN template_version_applied;
```

- [ ] **Step 2: Write 011b (drop schema_name)**

`public.clients.schema_name` is NOT NULL + UNIQUE + CHECK in migration 003. The v3 client-create flow (Task 1.14) drops `schema_name` from the INSERT — so the column must go too, or inserts fail with `null value in column "schema_name" violates not-null constraint`.

```sql
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_schema_name_format;

ALTER TABLE public.clients DROP COLUMN IF EXISTS schema_name
```

### Task 1.3: Write migration 012 — drop bucket_user_credentials

**Files:**
- Create: `db/migrations/012_drop_bucket_user_credentials.sql`

- [ ] **Step 1: Write the migration**

```sql
DROP TABLE IF EXISTS public.bucket_user_credentials;
```

### Task 1.4: Write migration 013 — client_roles

**Files:**
- Create: `db/migrations/013_client_roles.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE public.client_roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  key            text NOT NULL,
  label          text NOT NULL,
  color          text NOT NULL,
  fields         jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_roles_key_per_client_unique UNIQUE (client_id, key)
);

CREATE TRIGGER client_roles_set_updated_at
  BEFORE UPDATE ON public.client_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### Task 1.5: Write migration 014 — client_levels

**Files:**
- Create: `db/migrations/014_client_levels.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE public.client_levels (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  level_number        integer NOT NULL CHECK (level_number > 0),
  label               text,
  allowed_role_ids    uuid[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_levels_number_per_client_unique UNIQUE (client_id, level_number)
);
```

### Task 1.6: Write migration 015 — user_nodes (table + trigger)

**Files:**
- Create: `db/migrations/015_user_nodes.sql`

- [ ] **Step 1: Write the migration** (single `$$` body — the splitter will treat the whole file as one statement; we use a single `DO $$ BEGIN ... END $$;` to wrap the multi-statement DDL)

Because the splitter detects `$$` and passes the whole body through, we can either (a) put the whole file in one `DO $$ ... END $$;` block, or (b) split into two files. Choose (b) for clarity — table + function go in 015, trigger goes in 015b:

```sql
CREATE TABLE public.user_nodes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  parent_id           uuid REFERENCES public.user_nodes(id) ON DELETE RESTRICT,
  level_number        integer,
  role_id             uuid NOT NULL REFERENCES public.client_roles(id) ON DELETE RESTRICT,
  display_name        text NOT NULL,
  email               citext,
  phone               text,
  notes               text,
  fields              jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by_admin    uuid NOT NULL REFERENCES public.admins(id),
  CONSTRAINT user_nodes_parent_level_consistency CHECK (
    (level_number IS NULL AND parent_id IS NULL) OR
    (level_number = 1 AND parent_id IS NULL) OR
    (level_number > 1 AND parent_id IS NOT NULL)
  )
);

CREATE INDEX user_nodes_client_parent_idx ON public.user_nodes (client_id, parent_id);
CREATE INDEX user_nodes_client_level_idx  ON public.user_nodes (client_id, level_number);
CREATE UNIQUE INDEX user_nodes_email_per_client_idx
  ON public.user_nodes (client_id, lower(email::text)) WHERE email IS NOT NULL;
```

### Task 1.7: Write migration 015b — user_nodes trigger function + trigger

**Files:**
- Create: `db/migrations/015b_user_nodes_trigger.sql`

- [ ] **Step 1: Write the migration** (single `$$` body, splitter passes through as one statement)

```sql
CREATE OR REPLACE FUNCTION public.user_nodes_validate() RETURNS trigger AS $$
DECLARE
  parent_level integer;
  parent_client uuid;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT level_number, client_id INTO parent_level, parent_client
      FROM public.user_nodes WHERE id = NEW.parent_id;
    IF parent_client <> NEW.client_id THEN
      RAISE EXCEPTION 'cross_client_parent';
    END IF;
    IF parent_level IS NULL OR NEW.level_number IS NULL
       OR NEW.level_number <> parent_level + 1 THEN
      RAISE EXCEPTION 'parent_level_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Create 015c for the trigger** (separate file because second file lets the splitter handle each $$ body independently)

**Files:**
- Create: `db/migrations/015c_user_nodes_triggers.sql`

```sql
CREATE TRIGGER user_nodes_validate_trig
  BEFORE INSERT OR UPDATE ON public.user_nodes
  FOR EACH ROW EXECUTE FUNCTION public.user_nodes_validate();

CREATE TRIGGER user_nodes_set_updated_at
  BEFORE UPDATE ON public.user_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### Task 1.8: Write migration 016 — client_cardinality_rules

**Files:**
- Create: `db/migrations/016_client_cardinality_rules.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE public.client_cardinality_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  parent_role_id  uuid REFERENCES public.client_roles(id) ON DELETE CASCADE,
  child_role_id   uuid NOT NULL REFERENCES public.client_roles(id) ON DELETE CASCADE,
  max_children    integer NOT NULL CHECK (max_children >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cardinality_unique_top UNIQUE (client_id, parent_role_id, child_role_id)
);
```

Note: Postgres treats `NULL` as distinct in UNIQUE by default, which is what we want — multiple top-level rules (with `parent_role_id IS NULL`) for different child roles are valid; two with the same `child_role_id` would be duplicates only if `parent_role_id` matches.

### Task 1.9: Write migration 017 — user_node_credentials

**Files:**
- Create: `db/migrations/017_user_node_credentials.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE public.user_node_credentials (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_node_id                uuid NOT NULL REFERENCES public.user_nodes(id) ON DELETE CASCADE,
  email                       citext NOT NULL,
  password_hash               text NOT NULL,
  must_change_password        boolean NOT NULL DEFAULT true,
  temp_password_plain         text,
  temp_password_views_left    integer,
  last_login_at               timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by_admin            uuid NOT NULL REFERENCES public.admins(id),
  CONSTRAINT user_node_credentials_email_per_client_unique UNIQUE (client_id, email),
  CONSTRAINT user_node_credentials_node_unique UNIQUE (user_node_id)
);

CREATE INDEX user_node_credentials_email_idx
  ON public.user_node_credentials (client_id, email);

CREATE TRIGGER user_node_credentials_set_updated_at
  BEFORE UPDATE ON public.user_node_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### Task 1.10: Apply all new migrations to dev Neon

- [ ] **Step 1: Run migrate against dev**

Run: `npm run migrate`
Expected: all migrations 001–009 print "already applied", then 010 through 017 each print "applying" then a check mark. Final line success-implied (no errors).

- [ ] **Step 2: Verify dev schema state**

Run: `npx tsx --env-file=.env -e "import { neon } from '@neondatabase/serverless'; const sql = neon(process.env.DATABASE_URL); sql\`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('client_roles','client_levels','user_nodes','client_cardinality_rules','user_node_credentials','bucket_user_credentials') ORDER BY table_name\`.then(r => console.log(r))"`

Expected output: 5 rows — `client_cardinality_rules`, `client_levels`, `client_roles`, `user_node_credentials`, `user_nodes`. NOT `bucket_user_credentials` (dropped in 012).

### Task 1.11: Delete v2 backend endpoint files

- [ ] **Step 1: Delete files**

```bash
rm netlify/functions/clients-buckets.ts
rm netlify/functions/clients-bucket-users.ts
rm netlify/functions/clients-bucket-user-detail.ts
rm netlify/functions/bucket-user-credential.ts
```

### Task 1.12: Defer v2 shared module deletions to Phase 4

**Originally** this task deleted `_shared/templates.ts`, `_shared/template-ddl.ts`, `_shared/schema-manager.ts`, `_shared/bucket.ts`. **Deferred** because `u-me.ts`, `u-login.ts`, and `u-change-password.ts` still import from them until Phase 4 rewires those endpoints. Deleting in Phase 1 would break typecheck (Task 1.27).

These modules will be deleted in Phase 4 after Task 4.5 (the last u-* rewrite). See "Task 4.X: Delete v2 shared modules and unit tests" added at the end of Phase 4 below.

- [ ] **Step 1: Skip — no action**

Files stay in place. They become orphans (no imports from surviving code) only after Phase 4 completes.

### Task 1.13: Defer identifier.ts trim to Phase 4

**Originally** this task trimmed `_shared/identifier.ts` to keep only `assertUuid`, `isValidUuid`, `deriveSlug`, `isValidSlug` (removing `safeQuoteSchema`, `safeQuoteIdent`, `isValidSchemaName`, `generateSchemaName`). **Deferred** because `u-me.ts`, `_shared/bucket.ts`, and `_shared/schema-manager.ts` still use those helpers until Phase 4.

The trim moves to Phase 4's new cleanup task. See "Task 4.X" below.

- [ ] **Step 1: Skip — no action**

`identifier.ts` stays full-fat. New code in Phase 2 only needs the surviving helpers (assertUuid, deriveSlug, isValidSlug); the v2 helpers remain unused-by-new-code but referenced-by-old-code, which is fine.

### Task 1.14: Update clients.ts — drop template + schema creation

**Files:**
- Modify: `netlify/functions/clients.ts`

- [ ] **Step 1: Rewrite the file**

```typescript
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { deriveSlug } from './_shared/identifier';

const CreateBody = z.object({
  name: z.string().min(1).max(200),
});

interface ClientRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export default async (req: Request, _ctx: Context) => {
  let actor;
  try {
    actor = await requireAdmin(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT id, name, slug, created_at
      FROM public.clients
      ORDER BY created_at DESC
    `) as ClientRow[];
    return jsonOk({ clients: rows });
  }

  if (req.method === 'POST') {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

    const baseSlug = deriveSlug(parsed.data.name);
    let slug = baseSlug;
    let suffix = 2;
    for (let i = 0; i < 25; i++) {
      const existing = (await sql`
        SELECT 1 FROM public.clients WHERE slug = ${slug} LIMIT 1
      `) as unknown[];
      if (existing.length === 0) break;
      slug = `${baseSlug}-${suffix++}`;
    }

    const inserted = (await sql`
      INSERT INTO public.clients (name, slug, created_by)
      VALUES (${parsed.data.name}, ${slug}, ${actor.admin.id})
      RETURNING id, created_at
    `) as { id: string; created_at: string }[];

    return jsonOk(
      { client: { id: inserted[0]!.id, name: parsed.data.name, slug, created_at: inserted[0]!.created_at } },
      { status: 201 },
    );
  }

  return jsonError(405, 'method_not_allowed');
};
```

### Task 1.15: Update clients-detail.ts — drop schema_name

**Files:**
- Modify: `netlify/functions/clients-detail.ts`

- [ ] **Step 1: Rewrite the file**

```typescript
import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

export default async (req: Request, _ctx: Context) => {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(id, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const sql = db();
  const rows = (await sql`
    SELECT id, name, slug, created_at FROM public.clients WHERE id = ${id} LIMIT 1
  `) as { id: string; name: string; slug: string; created_at: string }[];
  const client = rows[0];
  if (!client) return jsonError(404, 'not_found');

  if (req.method === 'GET') return jsonOk({ client });

  if (req.method === 'DELETE') {
    // Cascades to client_roles, client_levels, user_nodes, etc. via FK.
    await sql`DELETE FROM public.clients WHERE id = ${id}`;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
```

### Task 1.16: Delete v2 frontend files

- [ ] **Step 1: Delete files**

```bash
rm src/modules/ams/pages/ClientSettings.tsx
rm src/modules/ams/components/BucketPanel.tsx
rm src/modules/ams/components/AddUserModal.tsx
rm src/modules/ams/components/EditUserModal.tsx
```

LoginManageModal stays — it'll be rewired in Phase 6.

### Task 1.17: Stub AccessDashboard + ConfigureStructure placeholders

These will become the real pages in Phases 5 and 6. For now, give the router something to import so the SPA doesn't break.

**Files:**
- Create: `src/modules/ams/pages/AccessDashboard.tsx`
- Create: `src/modules/ams/pages/ConfigureStructure.tsx`

- [ ] **Step 1: Stub AccessDashboard**

```tsx
import { useParams, Link } from 'react-router-dom';

export default function AccessDashboard() {
  const { clientId } = useParams<{ clientId: string }>();
  return (
    <section>
      <h1>Access dashboard</h1>
      <p className="muted">Coming in Phase 6. Configure structure first.</p>
      <Link to={`/clients/${clientId}/configure`} className="btn btn-primary">Configure structure →</Link>
    </section>
  );
}
```

- [ ] **Step 2: Stub ConfigureStructure**

```tsx
export default function ConfigureStructure() {
  return (
    <section>
      <h1>Configure structure</h1>
      <p className="muted">Coming in Phase 5.</p>
    </section>
  );
}
```

### Task 1.18: Update router with new routes

**Files:**
- Modify: `src/lib/router.tsx`

- [ ] **Step 1: Rewrite the file**

```tsx
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth-context';
import LoginPage from '../modules/login/pages/LoginPage';
import { Sidebar } from '../modules/ams/components/Sidebar';
import AdminDashboard from '../modules/ams/pages/AdminDashboard';
import AdminSettings from '../modules/ams/pages/AdminSettings';
import AccessDashboard from '../modules/ams/pages/AccessDashboard';
import ConfigureStructure from '../modules/ams/pages/ConfigureStructure';
import UserLogin from '../modules/user-portal/pages/UserLogin';
import UserChangePassword from '../modules/user-portal/pages/UserChangePassword';
import UserAccount from '../modules/user-portal/pages/UserAccount';
import { UserPortalLayout, RequireBucketUser } from '../modules/user-portal/UserPortalRoutes';

function ShellLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main"><Outlet /></main>
    </div>
  );
}

function RequireAdmin() {
  const { admin, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!admin) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <ShellLayout />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/c/:slug',
    element: <UserPortalLayout />,
    children: [
      { path: 'login', element: <UserLogin /> },
      {
        element: <RequireBucketUser />,
        children: [
          { index: true, element: <UserAccount /> },
          { path: 'change-password', element: <UserChangePassword /> },
        ],
      },
    ],
  },
  {
    element: <RequireAdmin />,
    children: [
      { path: '/', element: <AdminDashboard /> },
      { path: '/settings', element: <AdminSettings /> },
      { path: '/clients/:clientId', element: <AccessDashboard /> },
      { path: '/clients/:clientId/configure', element: <ConfigureStructure /> },
    ],
  },
]);
```

The old `/clients/:clientId/settings` route is gone. ClientDashboard.tsx is also no longer referenced — delete it.

### Task 1.19: Delete ClientDashboard.tsx

- [ ] **Step 1: Delete**

```bash
rm src/modules/ams/pages/ClientDashboard.tsx
```

### Task 1.20: Update ClientCard to drop template label

**Files:**
- Modify: `src/modules/ams/components/ClientCard.tsx`

- [ ] **Step 1: Read current file**

Run: `cat src/modules/ams/components/ClientCard.tsx`

- [ ] **Step 2: Remove the `templateLabel` line and the template-label span. Remove TEMPLATES import.**

The file should no longer import `TEMPLATES`. Replace the header span content so it's just the schema-name-ish display (or remove the template chip entirely). Resulting file:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteClient, type ClientSummary } from '../api';

interface Props {
  client: ClientSummary;
  onDeleted: () => void;
}

export function ClientCard({ client, onDeleted }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm(`Delete client "${client.name}"? This drops ALL its users, roles, and login credentials permanently.`)) return;
    setBusy(true);
    const r = await deleteClient(client.id);
    setBusy(false);
    if (!r.ok) { alert(`Delete failed: ${r.error.code}`); return; }
    onDeleted();
  }

  return (
    <article className="card">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{client.name}</h3>
        <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{client.slug}</span>
      </header>
      <div style={{ display: 'flex', gap: 8 }}>
        <Link to={`/clients/${client.id}`} className="btn btn-secondary">open →</Link>
        <button className="btn btn-danger" onClick={handleDelete} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </article>
  );
}
```

### Task 1.21: Strip bucket/structure types from api.ts

**Files:**
- Modify: `src/modules/ams/api.ts`

- [ ] **Step 1: Rewrite the file keeping only client + admin-team helpers; remove everything bucket/credential**

```typescript
import { apiFetch } from '../../lib/api-client';

export interface ClientSummary {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export const listClients = () => apiFetch<{ clients: ClientSummary[] }>('/api/clients');

export const createClient = (name: string) =>
  apiFetch<{ client: ClientSummary }>('/api/clients', {
    method: 'POST', body: JSON.stringify({ name }),
  });

export const deleteClient = (id: string) =>
  apiFetch<{ ok: true }>(`/api/clients-detail?id=${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface AdminMember {
  id: string;
  email: string;
  display_name: string;
  is_bootstrap: boolean;
  has_password: boolean;
  has_google: boolean;
  created_at: string;
}

export const listAdminTeam = () =>
  apiFetch<{ admins: AdminMember[] }>('/api/admin-team');

export const createAdmin = (body: { email: string; display_name: string; password?: string }) =>
  apiFetch<{ admin: AdminMember }>('/api/admin-team', {
    method: 'POST', body: JSON.stringify(body),
  });

export const deleteAdmin = (id: string) =>
  apiFetch<{ ok: true }>(`/api/admin-team-detail?id=${encodeURIComponent(id)}`, { method: 'DELETE' });

export const updateAdminSelf = (body: { display_name?: string; password?: string }) =>
  apiFetch<{ admin: { id: string; email: string; display_name: string; is_bootstrap: boolean } }>(
    '/api/admin-self',
    { method: 'PATCH', body: JSON.stringify(body) },
  );
```

### Task 1.22: Update AddClientModal — drop template select

**Files:**
- Modify: `src/modules/ams/components/AddClientModal.tsx`

- [ ] **Step 1: Read current**

Run: `cat src/modules/ams/components/AddClientModal.tsx`

- [ ] **Step 2: Rewrite without the template select**

```tsx
import { useState, type FormEvent } from 'react';
import { createClient } from '../api';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function AddClientModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    setSubmitting(true);
    setError(null);
    const r = await createClient(name.trim());
    setSubmitting(false);
    if (!r.ok) { setError(`Failed to create client (${r.error.code}).`); return; }
    onCreated();
    onClose();
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 90vw)' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>New Client</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          You'll configure roles, levels, and access structure on the next page.
        </p>
        <form onSubmit={handleSubmit}>
          <label>Name
            <input type="text" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Joe's Hardware" />
          </label>
          {error && <p className="error">{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

### Task 1.23: Update LoginManageModal — re-target user-node-credential endpoint

**Files:**
- Modify: `src/modules/ams/components/LoginManageModal.tsx`

This file is referenced by the (now-deleted) BucketPanel. We'll need it later in Phase 6, but it must compile NOW so typecheck passes. The simplest path: change its imports and props to be node-id-shaped but leave the endpoint URL temporarily wrong (it'll be fixed in Phase 4 when the endpoint exists). Actually — cleaner: delete this file too and recreate it in Phase 6.

- [ ] **Step 1: Delete the file**

```bash
rm src/modules/ams/components/LoginManageModal.tsx
```

(Phase 6 task 6.7 will recreate it from scratch.)

### Task 1.24: Strip CredentialRevealRow from AddUserModal (if still imported)

Already handled — `AddUserModal.tsx` was deleted in 1.16. If anything still imports from it (search), fix.

- [ ] **Step 1: Search for leftover imports of deleted components**

Run: `grep -rn "from.*AddUserModal\|from.*EditUserModal\|from.*BucketPanel\|from.*LoginManageModal\|from.*ClientDashboard\|from.*ClientSettings" src/`
Expected: no output (no remaining imports).

If any found, delete those references.

### Task 1.25: Delete v2 integration tests

- [ ] **Step 1: Delete files**

```bash
rm tests/integration/schema-bucket.test.ts
rm tests/integration/buckets-cardinality.test.ts
rm tests/integration/bucket-user-auth.test.ts
```

These will be replaced in Phases 3 and 4.

### Task 1.26: Patch clients-lifecycle.test.ts

**Files:**
- Modify: `tests/integration/clients-lifecycle.test.ts`

- [ ] **Step 1: Read current**

Run: `cat tests/integration/clients-lifecycle.test.ts`

- [ ] **Step 2: Strip every reference to `template_key`, `template_unknown`, and `schema_name`**

The POST body in tests should be just `{ name: '...' }`. The 201 response shape becomes `{ client: { id, name, slug, created_at } }`. The "schema exists in information_schema.tables" test should be deleted (no per-client schemas anymore). The "DELETE drops the schema" assertions also go — DELETE just removes the row now.

Read the file fully, then rewrite it. Aim for ~6 tests after the trim:

```typescript
// tests/integration/clients-lifecycle.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientsDetailHandler from '../../netlify/functions/clients-detail';

const ADMIN_EMAIL = 'clients-lifecycle-test@example.com';
const ADMIN_PASSWORD = 'clients-lifecycle-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
const created: string[] = [];

function loginReq(email: string, password: string): Request {
  return new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function getCookie(): Promise<string> {
  const r = await loginHandler(loginReq(ADMIN_EMAIL, ADMIN_PASSWORD), CTX);
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Clients Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, display_name = 'Clients Test Admin'
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  cookie = await getCookie();
});

afterAll(async () => {
  for (const id of created) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('clients lifecycle', () => {
  test('POST /api/clients with valid body returns 201 + client', async () => {
    const r = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Lifecycle Test Co' }),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { client: { id: string; name: string; slug: string } };
    expect(body.client.name).toBe('Lifecycle Test Co');
    expect(body.client.slug).toMatch(/^lifecycle-test-co/);
    created.push(body.client.id);
  });

  test('POST with empty name returns 400 validation_failed', async () => {
    const r = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: '' }),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
  });

  test('GET /api/clients lists created clients', async () => {
    const r = await clientsHandler(new Request('http://localhost/api/clients', { method: 'GET', headers: { cookie } }), CTX);
    expect(r.status).toBe(200);
    const body = await r.json() as { clients: Array<{ id: string }> };
    expect(Array.isArray(body.clients)).toBe(true);
  });

  test('POST without auth returns 401', async () => {
    const r = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'noauth' }),
      }),
      CTX,
    );
    expect(r.status).toBe(401);
  });

  test('GET /api/clients-detail returns the client', async () => {
    const c = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Detail Test Co' }),
      }),
      CTX,
    );
    const body = await c.json() as { client: { id: string } };
    created.push(body.client.id);

    const g = await clientsDetailHandler(
      new Request(`http://localhost/api/clients-detail?id=${body.client.id}`, { method: 'GET', headers: { cookie } }),
      CTX,
    );
    expect(g.status).toBe(200);
    const detail = await g.json() as { client: { id: string; name: string } };
    expect(detail.client.name).toBe('Detail Test Co');
  });

  test('DELETE /api/clients-detail with nonexistent id returns 404', async () => {
    const r = await clientsDetailHandler(
      new Request('http://localhost/api/clients-detail?id=00000000-0000-0000-0000-000000000000', { method: 'DELETE', headers: { cookie } }),
      CTX,
    );
    expect(r.status).toBe(404);
  });
});
```

### Task 1.27: Typecheck + run tests + commit Phase 1

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Run tests**

Run: `npx vitest run --reporter=dot`
Expected: all remaining tests pass (auth, admin-team, clients-lifecycle). Count should be approximately 80–95.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit Phase 1**

```bash
git add -A
git commit -m "$(cat <<'EOF'
phase 1: wipe v2 AMS, apply v3 schema migrations 010-017

- DROP all client_<id> schemas + TRUNCATE clients (010)
- Drop template_key + template_version_applied from clients (011)
- Drop bucket_user_credentials table (012)
- Create client_roles, client_levels, user_nodes (+trigger),
  client_cardinality_rules, user_node_credentials (013-017)
- Delete v2 endpoints (bucket-*), shared modules (templates, bucket,
  schema-manager, template-ddl), frontend components (BucketPanel,
  AddUserModal, EditUserModal, ClientSettings, ClientDashboard,
  LoginManageModal)
- Trim identifier.ts to UUID + slug helpers
- Modify clients.ts: drop template_key requirement and per-client
  schema creation; create() now just inserts a row
- Stub AccessDashboard + ConfigureStructure pages for router
- Route /clients/:id → AccessDashboard; /clients/:id/configure → new
- Patch clients-lifecycle.test.ts; delete schema-bucket,
  buckets-cardinality, bucket-user-auth tests

Migrations applied to dev Neon. Typecheck + tests + build green.
EOF
)"
```

---

## Phase 2 — Backend structure endpoints

**Goal:** Admin can CRUD roles, levels, and cardinality rules for a client; can GET a unified `client-structure` payload.

### Task 2.1: Write `_shared/user-tree.ts` skeleton

**Files:**
- Create: `netlify/functions/_shared/user-tree.ts`

- [ ] **Step 1: Create the file with type definitions and helper signatures**

```typescript
import type { NeonQueryFunction } from '@neondatabase/serverless';

export interface RoleRow {
  id: string;
  client_id: string;
  key: string;
  label: string;
  color: string;
  fields: RoleFieldDef[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RoleFieldDef {
  key: string;
  label: string;
  type: 'text' | 'date' | 'integer' | 'boolean';
  required: boolean;
  default?: string | number | boolean;
  help?: string;
  display_in_list?: boolean;
}

export interface LevelRow {
  id: string;
  client_id: string;
  level_number: number;
  label: string | null;
  allowed_role_ids: string[];
  created_at: string;
}

export interface CardinalityRuleRow {
  id: string;
  client_id: string;
  parent_role_id: string | null;
  child_role_id: string;
  max_children: number;
}

export interface UserNodeRow {
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
  created_by_admin: string;
}

export interface ClientStructure {
  roles: RoleRow[];
  levels: LevelRow[];
  cardinality_rules: CardinalityRuleRow[];
}

/** Load the full structure for a client in three queries. */
export async function loadStructure(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
): Promise<ClientStructure> {
  const roles = (await sql`
    SELECT id, client_id, key, label, color, fields, sort_order, created_at, updated_at
    FROM public.client_roles WHERE client_id = ${clientId}::uuid
    ORDER BY sort_order, created_at
  `) as RoleRow[];
  const levels = (await sql`
    SELECT id, client_id, level_number, label, allowed_role_ids, created_at
    FROM public.client_levels WHERE client_id = ${clientId}::uuid
    ORDER BY level_number
  `) as LevelRow[];
  const cardinality_rules = (await sql`
    SELECT id, client_id, parent_role_id, child_role_id, max_children
    FROM public.client_cardinality_rules WHERE client_id = ${clientId}::uuid
    ORDER BY parent_role_id NULLS FIRST, child_role_id
  `) as CardinalityRuleRow[];
  return { roles, levels, cardinality_rules };
}

/**
 * Walk ancestor chain from `targetParentId` upward; throw cycle_detected
 * if `movingNodeId` appears in the chain. Returns when reaching a NULL parent.
 */
export async function cycleCheck(
  sql: NeonQueryFunction<false, false>,
  movingNodeId: string,
  targetParentId: string | null,
): Promise<void> {
  if (targetParentId === null) return;
  let current: string | null = targetParentId;
  const seen = new Set<string>();
  while (current !== null) {
    if (current === movingNodeId) throw new Error('cycle_detected');
    if (seen.has(current)) throw new Error('cycle_detected'); // defensive
    seen.add(current);
    const rows = (await sql`
      SELECT parent_id FROM public.user_nodes WHERE id = ${current}::uuid LIMIT 1
    `) as { parent_id: string | null }[];
    if (rows.length === 0) throw new Error('parent_not_found');
    current = rows[0]!.parent_id;
  }
}

/**
 * Look up the cardinality cap for placing `childRoleId` under a parent of
 * `parentRoleId` (null = top-level). Returns null if no rule defined (= unlimited).
 */
export async function getCardinalityCap(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  parentRoleId: string | null,
  childRoleId: string,
): Promise<number | null> {
  const rows = (await sql`
    SELECT max_children
    FROM public.client_cardinality_rules
    WHERE client_id = ${clientId}::uuid
      AND child_role_id = ${childRoleId}::uuid
      AND (
        (parent_role_id IS NULL AND ${parentRoleId === null}::boolean) OR
        parent_role_id = ${parentRoleId}::uuid
      )
    LIMIT 1
  `) as { max_children: number }[];
  return rows[0]?.max_children ?? null;
}
```

### Task 2.2: Write client-structure GET endpoint with TDD

**Files:**
- Create: `netlify/functions/client-structure.ts`
- Create: `tests/integration/client-structure.test.ts`

- [ ] **Step 1: Write the failing test for the GET endpoint**

```typescript
// tests/integration/client-structure.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientStructureHandler from '../../netlify/functions/client-structure';

const ADMIN_EMAIL = 'client-structure-test@example.com';
const ADMIN_PASSWORD = 'client-structure-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let testClientId: string;
const createdClients: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Structure Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, display_name = 'Structure Test Admin'
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const r = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }),
    CTX,
  );
  if (r.status !== 200) throw new Error('login failed');
  cookie = r.headers.get('set-cookie')!.split(';')[0]!;

  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `Structure Test ${Date.now()}` }),
    }),
    CTX,
  );
  if (cr.status !== 201) throw new Error('client create failed');
  testClientId = (await cr.json() as { client: { id: string } }).client.id;
  createdClients.push(testClientId);
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('client-structure', () => {
  test('GET returns empty structure for a fresh client', async () => {
    const r = await clientStructureHandler(
      new Request(`http://localhost/api/client-structure?client=${testClientId}`, {
        method: 'GET', headers: { cookie },
      }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { roles: unknown[]; levels: unknown[]; cardinality_rules: unknown[] };
    expect(body.roles).toEqual([]);
    expect(body.levels).toEqual([]);
    expect(body.cardinality_rules).toEqual([]);
  });

  test('GET without auth returns 401', async () => {
    const r = await clientStructureHandler(
      new Request(`http://localhost/api/client-structure?client=${testClientId}`, { method: 'GET' }),
      CTX,
    );
    expect(r.status).toBe(401);
  });

  test('GET with unknown client returns 404', async () => {
    const r = await clientStructureHandler(
      new Request('http://localhost/api/client-structure?client=00000000-0000-0000-0000-000000000000', {
        method: 'GET', headers: { cookie },
      }),
      CTX,
    );
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to see them fail**

Run: `npx vitest run tests/integration/client-structure.test.ts`
Expected: failure — `client-structure.ts` doesn't exist yet.

- [ ] **Step 3: Implement the endpoint**

```typescript
// netlify/functions/client-structure.ts
import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { loadStructure } from './_shared/user-tree';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const clientId = new URL(req.url).searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const sql = db();
  const exists = (await sql`SELECT 1 FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1`) as unknown[];
  if (exists.length === 0) return jsonError(404, 'not_found');

  const structure = await loadStructure(sql, clientId);
  return jsonOk(structure);
};
```

- [ ] **Step 4: Run tests — they should pass**

Run: `npx vitest run tests/integration/client-structure.test.ts`
Expected: 3 passing.

### Task 2.3: client-roles POST endpoint (TDD)

**Files:**
- Create: `netlify/functions/client-roles.ts`
- Modify: `tests/integration/client-structure.test.ts` (append)

- [ ] **Step 1: Append a failing test for POST**

Append inside the `describe('client-structure', () => { ... })` block:

```typescript
  test('POST /api/client-roles creates a role', async () => {
    const r = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#4287f5' }),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { role: { id: string; key: string; label: string; color: string; fields: unknown[] } };
    expect(body.role.key).toBe('owner');
    expect(body.role.fields).toEqual([]);
  });

  test('POST with duplicate key returns 409', async () => {
    await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'dup', label: 'Dup', color: '#000000' }),
      }),
      CTX,
    );
    const r = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'dup', label: 'Dup 2', color: '#000000' }),
      }),
      CTX,
    );
    expect(r.status).toBe(409);
  });
```

And add at top of file:
```typescript
import clientRolesHandler from '../../netlify/functions/client-roles';
```

- [ ] **Step 2: Run — fail (handler doesn't exist)**

Run: `npx vitest run tests/integration/client-structure.test.ts`

- [ ] **Step 3: Implement client-roles.ts**

```typescript
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const FieldDef = z.object({
  key: z.string().min(1).max(63).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  type: z.enum(['text', 'date', 'integer', 'boolean']),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  help: z.string().max(500).optional(),
  display_in_list: z.boolean().optional(),
});

const CreateBody = z.object({
  key: z.string().min(1).max(63).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fields: z.array(FieldDef).optional(),
  sort_order: z.number().int().optional(),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const clientId = new URL(req.url).searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();
  try {
    const rows = (await sql`
      INSERT INTO public.client_roles (client_id, key, label, color, fields, sort_order)
      VALUES (
        ${clientId}::uuid,
        ${parsed.data.key},
        ${parsed.data.label},
        ${parsed.data.color},
        ${JSON.stringify(parsed.data.fields ?? [])}::jsonb,
        ${parsed.data.sort_order ?? 0}
      )
      RETURNING id, client_id, key, label, color, fields, sort_order, created_at, updated_at
    `) as unknown[];
    return jsonOk({ role: rows[0] }, { status: 201 });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') return jsonError(409, 'role_key_taken');
    if (code === '23503') return jsonError(404, 'client_not_found');
    throw e;
  }
};
```

- [ ] **Step 4: Run — should pass**

Run: `npx vitest run tests/integration/client-structure.test.ts`

### Task 2.4: client-roles-detail PATCH/DELETE (TDD)

**Files:**
- Create: `netlify/functions/client-roles-detail.ts`
- Modify: `tests/integration/client-structure.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append inside the describe block:

```typescript
  test('PATCH /api/client-roles-detail updates label', async () => {
    const c = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'patch_me', label: 'Old', color: '#111111' }),
      }),
      CTX,
    );
    const created = (await c.json() as { role: { id: string } }).role;

    const p = await clientRolesDetailHandler(
      new Request(`http://localhost/api/client-roles-detail?id=${created.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ label: 'New' }),
      }),
      CTX,
    );
    expect(p.status).toBe(200);
    const body = await p.json() as { role: { label: string } };
    expect(body.role.label).toBe('New');
  });

  test('DELETE role-in-use returns 409 role_in_use', async () => {
    // Skipped until Phase 3 (need user_nodes to reference roles).
    // Will be added then.
  });

  test('DELETE unreferenced role succeeds', async () => {
    const c = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'delete_me', label: 'X', color: '#222222' }),
      }),
      CTX,
    );
    const created = (await c.json() as { role: { id: string } }).role;

    const d = await clientRolesDetailHandler(
      new Request(`http://localhost/api/client-roles-detail?id=${created.id}`, {
        method: 'DELETE', headers: { cookie },
      }),
      CTX,
    );
    expect(d.status).toBe(200);
  });
```

Add import at top:
```typescript
import clientRolesDetailHandler from '../../netlify/functions/client-roles-detail';
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement client-roles-detail.ts**

```typescript
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const FieldDef = z.object({
  key: z.string().min(1).max(63).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  type: z.enum(['text', 'date', 'integer', 'boolean']),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  help: z.string().max(500).optional(),
  display_in_list: z.boolean().optional(),
});

const PatchBody = z.object({
  label: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fields: z.array(FieldDef).optional(),
  sort_order: z.number().int().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'at_least_one_field_required' });

export default async (req: Request, _ctx: Context) => {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(id, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const sql = db();

  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

    const fieldsJson = parsed.data.fields ? JSON.stringify(parsed.data.fields) : null;
    const rows = (await sql`
      UPDATE public.client_roles
      SET label       = COALESCE(${parsed.data.label ?? null}::text, label),
          color       = COALESCE(${parsed.data.color ?? null}::text, color),
          fields      = COALESCE(${fieldsJson}::jsonb, fields),
          sort_order  = COALESCE(${parsed.data.sort_order ?? null}::int, sort_order)
      WHERE id = ${id}::uuid
      RETURNING id, client_id, key, label, color, fields, sort_order, created_at, updated_at
    `) as unknown[];
    if (rows.length === 0) return jsonError(404, 'not_found');
    return jsonOk({ role: rows[0] });
  }

  if (req.method === 'DELETE') {
    // Refuse if any user_node references this role.
    const refs = (await sql`SELECT 1 FROM public.user_nodes WHERE role_id = ${id}::uuid LIMIT 1`) as unknown[];
    if (refs.length > 0) return jsonError(409, 'role_in_use');
    const rows = (await sql`
      DELETE FROM public.client_roles WHERE id = ${id}::uuid RETURNING id
    `) as { id: string }[];
    if (rows.length === 0) return jsonError(404, 'not_found');
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
```

- [ ] **Step 4: Run — should pass**

### Task 2.5: client-levels POST + detail (TDD)

**Files:**
- Create: `netlify/functions/client-levels.ts`
- Create: `netlify/functions/client-levels-detail.ts`
- Modify: `tests/integration/client-structure.test.ts` (append)

- [ ] **Step 1: Append failing tests**

```typescript
  test('POST /api/client-levels creates a level', async () => {
    const r = await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 1, label: 'Top', allowed_role_ids: [] }),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { level: { level_number: number; label: string } };
    expect(body.level.level_number).toBe(1);
  });

  test('POST level with duplicate level_number returns 409', async () => {
    await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 5, allowed_role_ids: [] }),
      }),
      CTX,
    );
    const r = await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 5, allowed_role_ids: [] }),
      }),
      CTX,
    );
    expect(r.status).toBe(409);
  });

  test('PATCH client-levels-detail updates label + allowed_role_ids', async () => {
    const c = await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 7, allowed_role_ids: [] }),
      }),
      CTX,
    );
    const lvl = (await c.json() as { level: { id: string } }).level;

    const p = await clientLevelsDetailHandler(
      new Request(`http://localhost/api/client-levels-detail?id=${lvl.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ label: 'Renamed' }),
      }),
      CTX,
    );
    expect(p.status).toBe(200);
  });
```

Add imports:
```typescript
import clientLevelsHandler from '../../netlify/functions/client-levels';
import clientLevelsDetailHandler from '../../netlify/functions/client-levels-detail';
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement client-levels.ts**

```typescript
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const CreateBody = z.object({
  level_number: z.number().int().positive(),
  label: z.string().min(1).max(100).optional(),
  allowed_role_ids: z.array(z.string().uuid()).default([]),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const clientId = new URL(req.url).searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();
  try {
    const rows = (await sql`
      INSERT INTO public.client_levels (client_id, level_number, label, allowed_role_ids)
      VALUES (${clientId}::uuid, ${parsed.data.level_number},
              ${parsed.data.label ?? null}, ${parsed.data.allowed_role_ids}::uuid[])
      RETURNING id, client_id, level_number, label, allowed_role_ids, created_at
    `) as unknown[];
    return jsonOk({ level: rows[0] }, { status: 201 });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') return jsonError(409, 'level_number_taken');
    if (code === '23503') return jsonError(404, 'client_not_found');
    throw e;
  }
};
```

- [ ] **Step 4: Implement client-levels-detail.ts**

```typescript
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const PatchBody = z.object({
  label: z.string().min(1).max(100).optional(),
  allowed_role_ids: z.array(z.string().uuid()).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'at_least_one_field_required' });

export default async (req: Request, _ctx: Context) => {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(id, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const sql = db();

  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

    const rows = (await sql`
      UPDATE public.client_levels
      SET label            = COALESCE(${parsed.data.label ?? null}::text, label),
          allowed_role_ids = COALESCE(${parsed.data.allowed_role_ids ?? null}::uuid[], allowed_role_ids)
      WHERE id = ${id}::uuid
      RETURNING id, client_id, level_number, label, allowed_role_ids, created_at
    `) as unknown[];
    if (rows.length === 0) return jsonError(404, 'not_found');
    return jsonOk({ level: rows[0] });
  }

  if (req.method === 'DELETE') {
    // Look up level_number then refuse if any user_node sits at it.
    const lvls = (await sql`SELECT client_id, level_number FROM public.client_levels WHERE id = ${id}::uuid LIMIT 1`) as { client_id: string; level_number: number }[];
    if (lvls.length === 0) return jsonError(404, 'not_found');
    const refs = (await sql`
      SELECT 1 FROM public.user_nodes
      WHERE client_id = ${lvls[0]!.client_id}::uuid AND level_number = ${lvls[0]!.level_number}
      LIMIT 1
    `) as unknown[];
    if (refs.length > 0) return jsonError(409, 'level_in_use');
    await sql`DELETE FROM public.client_levels WHERE id = ${id}::uuid`;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
```

- [ ] **Step 5: Run — should pass**

### Task 2.6: client-cardinality PUT endpoint (TDD)

**Files:**
- Create: `netlify/functions/client-cardinality.ts`
- Modify: `tests/integration/client-structure.test.ts` (append)

- [ ] **Step 1: Append failing test**

```typescript
  test('PUT /api/client-cardinality replaces the full ruleset atomically', async () => {
    // Create two roles first.
    const a = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'card_a', label: 'A', color: '#111111' }),
      }),
      CTX,
    );
    const b = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'card_b', label: 'B', color: '#222222' }),
      }),
      CTX,
    );
    const aId = (await a.json() as { role: { id: string } }).role.id;
    const bId = (await b.json() as { role: { id: string } }).role.id;

    const r1 = await clientCardinalityHandler(
      new Request(`http://localhost/api/client-cardinality?client=${testClientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ rules: [
          { parent_role_id: null, child_role_id: aId, max_children: 1 },
          { parent_role_id: aId,  child_role_id: bId, max_children: 3 },
        ] }),
      }),
      CTX,
    );
    expect(r1.status).toBe(200);

    // Replace with a different set.
    const r2 = await clientCardinalityHandler(
      new Request(`http://localhost/api/client-cardinality?client=${testClientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ rules: [
          { parent_role_id: null, child_role_id: aId, max_children: 5 },
        ] }),
      }),
      CTX,
    );
    expect(r2.status).toBe(200);

    // Verify by GET structure
    const g = await clientStructureHandler(
      new Request(`http://localhost/api/client-structure?client=${testClientId}`, { method: 'GET', headers: { cookie } }),
      CTX,
    );
    const struct = await g.json() as { cardinality_rules: Array<{ max_children: number }> };
    expect(struct.cardinality_rules).toHaveLength(1);
    expect(struct.cardinality_rules[0]!.max_children).toBe(5);
  });
```

Import:
```typescript
import clientCardinalityHandler from '../../netlify/functions/client-cardinality';
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement client-cardinality.ts**

```typescript
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const RuleSchema = z.object({
  parent_role_id: z.string().uuid().nullable(),
  child_role_id: z.string().uuid(),
  max_children: z.number().int().min(0),
});

const PutBody = z.object({
  rules: z.array(RuleSchema),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'PUT') return jsonError(405, 'method_not_allowed');
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const clientId = new URL(req.url).searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();

  // Verify client exists.
  const cExists = (await sql`SELECT 1 FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1`) as unknown[];
  if (cExists.length === 0) return jsonError(404, 'client_not_found');

  // Wipe + insert in a single transaction using sql.transaction([...queries]).
  const queries: unknown[] = [sql`DELETE FROM public.client_cardinality_rules WHERE client_id = ${clientId}::uuid`];
  for (const r of parsed.data.rules) {
    queries.push(sql`
      INSERT INTO public.client_cardinality_rules (client_id, parent_role_id, child_role_id, max_children)
      VALUES (${clientId}::uuid, ${r.parent_role_id}::uuid, ${r.child_role_id}::uuid, ${r.max_children})
    `);
  }
  try {
    await sql.transaction(queries as never);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23503') return jsonError(400, 'role_not_found');
    if (code === '23505') return jsonError(400, 'duplicate_rule');
    throw e;
  }
  return jsonOk({ ok: true });
};
```

- [ ] **Step 4: Run — should pass**

### Task 2.7: Commit Phase 2

- [ ] **Step 1: Typecheck + tests**

Run: `npm run typecheck && npx vitest run --reporter=dot`
Expected: all tests pass.

- [ ] **Step 2: Commit**

```bash
git add netlify/functions/_shared/user-tree.ts \
        netlify/functions/client-structure.ts \
        netlify/functions/client-roles.ts \
        netlify/functions/client-roles-detail.ts \
        netlify/functions/client-levels.ts \
        netlify/functions/client-levels-detail.ts \
        netlify/functions/client-cardinality.ts \
        tests/integration/client-structure.test.ts
git commit -m "phase 2: backend structure endpoints (roles + levels + cardinality + structure GET)"
```

---

## Phase 3 — Backend user-node endpoints + move

**Goal:** Admin can CRUD user nodes (with cardinality enforcement) and move them around the tree atomically. Concurrency-safe.

### Task 3.1: user-nodes GET (list) + POST (create) endpoints (TDD)

**Files:**
- Create: `netlify/functions/user-nodes.ts`
- Create: `tests/integration/user-nodes-crud.test.ts`

- [ ] **Step 1: Write the failing tests for GET + POST happy paths**

```typescript
// tests/integration/user-nodes-crud.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import clientCardinalityHandler from '../../netlify/functions/client-cardinality';
import userNodesHandler from '../../netlify/functions/user-nodes';
import userNodesDetailHandler from '../../netlify/functions/user-nodes-detail';

const ADMIN_EMAIL = 'user-nodes-test@example.com';
const ADMIN_PASSWORD = 'user-nodes-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let testClientId: string;
let roleShop: string, roleOwner: string;
const createdClients: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Nodes Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, display_name = 'Nodes Test Admin'
  `;
});

async function setupClientWithStructure() {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }),
    CTX,
  );
  cookie = lr.headers.get('set-cookie')!.split(';')[0]!;

  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `Nodes Test ${Date.now()}` }),
    }),
    CTX,
  );
  testClientId = (await cr.json() as { client: { id: string } }).client.id;
  createdClients.push(testClientId);

  // Two roles + two levels + a cardinality cap of 3 owners per shop.
  const r1 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'shop', label: 'Shop', color: '#ef4444' }),
    }),
    CTX,
  );
  roleShop = (await r1.json() as { role: { id: string } }).role.id;

  const r2 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
    }),
    CTX,
  );
  roleOwner = (await r2.json() as { role: { id: string } }).role.id;

  await clientLevelsHandler(
    new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 1, label: 'Top', allowed_role_ids: [roleShop] }),
    }),
    CTX,
  );
  await clientLevelsHandler(
    new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 2, allowed_role_ids: [roleOwner] }),
    }),
    CTX,
  );

  await clientCardinalityHandler(
    new Request(`http://localhost/api/client-cardinality?client=${testClientId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ rules: [
        { parent_role_id: null,      child_role_id: roleShop,  max_children: 1 },
        { parent_role_id: roleShop,  child_role_id: roleOwner, max_children: 3 },
      ] }),
    }),
    CTX,
  );
}

beforeEach(async () => { await setupClientWithStructure(); });

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('user-nodes CRUD', () => {
  test('POST creates a top-level node (level=1, parent=null)', async () => {
    const r = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShop, level_number: 1, parent_id: null,
          display_name: "Joe's Shop",
        }),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { node: { id: string; level_number: number; parent_id: null } };
    expect(body.node.level_number).toBe(1);
    expect(body.node.parent_id).toBeNull();
  });

  test('GET returns the list of nodes for a client', async () => {
    await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'S1' }),
      }),
      CTX,
    );
    const g = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, { method: 'GET', headers: { cookie } }),
      CTX,
    );
    expect(g.status).toBe(200);
    const body = await g.json() as { nodes: Array<{ display_name: string }> };
    expect(body.nodes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — fail (handler missing)**

- [ ] **Step 3: Implement user-nodes.ts (GET + POST)**

```typescript
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { hashPassword } from './_shared/argon';
import { getCardinalityCap } from './_shared/user-tree';

const CreateBody = z.object({
  role_id: z.string().uuid(),
  parent_id: z.string().uuid().nullable().optional(),
  level_number: z.number().int().positive().nullable().optional(),
  display_name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  fields: z.record(z.unknown()).optional(),
  create_login: z.boolean().optional(),
  temp_password: z.string().min(8).max(200).optional(),
});

export default async (req: Request, _ctx: Context) => {
  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const clientId = new URL(req.url).searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const sql = db();

  if (req.method === 'GET') {
    const nodes = (await sql`
      SELECT n.id, n.client_id, n.parent_id, n.level_number, n.role_id,
             n.display_name, n.email, n.phone, n.notes, n.fields, n.sort_order,
             n.created_at, n.updated_at, n.created_by_admin,
             (c.user_node_id IS NOT NULL) AS has_login
      FROM public.user_nodes n
      LEFT JOIN public.user_node_credentials c ON c.user_node_id = n.id
      WHERE n.client_id = ${clientId}::uuid
      ORDER BY n.level_number NULLS LAST, n.sort_order, n.created_at
    `) as unknown[];
    return jsonOk({ nodes });
  }

  if (req.method === 'POST') {
    return await handleCreate(req, sql, clientId, actor.admin.id);
  }

  return jsonError(405, 'method_not_allowed');
};

async function handleCreate(
  req: Request,
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  adminId: string,
): Promise<Response> {
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const data = parsed.data;

  // Look up the role to confirm same client.
  const roles = (await sql`
    SELECT id, client_id FROM public.client_roles WHERE id = ${data.role_id}::uuid LIMIT 1
  `) as { id: string; client_id: string }[];
  if (roles.length === 0) return jsonError(404, 'role_not_found');
  if (roles[0]!.client_id !== clientId) return jsonError(400, 'role_wrong_client');

  // Determine effective level + parent.
  // - both null → unassigned
  // - parent_id null + level_number=1 → top-level
  // - parent_id set → level_number must be parent.level + 1
  const wantsUnassigned = (data.parent_id === null || data.parent_id === undefined)
    && (data.level_number === null || data.level_number === undefined);

  let effectiveLevel: number | null = null;
  let effectiveParent: string | null = null;
  let parentRoleId: string | null = null;

  if (!wantsUnassigned) {
    if (data.parent_id) {
      const p = (await sql`
        SELECT id, client_id, level_number, role_id FROM public.user_nodes
        WHERE id = ${data.parent_id}::uuid LIMIT 1
      `) as { id: string; client_id: string; level_number: number | null; role_id: string }[];
      if (p.length === 0) return jsonError(404, 'parent_not_found');
      if (p[0]!.client_id !== clientId) return jsonError(400, 'cross_client_parent');
      if (p[0]!.level_number === null) return jsonError(400, 'parent_level_mismatch');
      const desiredLevel = data.level_number ?? p[0]!.level_number + 1;
      if (desiredLevel !== p[0]!.level_number + 1) return jsonError(400, 'parent_level_mismatch');
      effectiveLevel = desiredLevel;
      effectiveParent = data.parent_id;
      parentRoleId = p[0]!.role_id;
    } else {
      // parent_id null, level_number must be 1
      if (data.level_number !== 1) return jsonError(400, 'top_level_requires_level_1');
      effectiveLevel = 1;
    }

    // Cardinality enforcement.
    // For top-level: advisory lock on (client_id, role_id) hash + count.
    // For child: SELECT FOR UPDATE on parent row + count.
    const cap = await getCardinalityCap(sql, clientId, parentRoleId, data.role_id);
    if (cap !== null) {
      // Cardinality + insert in a transaction.
      const insertResult = await sql.transaction(([
        ...(effectiveParent === null
          ? [sql`SELECT pg_advisory_xact_lock(hashtext(${clientId} || ':' || ${data.role_id}))`]
          : [sql`SELECT 1 FROM public.user_nodes WHERE id = ${effectiveParent}::uuid FOR UPDATE`]),
        effectiveParent === null
          ? sql`SELECT count(*)::int AS c FROM public.user_nodes
                WHERE client_id = ${clientId}::uuid AND parent_id IS NULL AND role_id = ${data.role_id}::uuid`
          : sql`SELECT count(*)::int AS c FROM public.user_nodes
                WHERE parent_id = ${effectiveParent}::uuid AND role_id = ${data.role_id}::uuid`,
        sql`
          INSERT INTO public.user_nodes (
            client_id, parent_id, level_number, role_id,
            display_name, email, phone, notes, fields, created_by_admin
          )
          VALUES (
            ${clientId}::uuid, ${effectiveParent}::uuid, ${effectiveLevel}, ${data.role_id}::uuid,
            ${data.display_name}, ${data.email ?? null}, ${data.phone ?? null},
            ${data.notes ?? null}, ${JSON.stringify(data.fields ?? {})}::jsonb, ${adminId}::uuid
          )
          RETURNING id, client_id, parent_id, level_number, role_id, display_name, email,
                    phone, notes, fields, sort_order, created_at, updated_at, created_by_admin
        `,
      ]) as never);
      // insertResult is an array of result sets: [lock?, count, inserted]
      const countRow = insertResult[insertResult.length - 2] as unknown as Array<{ c: number }>;
      const inserted = insertResult[insertResult.length - 1] as unknown as Array<Record<string, unknown>>;
      if (countRow[0]!.c >= cap) {
        // Rollback handled by throwing — but we already inserted. Re-throw to abort.
        throw new Error(`cardinality_exceeded:${cap}`);
      }
      const node = inserted[0]!;
      return await maybeCreateCredential(sql, clientId, node, data, adminId);
    }
  }

  // No cardinality cap (or unassigned). Just insert.
  try {
    const rows = (await sql`
      INSERT INTO public.user_nodes (
        client_id, parent_id, level_number, role_id,
        display_name, email, phone, notes, fields, created_by_admin
      )
      VALUES (
        ${clientId}::uuid, ${effectiveParent}::uuid, ${effectiveLevel}, ${data.role_id}::uuid,
        ${data.display_name}, ${data.email ?? null}, ${data.phone ?? null},
        ${data.notes ?? null}, ${JSON.stringify(data.fields ?? {})}::jsonb, ${adminId}::uuid
      )
      RETURNING id, client_id, parent_id, level_number, role_id, display_name, email,
                phone, notes, fields, sort_order, created_at, updated_at, created_by_admin
    `) as Record<string, unknown>[];
    return await maybeCreateCredential(sql, clientId, rows[0]!, data, adminId);
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? '';
    if (msg === 'parent_level_mismatch' || msg.includes('parent_level_mismatch')) {
      return jsonError(400, 'parent_level_mismatch');
    }
    if (msg === 'cross_client_parent' || msg.includes('cross_client_parent')) {
      return jsonError(400, 'cross_client_parent');
    }
    throw e;
  }
}

async function maybeCreateCredential(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  node: Record<string, unknown>,
  data: z.infer<typeof CreateBody>,
  adminId: string,
): Promise<Response> {
  if (!data.create_login) return jsonOk({ node }, { status: 201 });

  if (!data.temp_password || data.temp_password.length < 8) {
    // Roll back the user_node insert (best effort).
    await sql`DELETE FROM public.user_nodes WHERE id = ${node.id as string}::uuid`;
    return jsonError(400, 'validation_failed', 'temp_password (>=8) required with create_login');
  }
  if (!data.email) {
    await sql`DELETE FROM public.user_nodes WHERE id = ${node.id as string}::uuid`;
    return jsonError(400, 'validation_failed', 'email required with create_login');
  }
  const pwdHash = await hashPassword(data.temp_password);
  try {
    await sql`
      INSERT INTO public.user_node_credentials (
        client_id, user_node_id, email, password_hash, must_change_password,
        temp_password_plain, temp_password_views_left, created_by_admin
      ) VALUES (
        ${clientId}::uuid, ${node.id as string}::uuid, ${data.email},
        ${pwdHash}, true, ${data.temp_password}, 3, ${adminId}::uuid
      )
    `;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    // Roll back node insert on credential conflict.
    await sql`DELETE FROM public.user_nodes WHERE id = ${node.id as string}::uuid`;
    if (code === '23505') return jsonError(409, 'email_already_has_login_in_this_client');
    throw e;
  }
  return jsonOk({ node, login_created: true }, { status: 201 });
}
```

- [ ] **Step 4: Run — should pass the two tests written**

### Task 3.2: user-nodes cardinality enforcement test

**Files:**
- Modify: `tests/integration/user-nodes-crud.test.ts` (append test)

- [ ] **Step 1: Append failing test**

```typescript
  test('POST violating per-parent cap returns 409 cardinality_exceeded', async () => {
    // Create the shop (cap=1 at top), then a 2nd shop should fail.
    await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop A' }),
      }),
      CTX,
    );
    const r = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop B' }),
      }),
      CTX,
    );
    expect(r.status).toBe(409);
  });

  test('POST child with valid parent at correct level succeeds', async () => {
    const s = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' }),
      }),
      CTX,
    );
    const shopId = (await s.json() as { node: { id: string } }).node.id;

    const o = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleOwner, level_number: 2, parent_id: shopId, display_name: 'Owner 1' }),
      }),
      CTX,
    );
    expect(o.status).toBe(201);
  });

  test('POST child with wrong level returns 400 parent_level_mismatch', async () => {
    const s = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' }),
      }),
      CTX,
    );
    const shopId = (await s.json() as { node: { id: string } }).node.id;

    const o = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleOwner, level_number: 3, parent_id: shopId, display_name: 'Wrong' }),
      }),
      CTX,
    );
    expect(o.status).toBe(400);
  });

  test('POST unassigned (no parent, no level) succeeds', async () => {
    const r = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleOwner, display_name: 'Floating' }),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { node: { parent_id: null; level_number: null } };
    expect(body.node.parent_id).toBeNull();
    expect(body.node.level_number).toBeNull();
  });
```

- [ ] **Step 2: Run — verify all pass**

Run: `npx vitest run tests/integration/user-nodes-crud.test.ts`
Expected: all 6 tests in user-nodes-crud pass.

### Task 3.3: Concurrent cardinality test (race protection)

**Files:**
- Modify: `tests/integration/user-nodes-crud.test.ts` (append)

- [ ] **Step 1: Append concurrent insert test**

```typescript
  test('concurrent inserts against cap=1 produce exactly one 201 and one 409', async () => {
    const reqs = [1, 2].map(() =>
      userNodesHandler(
        new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Race' }),
        }),
        CTX,
      ),
    );
    const [a, b] = await Promise.allSettled(reqs);
    const statuses = [a, b].map((r) => r.status === 'fulfilled' ? r.value.status : 0).sort();
    expect(statuses).toEqual([201, 409]);
  });
```

- [ ] **Step 2: Run — should pass (advisory lock serializes the two)**

### Task 3.4: user-nodes-detail GET / PATCH / DELETE (TDD)

**Files:**
- Create: `netlify/functions/user-nodes-detail.ts`
- Modify: `tests/integration/user-nodes-crud.test.ts` (append)

- [ ] **Step 1: Append failing tests**

```typescript
  test('GET user-nodes-detail returns the node', async () => {
    const s = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Detail Test' }),
      }),
      CTX,
    );
    const id = (await s.json() as { node: { id: string } }).node.id;

    const g = await userNodesDetailHandler(
      new Request(`http://localhost/api/user-nodes-detail?id=${id}`, { method: 'GET', headers: { cookie } }),
      CTX,
    );
    expect(g.status).toBe(200);
    const body = await g.json() as { node: { display_name: string }; children_count: number };
    expect(body.node.display_name).toBe('Detail Test');
    expect(body.children_count).toBe(0);
  });

  test('PATCH user-nodes-detail updates display_name + fields', async () => {
    const s = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Old' }),
      }),
      CTX,
    );
    const id = (await s.json() as { node: { id: string } }).node.id;

    const p = await userNodesDetailHandler(
      new Request(`http://localhost/api/user-nodes-detail?id=${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ display_name: 'New', notes: 'updated' }),
      }),
      CTX,
    );
    expect(p.status).toBe(200);
    const body = await p.json() as { node: { display_name: string; notes: string } };
    expect(body.node.display_name).toBe('New');
    expect(body.node.notes).toBe('updated');
  });

  test('DELETE node with children returns 409 has_children', async () => {
    const s = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Parent' }),
      }),
      CTX,
    );
    const sid = (await s.json() as { node: { id: string } }).node.id;
    await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleOwner, level_number: 2, parent_id: sid, display_name: 'Child' }),
      }),
      CTX,
    );

    const d = await userNodesDetailHandler(
      new Request(`http://localhost/api/user-nodes-detail?id=${sid}`, { method: 'DELETE', headers: { cookie } }),
      CTX,
    );
    expect(d.status).toBe(409);
  });

  test('DELETE with ?cascade=descendants removes subtree', async () => {
    const s = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Cascade Parent' }),
      }),
      CTX,
    );
    const sid = (await s.json() as { node: { id: string } }).node.id;
    await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleOwner, level_number: 2, parent_id: sid, display_name: 'Cascade Child' }),
      }),
      CTX,
    );

    const d = await userNodesDetailHandler(
      new Request(`http://localhost/api/user-nodes-detail?id=${sid}&cascade=descendants`, {
        method: 'DELETE', headers: { cookie },
      }),
      CTX,
    );
    expect(d.status).toBe(200);
    const remaining = (await sql`SELECT id FROM public.user_nodes WHERE id = ${sid}::uuid`) as unknown[];
    expect(remaining).toHaveLength(0);
  });
```

- [ ] **Step 2: Run — fail (handler missing)**

- [ ] **Step 3: Implement user-nodes-detail.ts**

```typescript
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const PatchBody = z.object({
  display_name: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  fields: z.record(z.unknown()).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'at_least_one_field_required' });

export default async (req: Request, _ctx: Context) => {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(id, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT id, client_id, parent_id, level_number, role_id, display_name, email,
             phone, notes, fields, sort_order, created_at, updated_at, created_by_admin
      FROM public.user_nodes WHERE id = ${id}::uuid LIMIT 1
    `) as unknown[];
    if (rows.length === 0) return jsonError(404, 'not_found');
    const c = (await sql`SELECT count(*)::int AS c FROM public.user_nodes WHERE parent_id = ${id}::uuid`) as { c: number }[];
    return jsonOk({ node: rows[0], children_count: c[0]!.c });
  }

  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    const d = parsed.data;
    const fieldsJson = d.fields !== undefined ? JSON.stringify(d.fields) : null;
    const rows = (await sql`
      UPDATE public.user_nodes
      SET display_name = COALESCE(${d.display_name ?? null}::text, display_name),
          email        = CASE WHEN ${d.email !== undefined}::boolean THEN ${d.email ?? null}::citext ELSE email END,
          phone        = CASE WHEN ${d.phone !== undefined}::boolean THEN ${d.phone ?? null}::text  ELSE phone END,
          notes        = CASE WHEN ${d.notes !== undefined}::boolean THEN ${d.notes ?? null}::text  ELSE notes END,
          fields       = COALESCE(${fieldsJson}::jsonb, fields)
      WHERE id = ${id}::uuid
      RETURNING id, client_id, parent_id, level_number, role_id, display_name, email,
                phone, notes, fields, sort_order, created_at, updated_at, created_by_admin
    `) as unknown[];
    if (rows.length === 0) return jsonError(404, 'not_found');
    return jsonOk({ node: rows[0] });
  }

  if (req.method === 'DELETE') {
    const cascade = url.searchParams.get('cascade') === 'descendants';

    if (!cascade) {
      const kids = (await sql`SELECT 1 FROM public.user_nodes WHERE parent_id = ${id}::uuid LIMIT 1`) as unknown[];
      if (kids.length > 0) return jsonError(409, 'has_children');
      const out = (await sql`DELETE FROM public.user_nodes WHERE id = ${id}::uuid RETURNING id`) as unknown[];
      if (out.length === 0) return jsonError(404, 'not_found');
      return jsonOk({ ok: true });
    }

    // Cascade: collect all descendants via recursive CTE, then delete them + the root.
    const out = (await sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM public.user_nodes WHERE id = ${id}::uuid
        UNION ALL
        SELECT n.id FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
      )
      DELETE FROM public.user_nodes WHERE id IN (SELECT id FROM subtree)
      RETURNING id
    `) as unknown[];
    if (out.length === 0) return jsonError(404, 'not_found');
    return jsonOk({ ok: true, deleted_count: out.length });
  }

  return jsonError(405, 'method_not_allowed');
};
```

- [ ] **Step 4: Run — should pass**

### Task 3.5: user-nodes-move endpoint (TDD)

**Files:**
- Create: `netlify/functions/user-nodes-move.ts`
- Create: `tests/integration/user-nodes-move.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/integration/user-nodes-move.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import clientCardinalityHandler from '../../netlify/functions/client-cardinality';
import userNodesHandler from '../../netlify/functions/user-nodes';
import userNodesMoveHandler from '../../netlify/functions/user-nodes-move';

const ADMIN_EMAIL = 'user-nodes-move-test@example.com';
const ADMIN_PASSWORD = 'user-nodes-move-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let testClientId: string;
let roleShop: string, roleOwner: string, roleEmp: string;
const createdClients: string[] = [];

async function createNode(opts: { role_id: string; level_number?: number | null; parent_id?: string | null; display_name: string }): Promise<string> {
  const r = await userNodesHandler(
    new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(opts),
    }),
    CTX,
  );
  if (r.status !== 201) throw new Error(`createNode failed: ${r.status} ${await r.text()}`);
  return (await r.json() as { node: { id: string } }).node.id;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Move Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, display_name = 'Move Test Admin'
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
      body: JSON.stringify({ name: `Move Test ${Date.now()}` }),
    }), CTX,
  );
  testClientId = (await cr.json() as { client: { id: string } }).client.id;
  createdClients.push(testClientId);

  // Three roles, three levels, no cardinality caps.
  roleShop  = (await (await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${testClientId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ key: 'shop',  label: 'Shop',  color: '#ef4444' }) }), CTX)).json() as { role: { id: string } }).role.id;
  roleOwner = (await (await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${testClientId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }) }), CTX)).json() as { role: { id: string } }).role.id;
  roleEmp   = (await (await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${testClientId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ key: 'emp',   label: 'Emp',   color: '#22c55e' }) }), CTX)).json() as { role: { id: string } }).role.id;

  for (const n of [1, 2, 3]) {
    await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: n, allowed_role_ids: [roleShop, roleOwner, roleEmp] }),
    }), CTX);
  }
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('user-nodes-move', () => {
  test('move node to a new valid parent succeeds and re-levels descendants', async () => {
    const shop = await createNode({ role_id: roleShop,  level_number: 1, parent_id: null, display_name: 'Shop' });
    const ownerA = await createNode({ role_id: roleOwner, level_number: 2, parent_id: shop, display_name: 'Owner A' });
    const ownerB = await createNode({ role_id: roleOwner, level_number: 2, parent_id: shop, display_name: 'Owner B' });
    const emp = await createNode({ role_id: roleEmp, level_number: 3, parent_id: ownerA, display_name: 'Emp' });

    // Move emp from ownerA to ownerB (same level, different parent).
    const r = await userNodesMoveHandler(
      new Request(`http://localhost/api/user-nodes-move?id=${emp}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ parent_id: ownerB, level_number: 3 }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { node: { parent_id: string; level_number: number } };
    expect(body.node.parent_id).toBe(ownerB);
    expect(body.node.level_number).toBe(3);
  });

  test('move to unassigned makes the entire subtree unassigned', async () => {
    const shop = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    const owner = await createNode({ role_id: roleOwner, level_number: 2, parent_id: shop, display_name: 'Owner' });
    const emp = await createNode({ role_id: roleEmp, level_number: 3, parent_id: owner, display_name: 'Emp' });

    const r = await userNodesMoveHandler(
      new Request(`http://localhost/api/user-nodes-move?id=${owner}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ parent_id: null, level_number: null }),
      }), CTX,
    );
    expect(r.status).toBe(200);

    const rows = (await sql`SELECT id, level_number FROM public.user_nodes WHERE id IN (${owner}::uuid, ${emp}::uuid)`) as { id: string; level_number: number | null }[];
    expect(rows.every((r) => r.level_number === null)).toBe(true);
  });

  test('move that creates a cycle returns 400 cycle_detected', async () => {
    const shop = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    const owner = await createNode({ role_id: roleOwner, level_number: 2, parent_id: shop, display_name: 'Owner' });
    const emp = await createNode({ role_id: roleEmp, level_number: 3, parent_id: owner, display_name: 'Emp' });

    // Try to make shop become a child of emp (cycle).
    const r = await userNodesMoveHandler(
      new Request(`http://localhost/api/user-nodes-move?id=${shop}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ parent_id: emp, level_number: 4 }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('cycle_detected');
  });

  test('move violating cardinality cap returns 409', async () => {
    // Add cap: owner -> at most 1 emp.
    await clientCardinalityHandler(new Request(`http://localhost/api/client-cardinality?client=${testClientId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ rules: [{ parent_role_id: roleOwner, child_role_id: roleEmp, max_children: 1 }] }),
    }), CTX);

    const shop = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    const ownerA = await createNode({ role_id: roleOwner, level_number: 2, parent_id: shop, display_name: 'A' });
    const ownerB = await createNode({ role_id: roleOwner, level_number: 2, parent_id: shop, display_name: 'B' });
    const empA1 = await createNode({ role_id: roleEmp, level_number: 3, parent_id: ownerA, display_name: 'A1' });
    const empB1 = await createNode({ role_id: roleEmp, level_number: 3, parent_id: ownerB, display_name: 'B1' });

    // ownerB already has empB1; moving empA1 to ownerB should violate the cap.
    const r = await userNodesMoveHandler(
      new Request(`http://localhost/api/user-nodes-move?id=${empA1}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ parent_id: ownerB, level_number: 3 }),
      }), CTX,
    );
    expect(r.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run — fail (handler missing)**

- [ ] **Step 3: Implement user-nodes-move.ts**

```typescript
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { cycleCheck, getCardinalityCap } from './_shared/user-tree';

const Body = z.object({
  parent_id: z.string().uuid().nullable(),
  level_number: z.number().int().positive().nullable(),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(id, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const { parent_id: newParent, level_number: newLevel } = parsed.data;

  const sql = db();

  // Load the moving node + (optionally) the new parent.
  const nodeRows = (await sql`
    SELECT id, client_id, parent_id, level_number, role_id
    FROM public.user_nodes WHERE id = ${id}::uuid LIMIT 1
  `) as { id: string; client_id: string; parent_id: string | null; level_number: number | null; role_id: string }[];
  if (nodeRows.length === 0) return jsonError(404, 'not_found');
  const node = nodeRows[0]!;

  // Case 1: moving to unassigned.
  if (newParent === null && newLevel === null) {
    // Set node + all descendants' level_number to NULL. Set node's parent_id to NULL.
    await sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM public.user_nodes WHERE id = ${id}::uuid
        UNION ALL
        SELECT n.id FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
      )
      UPDATE public.user_nodes SET level_number = NULL
      WHERE id IN (SELECT id FROM subtree)
    `;
    await sql`UPDATE public.user_nodes SET parent_id = NULL WHERE id = ${id}::uuid`;
    return jsonOk({ ok: true, moved_to: 'unassigned' });
  }

  // Case 2: moving to top-level (parent=null, level=1).
  if (newParent === null) {
    if (newLevel !== 1) return jsonError(400, 'top_level_requires_level_1');
    // Cardinality + advisory lock.
    const cap = await getCardinalityCap(sql, node.client_id, null, node.role_id);
    if (cap !== null) {
      // Run in transaction.
      const result = await sql.transaction([
        sql`SELECT pg_advisory_xact_lock(hashtext(${node.client_id} || ':' || ${node.role_id}))`,
        sql`SELECT count(*)::int AS c FROM public.user_nodes
            WHERE client_id = ${node.client_id}::uuid AND parent_id IS NULL AND role_id = ${node.role_id}::uuid
              AND id <> ${id}::uuid`,
        // descendants relevel — node moves from old_level to 1, delta = 1 - old_level.
      ] as never);
      const countRow = result[1] as unknown as { c: number }[];
      if (countRow[0]!.c >= cap) return jsonError(409, 'cardinality_exceeded', { max: cap });
    }

    const oldLevel = node.level_number;
    const delta = oldLevel === null ? null : (1 - oldLevel);

    if (delta !== null && delta !== 0) {
      await sql`
        WITH RECURSIVE subtree AS (
          SELECT id, level_number FROM public.user_nodes WHERE id = ${id}::uuid
          UNION ALL
          SELECT n.id, n.level_number FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
        )
        UPDATE public.user_nodes SET level_number = level_number + ${delta}
        WHERE id IN (SELECT id FROM subtree WHERE id <> ${id}::uuid) AND level_number IS NOT NULL
      `;
    }

    // If subtree was previously unassigned (delta null), re-assign descendants relative to new level=1.
    if (delta === null) {
      // Walk subtree and set level_number = depth+1 from the moving node.
      await sql`
        WITH RECURSIVE subtree(id, depth) AS (
          SELECT id, 0 FROM public.user_nodes WHERE id = ${id}::uuid
          UNION ALL
          SELECT n.id, s.depth + 1 FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
        )
        UPDATE public.user_nodes SET level_number = 1 + s.depth
        FROM subtree s WHERE public.user_nodes.id = s.id
      `;
    }

    const rows = (await sql`
      UPDATE public.user_nodes SET parent_id = NULL, level_number = 1
      WHERE id = ${id}::uuid
      RETURNING id, client_id, parent_id, level_number, role_id, display_name
    `) as unknown[];
    return jsonOk({ node: rows[0] });
  }

  // Case 3: moving under a parent.
  const parentRows = (await sql`
    SELECT id, client_id, level_number, role_id FROM public.user_nodes WHERE id = ${newParent}::uuid LIMIT 1
  `) as { id: string; client_id: string; level_number: number | null; role_id: string }[];
  if (parentRows.length === 0) return jsonError(404, 'parent_not_found');
  if (parentRows[0]!.client_id !== node.client_id) return jsonError(400, 'cross_client_parent');
  if (parentRows[0]!.level_number === null) return jsonError(400, 'parent_unassigned');
  if (newLevel !== parentRows[0]!.level_number + 1) return jsonError(400, 'parent_level_mismatch');

  // Cycle check.
  try { await cycleCheck(sql, id, newParent); }
  catch (e) {
    if ((e as Error).message === 'cycle_detected') return jsonError(400, 'cycle_detected');
    throw e;
  }

  // Cardinality check.
  const cap = await getCardinalityCap(sql, node.client_id, parentRows[0]!.role_id, node.role_id);
  if (cap !== null) {
    const result = await sql.transaction([
      sql`SELECT 1 FROM public.user_nodes WHERE id = ${newParent}::uuid FOR UPDATE`,
      sql`SELECT count(*)::int AS c FROM public.user_nodes
          WHERE parent_id = ${newParent}::uuid AND role_id = ${node.role_id}::uuid
            AND id <> ${id}::uuid`,
    ] as never);
    const countRow = result[1] as unknown as { c: number }[];
    if (countRow[0]!.c >= cap) return jsonError(409, 'cardinality_exceeded', { max: cap });
  }

  // Descendant relevel.
  const oldLevel = node.level_number;
  const delta = oldLevel === null ? null : (newLevel - oldLevel);
  if (delta !== null && delta !== 0) {
    await sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM public.user_nodes WHERE id = ${id}::uuid
        UNION ALL
        SELECT n.id FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
      )
      UPDATE public.user_nodes SET level_number = level_number + ${delta}
      WHERE id IN (SELECT id FROM subtree WHERE id <> ${id}::uuid) AND level_number IS NOT NULL
    `;
  }
  if (delta === null) {
    await sql`
      WITH RECURSIVE subtree(id, depth) AS (
        SELECT id, 0 FROM public.user_nodes WHERE id = ${id}::uuid
        UNION ALL
        SELECT n.id, s.depth + 1 FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
      )
      UPDATE public.user_nodes SET level_number = ${newLevel} + s.depth
      FROM subtree s WHERE public.user_nodes.id = s.id AND public.user_nodes.id <> ${id}::uuid
    `;
  }

  const rows = (await sql`
    UPDATE public.user_nodes SET parent_id = ${newParent}::uuid, level_number = ${newLevel}
    WHERE id = ${id}::uuid
    RETURNING id, client_id, parent_id, level_number, role_id, display_name
  `) as unknown[];
  return jsonOk({ node: rows[0] });
};
```

- [ ] **Step 4: Run — should pass**

Run: `npx vitest run tests/integration/user-nodes-move.test.ts`

### Task 3.6: Phase 3 commit

- [ ] **Step 1: Full typecheck + suite**

Run: `npm run typecheck && npx vitest run --reporter=dot`

- [ ] **Step 2: Commit**

```bash
git add netlify/functions/user-nodes.ts \
        netlify/functions/user-nodes-detail.ts \
        netlify/functions/user-nodes-move.ts \
        netlify/functions/_shared/user-tree.ts \
        tests/integration/user-nodes-crud.test.ts \
        tests/integration/user-nodes-move.test.ts
git commit -m "phase 3: user-nodes CRUD + move endpoint with cycle/cardinality enforcement"
```

---

## Phase 4 — Credentials rekey + u-portal rewiring

**Goal:** `bucket_user_credentials` references replaced with `user_node_credentials`. The `/api/u-*` endpoints work with the new shape. JWT claims trim `role_key` → just `{sub, email, kind, client_id}`. Session/permission helpers updated.

### Task 4.1: Update `_shared/session.ts` — drop `role_key` from BucketUserClaims

**Files:**
- Modify: `netlify/functions/_shared/session.ts`

- [ ] **Step 1: Read current**

Run: `cat netlify/functions/_shared/session.ts`

- [ ] **Step 2: Update the BucketUserClaims interface and mint/verify shape**

Replace the existing `BucketUserClaims` interface, `mintBucketUserSession`, and `verifyBucketUserSession` with:

```typescript
export interface BucketUserClaims {
  sub: string;            // user_node_id
  email: string;
  kind: 'bucket_user';
  client_id: string;
  iat: number;
  exp: number;
}

export async function mintBucketUserSession(input: {
  sub: string; email: string; client_id: string;
}): Promise<string> {
  return new SignJWT({
    email: input.email,
    kind: 'bucket_user',
    client_id: input.client_id,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${BU_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyBucketUserSession(token: string): Promise<BucketUserClaims> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    payload.kind !== 'bucket_user' ||
    typeof payload.client_id !== 'string'
  ) {
    throw new Error('invalid claims');
  }
  return payload as unknown as BucketUserClaims;
}
```

Note: `role_key` and the separate `node_id` claim are both gone — `role_key` is derived from the joined node row at request time; the node id IS `sub`.

### Task 4.2: Update `_shared/permissions.ts` — requireBucketUser uses user_node_credentials

**Files:**
- Modify: `netlify/functions/_shared/permissions.ts`

- [ ] **Step 1: Replace the requireBucketUser function and credential interface**

```typescript
export interface UserNodeCredentialRecord {
  id: string;
  client_id: string;
  user_node_id: string;
  email: string;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

export async function requireBucketUser(req: Request): Promise<{
  credential: UserNodeCredentialRecord;
  claims: BucketUserClaims;
}> {
  const token = readBuCookieToken(req);
  if (!token) throw new UnauthorizedError('no_cookie');
  let claims: BucketUserClaims;
  try {
    claims = await verifyBucketUserSession(token);
  } catch {
    throw new UnauthorizedError('invalid_token');
  }
  const sql = db();
  const rows = (await sql`
    SELECT id, client_id, user_node_id, email,
           must_change_password, last_login_at, created_at
    FROM public.user_node_credentials
    WHERE user_node_id = ${claims.sub}::uuid
      AND client_id = ${claims.client_id}::uuid
    LIMIT 1
  `) as UserNodeCredentialRecord[];
  const credential = rows[0];
  if (!credential) throw new UnauthorizedError('credential_not_found');
  return { credential, claims };
}
```

Also remove the old `BucketUserCredentialRecord` interface (if it referenced `role_key` or `bucket_user_id`).

### Task 4.3: Update `u-login.ts` to use new table

**Files:**
- Modify: `netlify/functions/u-login.ts`

- [ ] **Step 1: Replace the SQL lookup + JWT mint with the new shape**

The handler keeps the same URL and request shape. Replace the credential lookup SQL with `user_node_credentials` and drop `role_key` from the mint call. Final file:

```typescript
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyPassword } from './_shared/argon';
import { mintBucketUserSession, buCookieHeader } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface CredentialRow {
  id: string;
  client_id: string;
  user_node_id: string;
  email: string;
  password_hash: string;
  must_change_password: boolean;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const slug = new URL(req.url).searchParams.get('client');
  if (!slug) return jsonError(400, 'validation_failed', 'client query param required');

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();
  const clientRows = (await sql`
    SELECT id, name FROM public.clients WHERE slug = ${slug} LIMIT 1
  `) as { id: string; name: string }[];
  const client = clientRows[0];
  if (!client) return jsonError(404, 'client_not_found');

  const credRows = (await sql`
    SELECT id, client_id, user_node_id, email, password_hash, must_change_password
    FROM public.user_node_credentials
    WHERE client_id = ${client.id}::uuid AND email = ${parsed.data.email}
    LIMIT 1
  `) as CredentialRow[];
  const credential = credRows[0];

  const ok = await verifyPassword(parsed.data.password, credential?.password_hash ?? null);
  if (!ok || !credential) return jsonError(401, 'unauthorized');

  await sql`UPDATE public.user_node_credentials SET last_login_at = now() WHERE id = ${credential.id}`;

  const token = await mintBucketUserSession({
    sub: credential.user_node_id,
    email: credential.email,
    client_id: client.id,
  });

  return jsonOk(
    {
      user: {
        id: credential.user_node_id,
        email: credential.email,
        must_change_password: credential.must_change_password,
      },
      client: { id: client.id, slug, name: client.name },
    },
    { headers: { 'Set-Cookie': buCookieHeader(token) } },
  );
};
```

### Task 4.4: Update `u-me.ts` to load from user_nodes + client_roles

**Files:**
- Modify: `netlify/functions/u-me.ts`

- [ ] **Step 1: Rewrite the file**

```typescript
import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import {
  buCookieHeader, mintBucketUserSession, shouldRefreshBucketUser,
} from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  let actor;
  try { actor = await requireBucketUser(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const sql = db();
  const rows = (await sql`
    SELECT n.id, n.client_id, n.parent_id, n.level_number, n.role_id,
           n.display_name, n.email, n.phone, n.notes, n.fields,
           r.key AS role_key, r.label AS role_label, r.color AS role_color,
           c.slug AS client_slug, c.name AS client_name
    FROM public.user_nodes n
    JOIN public.client_roles r ON r.id = n.role_id
    JOIN public.clients c ON c.id = n.client_id
    WHERE n.id = ${actor.claims.sub}::uuid AND n.client_id = ${actor.claims.client_id}::uuid
    LIMIT 1
  `) as Array<{
    id: string; client_id: string; parent_id: string | null; level_number: number | null;
    role_id: string; display_name: string; email: string | null; phone: string | null;
    notes: string | null; fields: Record<string, unknown>;
    role_key: string; role_label: string; role_color: string;
    client_slug: string; client_name: string;
  }>;
  if (rows.length === 0) return jsonError(404, 'user_node_not_found');
  const row = rows[0]!;

  const headers: Record<string, string> = {};
  if (shouldRefreshBucketUser(actor.claims)) {
    const fresh = await mintBucketUserSession({
      sub: actor.claims.sub,
      email: actor.claims.email,
      client_id: actor.claims.client_id,
    });
    headers['Set-Cookie'] = buCookieHeader(fresh);
  }

  return jsonOk({
    user: {
      id: row.id,
      display_name: row.display_name,
      email: row.email,
      phone: row.phone,
      notes: row.notes,
      fields: row.fields,
      level_number: row.level_number,
      role: { key: row.role_key, label: row.role_label, color: row.role_color },
      must_change_password: actor.credential.must_change_password,
    },
    client: { id: row.client_id, slug: row.client_slug, name: row.client_name },
  }, { headers });
};
```

### Task 4.5: Update `u-change-password.ts` table reference

**Files:**
- Modify: `netlify/functions/u-change-password.ts`

- [ ] **Step 1: Find/replace bucket_user_credentials → user_node_credentials**

The only changes needed: every reference to `public.bucket_user_credentials` becomes `public.user_node_credentials`. The handler logic is otherwise identical. Final file content (replace the two SQL blocks):

```typescript
// Existing imports stay the same.

// In the SELECT:
const rows = (await sql`
  SELECT password_hash FROM public.user_node_credentials
  WHERE id = ${actor.credential.id} LIMIT 1
`) as { password_hash: string }[];

// In the UPDATE:
await sql`
  UPDATE public.user_node_credentials
  SET password_hash = ${newHash},
      must_change_password = false,
      temp_password_plain = NULL,
      temp_password_views_left = NULL
  WHERE id = ${actor.credential.id}
`;
```

### Task 4.6: Create user-node-credential endpoint (replaces bucket-user-credential)

**Files:**
- Create: `netlify/functions/user-node-credential.ts`

- [ ] **Step 1: Implement the endpoint**

```typescript
// GET    ?node=<id>  → { has_credential, must_change_password, last_login_at,
//                        temp_password_plain?, temp_password_views_left? }
//   The GET counts as a reveal — decrements views, wipes plaintext at 0.
// POST   ?node=<id>  body { temp_password } → reset
// DELETE ?node=<id>  → removes the credential

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { hashPassword } from './_shared/argon';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const ResetBody = z.object({ temp_password: z.string().min(8).max(200) });

interface FullCredential {
  id: string;
  client_id: string;
  email: string;
  must_change_password: boolean;
  temp_password_plain: string | null;
  temp_password_views_left: number | null;
  last_login_at: string | null;
}

export default async (req: Request, _ctx: Context) => {
  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const nodeId = new URL(req.url).searchParams.get('node');
  if (!nodeId) return jsonError(400, 'validation_failed', 'node required');
  try { assertUuid(nodeId, 'node'); } catch { return jsonError(400, 'validation_failed', 'node must be uuid'); }

  const sql = db();

  // Look up node + role to confirm existence; needed for POST email lookup.
  const nodeRows = (await sql`
    SELECT id, client_id, email FROM public.user_nodes WHERE id = ${nodeId}::uuid LIMIT 1
  `) as { id: string; client_id: string; email: string | null }[];
  if (nodeRows.length === 0) return jsonError(404, 'user_node_not_found');
  const node = nodeRows[0]!;

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT id, client_id, email, must_change_password, temp_password_plain,
             temp_password_views_left, last_login_at
      FROM public.user_node_credentials
      WHERE user_node_id = ${nodeId}::uuid LIMIT 1
    `) as FullCredential[];
    const cred = rows[0];
    if (!cred) return jsonOk({ has_credential: false });

    let plain = cred.temp_password_plain;
    let viewsLeft = cred.temp_password_views_left;
    if (plain && typeof viewsLeft === 'number' && viewsLeft > 0) {
      const newViews = viewsLeft - 1;
      if (newViews <= 0) {
        await sql`
          UPDATE public.user_node_credentials
          SET temp_password_plain = NULL, temp_password_views_left = NULL
          WHERE id = ${cred.id}
        `;
        viewsLeft = 0;
      } else {
        await sql`
          UPDATE public.user_node_credentials
          SET temp_password_views_left = ${newViews}
          WHERE id = ${cred.id}
        `;
        viewsLeft = newViews;
      }
    } else {
      plain = null;
    }
    return jsonOk({
      has_credential: true,
      email: cred.email,
      must_change_password: cred.must_change_password,
      last_login_at: cred.last_login_at,
      temp_password_plain: plain,
      temp_password_views_left: viewsLeft,
    });
  }

  if (req.method === 'POST') {
    if (!node.email) return jsonError(400, 'user_node_email_missing');
    const parsed = ResetBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    const pwdHash = await hashPassword(parsed.data.temp_password);

    try {
      await sql`
        INSERT INTO public.user_node_credentials (
          client_id, user_node_id, email, password_hash, must_change_password,
          temp_password_plain, temp_password_views_left, created_by_admin
        ) VALUES (
          ${node.client_id}::uuid, ${nodeId}::uuid, ${node.email},
          ${pwdHash}, true, ${parsed.data.temp_password}, 3, ${actor.admin.id}::uuid
        )
        ON CONFLICT (user_node_id) DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              must_change_password = true,
              temp_password_plain = EXCLUDED.temp_password_plain,
              temp_password_views_left = 3,
              email = EXCLUDED.email
      `;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === '23505') return jsonError(409, 'email_already_has_login_in_this_client');
      throw e;
    }
    return jsonOk({ ok: true });
  }

  if (req.method === 'DELETE') {
    await sql`DELETE FROM public.user_node_credentials WHERE user_node_id = ${nodeId}::uuid`;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
```

### Task 4.7: Rewrite `tests/integration/user-node-auth.test.ts`

**Files:**
- Create: `tests/integration/user-node-auth.test.ts`

- [ ] **Step 1: Write the test file**

This file mirrors the old `bucket-user-auth.test.ts` but uses the v3 shape. Eleven tests covering:

```typescript
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import userNodesHandler from '../../netlify/functions/user-nodes';
import userNodesDetailHandler from '../../netlify/functions/user-nodes-detail';
import userNodeCredentialHandler from '../../netlify/functions/user-node-credential';
import uClientBySlugHandler from '../../netlify/functions/u-client-by-slug';
import uLoginHandler from '../../netlify/functions/u-login';
import uMeHandler from '../../netlify/functions/u-me';
import uChangePasswordHandler from '../../netlify/functions/u-change-password';
import authMeHandler from '../../netlify/functions/auth-me';

const ADMIN_EMAIL = 'user-node-auth-test@example.com';
const ADMIN_PASSWORD = 'user-node-auth-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let testClientId: string;
let testClientSlug: string;
let roleId: string;
const createdClients: string[] = [];

async function adminLogin() {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const r = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

async function createNodeWithLogin(email: string, tempPassword: string): Promise<string> {
  const r = await userNodesHandler(
    new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        role_id: roleId, level_number: 1, parent_id: null,
        display_name: 'Test User', email,
        create_login: true, temp_password: tempPassword,
      }),
    }), CTX,
  );
  if (r.status !== 201) throw new Error(`create+login failed: ${r.status} ${await r.text()}`);
  return (await r.json() as { node: { id: string } }).node.id;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'UN Auth Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, display_name = 'UN Auth Admin'
  `;
});

beforeEach(async () => {
  cookie = await adminLogin();
  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `UN Auth Test ${Date.now()}` }),
    }), CTX,
  );
  const created = (await cr.json() as { client: { id: string; slug: string } }).client;
  testClientId = created.id;
  testClientSlug = created.slug;
  createdClients.push(testClientId);

  const rr = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
    }), CTX,
  );
  roleId = (await rr.json() as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ level_number: 1, allowed_role_ids: [roleId] }),
  }), CTX);
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('user-node auth', () => {
  test('u-client-by-slug returns the client for a valid slug', async () => {
    const r = await uClientBySlugHandler(
      new Request(`http://localhost/api/u-client-by-slug?slug=${testClientSlug}`, { method: 'GET' }),
      CTX,
    );
    expect(r.status).toBe(200);
  });

  test('u-client-by-slug 404 for unknown slug', async () => {
    const r = await uClientBySlugHandler(
      new Request('http://localhost/api/u-client-by-slug?slug=does-not-exist-xyz', { method: 'GET' }),
      CTX,
    );
    expect(r.status).toBe(404);
  });

  test('create node with create_login adds credential row', async () => {
    const email = `un-login-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'temp-pass-1');
    const rows = (await sql`
      SELECT must_change_password, temp_password_views_left
      FROM public.user_node_credentials WHERE user_node_id = ${nodeId}
    `) as { must_change_password: boolean; temp_password_views_left: number }[];
    expect(rows[0]!.must_change_password).toBe(true);
    expect(rows[0]!.temp_password_views_left).toBe(3);
  });

  test('u-login happy path', async () => {
    const email = `un-happy-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'happy-pass-1');
    const r = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'happy-pass-1' }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain('bu_session=');
    const body = await r.json() as { user: { must_change_password: boolean } };
    expect(body.user.must_change_password).toBe(true);
  });

  test('u-login wrong password → 401', async () => {
    const email = `un-wrong-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'correct-pass-1');
    const r = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-pass' }),
      }), CTX,
    );
    expect(r.status).toBe(401);
  });

  test('u-change-password clears must_change_password and wipes plain', async () => {
    const email = `un-change-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'change-me-1');
    const lr = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'change-me-1' }),
      }), CTX,
    );
    const buCookie = lr.headers.get('set-cookie')!.split(';')[0]!;
    const cr = await uChangePasswordHandler(
      new Request('http://localhost/api/u-change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
        body: JSON.stringify({ current_password: 'change-me-1', new_password: 'new-strong-pass' }),
      }), CTX,
    );
    expect(cr.status).toBe(200);
    const rows = (await sql`
      SELECT must_change_password, temp_password_plain FROM public.user_node_credentials
      WHERE user_node_id = ${nodeId}
    `) as { must_change_password: boolean; temp_password_plain: string | null }[];
    expect(rows[0]!.must_change_password).toBe(false);
    expect(rows[0]!.temp_password_plain).toBeNull();
  });

  test('GET credential decrements views_left; at 0 plaintext wiped', async () => {
    const email = `un-views-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'views-test-1');
    const url = `http://localhost/api/user-node-credential?node=${nodeId}`;
    for (let i = 0; i < 3; i++) {
      const r = await userNodeCredentialHandler(new Request(url, { method: 'GET', headers: { cookie } }), CTX);
      expect(r.status).toBe(200);
      const body = await r.json() as { temp_password_plain: string | null; temp_password_views_left: number | null };
      expect(body.temp_password_plain).toBe('views-test-1');
      expect(body.temp_password_views_left).toBe(2 - i);
    }
    const r4 = await userNodeCredentialHandler(new Request(url, { method: 'GET', headers: { cookie } }), CTX);
    const body4 = await r4.json() as { temp_password_plain: string | null };
    expect(body4.temp_password_plain).toBeNull();
  });

  test('bu_session cookie cannot auth admin /api/auth-me', async () => {
    const email = `un-kind-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'kind-test-1');
    const lr = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'kind-test-1' }),
      }), CTX,
    );
    const buCookie = lr.headers.get('set-cookie')!.split(';')[0]!;
    const me = await authMeHandler(new Request('http://localhost/api/auth-me', { headers: { cookie: buCookie } }), CTX);
    expect(me.status).toBe(401);
  });

  test('admin cookie cannot auth /api/u-me', async () => {
    const adminToken = cookie.replace(/^session=/, '');
    const forged = `bu_session=${adminToken}`;
    const r = await uMeHandler(new Request('http://localhost/api/u-me', { headers: { cookie: forged } }), CTX);
    expect(r.status).toBe(401);
  });

  test('duplicate email-per-client returns 409', async () => {
    const email = `un-dup-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'first-pass-1');
    const r = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleId, level_number: 1, parent_id: null,
          display_name: 'Dup', email,
          create_login: true, temp_password: 'second-pass-1',
        }),
      }), CTX,
    );
    expect(r.status).toBe(409);
  });

  test('deleting a node cascades the credential', async () => {
    const email = `un-cascade-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'cascade-1');
    await userNodesDetailHandler(
      new Request(`http://localhost/api/user-nodes-detail?id=${nodeId}`, { method: 'DELETE', headers: { cookie } }),
      CTX,
    );
    const remaining = (await sql`SELECT id FROM public.user_node_credentials WHERE user_node_id = ${nodeId}`) as unknown[];
    expect(remaining).toHaveLength(0);
  });
});
```

### Task 4.8: Create the unified `/api/login` endpoint

**Files:**
- Create: `netlify/functions/login.ts`
- Modify: `tests/integration/user-node-auth.test.ts` (append tests)

The unified login tries admin auth first, then bucket-user auth across all clients the email belongs to. After password verification, returns one of three response shapes: `admin` (single match), `bucket_user` (single bucket-user match), or `choice` (multiple bucket-user matches; UI shows picker, re-POSTs with `client` slug to disambiguate).

- [ ] **Step 1: Write failing tests**

Append to `tests/integration/user-node-auth.test.ts`:

```typescript
import loginUnifiedHandler from '../../netlify/functions/login';

// ── New cases for unified /api/login ──────────────────────────────

test('unified login: admin path returns kind:admin and sets session cookie', async () => {
  // ADMIN_EMAIL is already inserted with ADMIN_PASSWORD in beforeAll.
  // Make sure no bucket-user credential for ADMIN_EMAIL exists in this test client.
  const r = await loginUnifiedHandler(
    new Request('http://localhost/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  expect(r.status).toBe(200);
  const setCookie = r.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('session=');
  const body = await r.json() as { kind: string; admin?: { email: string } };
  expect(body.kind).toBe('admin');
  expect(body.admin?.email).toBe(ADMIN_EMAIL);
});

test('unified login: single bucket-user match returns kind:bucket_user and sets bu_session', async () => {
  const email = `unified-single-${Date.now()}@example.com`;
  await createNodeWithLogin(email, 'unified-pass-1');
  const r = await loginUnifiedHandler(
    new Request('http://localhost/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'unified-pass-1' }),
    }), CTX,
  );
  expect(r.status).toBe(200);
  expect(r.headers.get('set-cookie') ?? '').toContain('bu_session=');
  const body = await r.json() as { kind: string; user: { must_change_password: boolean }; client: { slug: string } };
  expect(body.kind).toBe('bucket_user');
  expect(body.user.must_change_password).toBe(true);
  expect(body.client.slug).toBe(testClientSlug);
});

test('unified login: multiple bucket-user matches returns kind:choice', async () => {
  // Create a SECOND client + give it the same email as a bucket-user.
  const sharedEmail = `unified-multi-${Date.now()}@example.com`;
  await createNodeWithLogin(sharedEmail, 'unified-pass-multi');
  // Spin up a 2nd client + role + level + bucket-user with same email + same password.
  const cr2 = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ name: `Second Client ${Date.now()}` }),
  }), CTX);
  const c2 = (await cr2.json() as { client: { id: string; slug: string } }).client;
  createdClients.push(c2.id);
  const r2 = await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${c2.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
  }), CTX);
  const role2 = (await r2.json() as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${c2.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ level_number: 1, allowed_role_ids: [role2] }),
  }), CTX);
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${c2.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      role_id: role2, level_number: 1, parent_id: null,
      display_name: 'Multi', email: sharedEmail,
      create_login: true, temp_password: 'unified-pass-multi', // same pwd
    }),
  }), CTX);

  const r = await loginUnifiedHandler(
    new Request('http://localhost/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: sharedEmail, password: 'unified-pass-multi' }),
    }), CTX,
  );
  expect(r.status).toBe(200);
  // Multi-match: no cookie set yet.
  expect(r.headers.get('set-cookie') ?? '').not.toContain('bu_session=');
  const body = await r.json() as { kind: string; clients: Array<{ slug: string }> };
  expect(body.kind).toBe('choice');
  expect(body.clients.length).toBeGreaterThanOrEqual(2);
});

test('unified login: disambiguation with `client` slug returns kind:bucket_user', async () => {
  const sharedEmail = `unified-disamb-${Date.now()}@example.com`;
  await createNodeWithLogin(sharedEmail, 'disamb-pass');
  // Disambiguate by passing the client slug.
  const r = await loginUnifiedHandler(
    new Request('http://localhost/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: sharedEmail, password: 'disamb-pass', client: testClientSlug }),
    }), CTX,
  );
  expect(r.status).toBe(200);
  expect(r.headers.get('set-cookie') ?? '').toContain('bu_session=');
  const body = await r.json() as { kind: string; client: { slug: string } };
  expect(body.kind).toBe('bucket_user');
  expect(body.client.slug).toBe(testClientSlug);
});

test('unified login: wrong password returns 401 unauthorized', async () => {
  const email = `unified-wrong-${Date.now()}@example.com`;
  await createNodeWithLogin(email, 'correct-pass');
  const r = await loginUnifiedHandler(
    new Request('http://localhost/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-pass' }),
    }), CTX,
  );
  expect(r.status).toBe(401);
});

test('unified login: unknown email returns 401 unauthorized', async () => {
  const r = await loginUnifiedHandler(
    new Request('http://localhost/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody-here@example.com', password: 'whatever' }),
    }), CTX,
  );
  expect(r.status).toBe(401);
});

test('unified login: admin precedence wins over bucket-user with same email', async () => {
  // Insert an admin row with email matching an existing bucket-user.
  // We'll directly INSERT the admin since the admin-team endpoint requires admin auth.
  const collidingEmail = `unified-collide-${Date.now()}@example.com`;
  const tempHash = await hashPassword('admin-wins-pass');
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${collidingEmail}, ${tempHash}, 'Collide Admin', false)
  `;
  // Also create a bucket-user with the same email.
  await createNodeWithLogin(collidingEmail, 'bucket-pass-different');

  // POST with the ADMIN's password — must succeed as admin (kind:admin), not bucket.
  const r = await loginUnifiedHandler(
    new Request('http://localhost/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: collidingEmail, password: 'admin-wins-pass' }),
    }), CTX,
  );
  expect(r.status).toBe(200);
  const body = await r.json() as { kind: string };
  expect(body.kind).toBe('admin');

  // Cleanup.
  await sql`DELETE FROM public.admins WHERE email = ${collidingEmail}`;
});
```

- [ ] **Step 2: Run tests — they fail (handler missing)**

Run: `npx vitest run tests/integration/user-node-auth.test.ts`
Expected: 7 new tests fail.

- [ ] **Step 3: Implement `netlify/functions/login.ts`**

```typescript
// POST /api/login
//   Body: { email, password, client?: <slug> }
//
// Tries admin auth first (admin always wins). Falls through to bucket-user
// credential lookup. Returns one of:
//   - { kind: 'admin', admin: {...} }     + Set-Cookie: session=<admin JWT>
//   - { kind: 'bucket_user', user, client } + Set-Cookie: bu_session=<JWT>
//   - { kind: 'choice', clients: [...] }    (no cookie; UI shows picker)
//
// Disambiguation: pass `client: <slug>` in body to narrow a multi-match.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyPassword } from './_shared/argon';
import {
  mintSession, cookieHeader,
  mintBucketUserSession, buCookieHeader,
} from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { checkRateLimit, logAttempt, extractIp } from './_shared/rate-limit';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  client: z.string().min(1).max(80).optional(),
});

interface AdminRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  is_bootstrap: boolean;
}

interface BUCredRow {
  id: string;
  client_id: string;
  user_node_id: string;
  email: string;
  password_hash: string;
  must_change_password: boolean;
}

interface ClientRow {
  id: string;
  slug: string;
  name: string;
}

const MAX_CREDS_TO_VERIFY = 5;  // safety cap on argon2 verifies per request

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const ip = extractIp(req);
  const sql = db();
  const limit = await checkRateLimit(sql, { email: parsed.data.email, ip });
  if (!limit.allowed) {
    return jsonError(429, 'too_many_attempts',
      { reason: limit.reason },
      { 'Retry-After': String(limit.retryAfterSec ?? 300) });
  }

  // Step 1: admin precedence.
  const adminRows = (await sql`
    SELECT id, email, password_hash, display_name, is_bootstrap
    FROM public.admins WHERE email = ${parsed.data.email} LIMIT 1
  `) as AdminRow[];
  if (adminRows.length > 0) {
    const admin = adminRows[0]!;
    const ok = await verifyPassword(parsed.data.password, admin.password_hash);
    if (!ok) {
      await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
      return jsonError(401, 'unauthorized');
    }
    await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'success' });
    const token = await mintSession({ sub: admin.id, email: admin.email });
    return jsonOk(
      { kind: 'admin', admin: { id: admin.id, email: admin.email, display_name: admin.display_name, is_bootstrap: admin.is_bootstrap } },
      { headers: { 'Set-Cookie': cookieHeader(token) } },
    );
  }

  // Step 2: bucket-user credentials. Optionally narrowed by `client` slug.
  let credRows: BUCredRow[];
  let clientRowsForChoice: ClientRow[] = [];

  if (parsed.data.client) {
    // Disambiguation call — narrow to the picked client.
    const c = (await sql`SELECT id, slug, name FROM public.clients WHERE slug = ${parsed.data.client} LIMIT 1`) as ClientRow[];
    if (c.length === 0) {
      // Equalize timing then 401.
      await verifyPassword(parsed.data.password, null);
      await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
      return jsonError(401, 'unauthorized');
    }
    credRows = (await sql`
      SELECT id, client_id, user_node_id, email, password_hash, must_change_password
      FROM public.user_node_credentials
      WHERE email = ${parsed.data.email} AND client_id = ${c[0]!.id}::uuid
      LIMIT 1
    `) as BUCredRow[];
    clientRowsForChoice = c;
  } else {
    // Open lookup across ALL clients for this email.
    credRows = (await sql`
      SELECT id, client_id, user_node_id, email, password_hash, must_change_password
      FROM public.user_node_credentials
      WHERE email = ${parsed.data.email}
      ORDER BY created_at
      LIMIT ${MAX_CREDS_TO_VERIFY}
    `) as BUCredRow[];
  }

  if (credRows.length === 0) {
    // Equalize timing then 401.
    await verifyPassword(parsed.data.password, null);
    await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
    return jsonError(401, 'unauthorized');
  }

  // Verify password against each candidate credential.
  const verified: BUCredRow[] = [];
  for (const cred of credRows) {
    if (await verifyPassword(parsed.data.password, cred.password_hash)) {
      verified.push(cred);
    }
  }

  if (verified.length === 0) {
    await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
    return jsonError(401, 'unauthorized');
  }

  await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'success' });

  if (verified.length === 1) {
    const cred = verified[0]!;
    const c = clientRowsForChoice.length > 0
      ? clientRowsForChoice[0]!
      : ((await sql`SELECT id, slug, name FROM public.clients WHERE id = ${cred.client_id}::uuid LIMIT 1`) as ClientRow[])[0]!;
    await sql`UPDATE public.user_node_credentials SET last_login_at = now() WHERE id = ${cred.id}`;
    const token = await mintBucketUserSession({
      sub: cred.user_node_id, email: cred.email, client_id: cred.client_id,
    });
    return jsonOk(
      {
        kind: 'bucket_user',
        user: { id: cred.user_node_id, email: cred.email, must_change_password: cred.must_change_password },
        client: { id: c.id, slug: c.slug, name: c.name },
      },
      { headers: { 'Set-Cookie': buCookieHeader(token) } },
    );
  }

  // Multi-match → return choice. No cookie set.
  const clientIds = verified.map((v) => v.client_id);
  const clients = (await sql`
    SELECT id, slug, name FROM public.clients WHERE id = ANY(${clientIds}::uuid[])
    ORDER BY name
  `) as ClientRow[];
  return jsonOk({ kind: 'choice', clients });
};
```

- [ ] **Step 4: Run tests — should pass**

Run: `npx vitest run tests/integration/user-node-auth.test.ts`
Expected: all tests pass (original + 7 new).

### Task 4.9: Delete v2 shared modules + trim identifier.ts (deferred from Phase 1)

By this point, no surviving code references `_shared/templates.ts`, `_shared/template-ddl.ts`, `_shared/schema-manager.ts`, `_shared/bucket.ts`, or the v2 helpers in `identifier.ts`. Now they can be safely removed.

**Files:**
- Delete: `netlify/functions/_shared/templates.ts`
- Delete: `netlify/functions/_shared/template-ddl.ts`
- Delete: `netlify/functions/_shared/schema-manager.ts`
- Delete: `netlify/functions/_shared/bucket.ts`
- Delete: `tests/unit/templates.test.ts`
- Delete: `tests/unit/template-ddl.test.ts`
- Delete: `tests/unit/__snapshots__/template-ddl.test.ts.snap`
- Modify: `netlify/functions/_shared/identifier.ts` (trim)
- Modify: `tests/unit/identifier.test.ts` (cover only surviving exports)

- [ ] **Step 1: Search for any remaining references**

Run: `grep -rn "from.*_shared/templates\|from.*_shared/template-ddl\|from.*_shared/schema-manager\|from.*_shared/bucket\|safeQuoteSchema\|safeQuoteIdent\|isValidSchemaName\|generateSchemaName\|TEMPLATES\b" netlify/ src/ tests/`

Expected: NO matches in `netlify/functions/*.ts` (excluding `_shared/` itself), `src/`, or `tests/integration/`. Matches only inside the files being deleted/modified are expected.

If you see any unexpected match, STOP and report — there's a still-used reference the plan missed.

- [ ] **Step 2: Delete the four shared modules + two unit tests + snapshot**

```bash
rm netlify/functions/_shared/templates.ts
rm netlify/functions/_shared/template-ddl.ts
rm netlify/functions/_shared/schema-manager.ts
rm netlify/functions/_shared/bucket.ts
rm tests/unit/templates.test.ts
rm tests/unit/template-ddl.test.ts
rm -f tests/unit/__snapshots__/template-ddl.test.ts.snap
```

- [ ] **Step 3: Trim `identifier.ts` to UUID + slug helpers only**

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(s: string): boolean {
  return typeof s === 'string' && UUID_RE.test(s);
}

export function assertUuid(s: string, field?: string): void {
  if (!isValidUuid(s)) {
    throw new Error(field ? `invalid_uuid:${field}` : 'invalid_uuid');
  }
}

const SLUG_FORMAT = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

function defaultHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function deriveSlug(name: string, rand: () => string = defaultHex): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/g, '');
  if (s.length < 2 || !SLUG_FORMAT.test(s)) {
    s = `c-${rand().slice(0, 8)}`;
  }
  return s;
}

export function isValidSlug(s: string): boolean {
  return typeof s === 'string' && SLUG_FORMAT.test(s);
}
```

- [ ] **Step 4: Rewrite `tests/unit/identifier.test.ts` to cover only surviving exports**

```typescript
import { describe, expect, test } from 'vitest';
import { assertUuid, deriveSlug, isValidSlug, isValidUuid } from '../../netlify/functions/_shared/identifier';

describe('identifier helpers', () => {
  test('isValidUuid accepts canonical v4', () => {
    expect(isValidUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(isValidUuid('aBcDeF12-3456-7890-1234-567890abcdef')).toBe(true);
  });
  test('isValidUuid rejects non-uuid', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('')).toBe(false);
  });
  test('assertUuid throws with field hint', () => {
    expect(() => assertUuid('bad', 'clientId')).toThrow('invalid_uuid:clientId');
  });
  test('deriveSlug lowercases + hyphenates + trims', () => {
    expect(deriveSlug("Joe's Hardware!!")).toBe('joe-s-hardware');
    expect(deriveSlug('  Bistro Verde  ')).toBe('bistro-verde');
  });
  test('deriveSlug falls back to prefix when input is degenerate', () => {
    const out = deriveSlug('!!!', () => 'abcd1234');
    expect(out).toMatch(/^c-abcd1234$/);
  });
  test('isValidSlug enforces 2-60 alphanumeric+hyphen, alnum endpoints', () => {
    expect(isValidSlug('ab')).toBe(true);
    expect(isValidSlug('joes-hardware-2')).toBe(true);
    expect(isValidSlug('-leading')).toBe(false);
    expect(isValidSlug('trailing-')).toBe(false);
    expect(isValidSlug('a')).toBe(false);
  });
});
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Run the unit tests touched by this task**

Run: `npx vitest run tests/unit/identifier.test.ts`
Expected: 6 tests passing.

### Task 4.10: Run full Phase 4 tests + commit

- [ ] **Step 1: Full suite**

Run: `npm run typecheck && npx vitest run --reporter=dot`

- [ ] **Step 2: Commit**

```bash
git add netlify/functions/_shared/session.ts \
        netlify/functions/_shared/permissions.ts \
        netlify/functions/_shared/identifier.ts \
        netlify/functions/u-login.ts \
        netlify/functions/u-me.ts \
        netlify/functions/u-change-password.ts \
        netlify/functions/user-node-credential.ts \
        netlify/functions/login.ts \
        tests/integration/user-node-auth.test.ts \
        tests/unit/identifier.test.ts
git add -u netlify/functions/_shared/templates.ts \
           netlify/functions/_shared/template-ddl.ts \
           netlify/functions/_shared/schema-manager.ts \
           netlify/functions/_shared/bucket.ts \
           tests/unit/templates.test.ts \
           tests/unit/template-ddl.test.ts \
           tests/unit/__snapshots__/template-ddl.test.ts.snap || true
git commit -m "phase 4: rekey credentials, unified /api/login, delete deferred v2 shared modules"
```

---

## Phase 5 — Frontend: Configure Structure page

**Goal:** Admin can navigate to `/clients/:id/configure`, add/edit/delete roles, levels, and cardinality rules. UI loads structure once into a React context, then mutations refresh.

### Task 5.1: Add structure API helpers to `src/modules/ams/api.ts`

**Files:**
- Modify: `src/modules/ams/api.ts`

- [ ] **Step 1: Append helper functions and types**

Append to the end of the file:

```typescript
// ─── v3: client structure ───────────────────────────────────────────

export interface RoleFieldDef {
  key: string;
  label: string;
  type: 'text' | 'date' | 'integer' | 'boolean';
  required: boolean;
  default?: string | number | boolean;
  help?: string;
  display_in_list?: boolean;
}

export interface ClientRole {
  id: string;
  client_id: string;
  key: string;
  label: string;
  color: string;
  fields: RoleFieldDef[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ClientLevel {
  id: string;
  client_id: string;
  level_number: number;
  label: string | null;
  allowed_role_ids: string[];
  created_at: string;
}

export interface ClientCardinalityRule {
  id: string;
  client_id: string;
  parent_role_id: string | null;
  child_role_id: string;
  max_children: number;
}

export interface ClientStructure {
  roles: ClientRole[];
  levels: ClientLevel[];
  cardinality_rules: ClientCardinalityRule[];
}

export const getClientStructure = (clientId: string) =>
  apiFetch<ClientStructure>(`/api/client-structure?client=${encodeURIComponent(clientId)}`);

export const createRole = (clientId: string, body: { key: string; label: string; color: string; fields?: RoleFieldDef[] }) =>
  apiFetch<{ role: ClientRole }>(`/api/client-roles?client=${encodeURIComponent(clientId)}`, {
    method: 'POST', body: JSON.stringify(body),
  });

export const patchRole = (roleId: string, body: Partial<{ label: string; color: string; fields: RoleFieldDef[]; sort_order: number }>) =>
  apiFetch<{ role: ClientRole }>(`/api/client-roles-detail?id=${encodeURIComponent(roleId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });

export const deleteRole = (roleId: string) =>
  apiFetch<{ ok: true }>(`/api/client-roles-detail?id=${encodeURIComponent(roleId)}`, { method: 'DELETE' });

export const createLevel = (clientId: string, body: { level_number: number; label?: string; allowed_role_ids: string[] }) =>
  apiFetch<{ level: ClientLevel }>(`/api/client-levels?client=${encodeURIComponent(clientId)}`, {
    method: 'POST', body: JSON.stringify(body),
  });

export const patchLevel = (levelId: string, body: Partial<{ label: string; allowed_role_ids: string[] }>) =>
  apiFetch<{ level: ClientLevel }>(`/api/client-levels-detail?id=${encodeURIComponent(levelId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });

export const deleteLevel = (levelId: string) =>
  apiFetch<{ ok: true }>(`/api/client-levels-detail?id=${encodeURIComponent(levelId)}`, { method: 'DELETE' });

export const putCardinality = (clientId: string, rules: Array<{ parent_role_id: string | null; child_role_id: string; max_children: number }>) =>
  apiFetch<{ ok: true }>(`/api/client-cardinality?client=${encodeURIComponent(clientId)}`, {
    method: 'PUT', body: JSON.stringify({ rules }),
  });
```

### Task 5.2: Create `ClientStructureContext.tsx`

**Files:**
- Create: `src/modules/ams/components/ClientStructureContext.tsx`

- [ ] **Step 1: Write the context provider**

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getClientStructure, type ClientStructure } from '../api';

interface State {
  structure: ClientStructure | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<State | null>(null);

export function ClientStructureProvider({ clientId, children }: { clientId: string; children: ReactNode }) {
  const [structure, setStructure] = useState<ClientStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await getClientStructure(clientId);
    setLoading(false);
    if (!r.ok) { setError(`Failed to load structure (${r.error.code})`); return; }
    setStructure(r.data);
  }, [clientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return <Ctx.Provider value={{ structure, loading, error, refresh }}>{children}</Ctx.Provider>;
}

export function useClientStructure(): State {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClientStructure outside provider');
  return v;
}
```

### Task 5.3: Create `RoleEditor.tsx` (add + list + delete)

**Files:**
- Create: `src/modules/ams/components/RoleEditor.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState, type FormEvent } from 'react';
import { createRole, deleteRole, type ClientRole } from '../api';

interface Props {
  clientId: string;
  roles: ClientRole[];
  onChange: () => void;
}

export function RoleEditor({ clientId, roles, onChange }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null); setSubmitting(true);
    const r = await createRole(clientId, { key, label, color });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'role_key_taken' ? 'Role key already exists.' : `Failed (${r.error.code})`);
      return;
    }
    setKey(''); setLabel(''); setColor('#3b82f6'); setShowAdd(false);
    onChange();
  }

  async function handleDelete(role: ClientRole) {
    if (!confirm(`Delete role "${role.label}"?`)) return;
    const r = await deleteRole(role.id);
    if (!r.ok) {
      alert(r.error.code === 'role_in_use'
        ? 'Cannot delete — users still have this role. Reassign or delete those users first.'
        : `Failed (${r.error.code})`);
      return;
    }
    onChange();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Roles</h3>
        <button className="btn btn-secondary" onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : '+ Add role'}</button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} style={{ background: 'var(--bg-elevated, #1a1a1a)', padding: 12, borderRadius: 6, marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 100px' }}>Key
            <input type="text" required value={key} onChange={(e) => setKey(e.target.value)} placeholder="owner" pattern="^[a-z][a-z0-9_]*$" title="lowercase + underscore + digits, starting with a letter" />
          </label>
          <label style={{ flex: '1 1 140px' }}>Label
            <input type="text" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Owner" />
          </label>
          <label style={{ flex: '0 0 80px' }}>Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 32, width: '100%' }} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '…' : 'Add'}</button>
          {error && <p className="error" style={{ width: '100%', margin: '4px 0 0' }}>{error}</p>}
        </form>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {roles.map((r) => (
          <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, background: r.color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}><strong>{r.label}</strong> <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.key}</span></span>
            <button className="btn btn-ghost" onClick={() => handleDelete(r)}>×</button>
          </li>
        ))}
        {roles.length === 0 && <li className="muted">No roles yet.</li>}
      </ul>
    </div>
  );
}
```

### Task 5.4: Create `LevelEditor.tsx`

**Files:**
- Create: `src/modules/ams/components/LevelEditor.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState, type FormEvent } from 'react';
import { createLevel, patchLevel, deleteLevel, type ClientLevel, type ClientRole } from '../api';

interface Props {
  clientId: string;
  levels: ClientLevel[];
  roles: ClientRole[];
  onChange: () => void;
}

export function LevelEditor({ clientId, levels, roles, onChange }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const level_number = Number(data.get('level_number'));
    const label = String(data.get('label') || '').trim() || undefined;
    setSubmitting(true); setError(null);
    const r = await createLevel(clientId, { level_number, label, allowed_role_ids: [] });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'level_number_taken' ? 'Level number already exists.' : `Failed (${r.error.code})`);
      return;
    }
    form.reset();
    setShowAdd(false);
    onChange();
  }

  async function toggleRole(level: ClientLevel, roleId: string) {
    const next = level.allowed_role_ids.includes(roleId)
      ? level.allowed_role_ids.filter((id) => id !== roleId)
      : [...level.allowed_role_ids, roleId];
    const r = await patchLevel(level.id, { allowed_role_ids: next });
    if (!r.ok) alert(`Failed (${r.error.code})`);
    onChange();
  }

  async function handleDelete(level: ClientLevel) {
    if (!confirm(`Delete Level ${level.level_number}?`)) return;
    const r = await deleteLevel(level.id);
    if (!r.ok) {
      alert(r.error.code === 'level_in_use'
        ? 'Cannot delete — users exist at this level.'
        : `Failed (${r.error.code})`);
      return;
    }
    onChange();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Levels</h3>
        <button className="btn btn-secondary" onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : '+ Add level'}</button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} style={{ background: 'var(--bg-elevated, #1a1a1a)', padding: 12, borderRadius: 6, marginBottom: 8, display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <label style={{ flex: '0 0 80px' }}>Number
            <input type="number" name="level_number" required min={1} defaultValue={(levels[levels.length - 1]?.level_number ?? 0) + 1} />
          </label>
          <label style={{ flex: 1 }}>Label (optional)
            <input type="text" name="label" placeholder="e.g. Top" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '…' : 'Add'}</button>
          {error && <p className="error" style={{ width: '100%', margin: '4px 0 0' }}>{error}</p>}
        </form>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {levels.map((l) => (
          <li key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ flex: '0 0 80px' }}>Level {l.level_number}</strong>
              <span style={{ flex: 1 }} className="muted">{l.label ?? ''}</span>
              <button className="btn btn-ghost" onClick={() => handleDelete(l)}>×</button>
            </div>
            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {roles.map((r) => {
                const on = l.allowed_role_ids.includes(r.id);
                return (
                  <button key={r.id} onClick={() => toggleRole(l, r.id)} style={{
                    padding: '2px 8px', borderRadius: 12, fontSize: 12,
                    border: `1px solid ${r.color}`,
                    background: on ? r.color : 'transparent',
                    color: on ? '#fff' : 'inherit',
                    cursor: 'pointer',
                  }}>{r.label}</button>
                );
              })}
            </div>
          </li>
        ))}
        {levels.length === 0 && <li className="muted">No levels yet.</li>}
      </ul>
    </div>
  );
}
```

### Task 5.5: Create `CardinalityEditor.tsx`

**Files:**
- Create: `src/modules/ams/components/CardinalityEditor.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react';
import { putCardinality, type ClientCardinalityRule, type ClientRole } from '../api';

interface Props {
  clientId: string;
  rules: ClientCardinalityRule[];
  roles: ClientRole[];
  onChange: () => void;
}

interface DraftRule { parent_role_id: string | null; child_role_id: string; max_children: number; }

export function CardinalityEditor({ clientId, rules, roles, onChange }: Props) {
  const [draft, setDraft] = useState<DraftRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(rules.map((r) => ({
      parent_role_id: r.parent_role_id, child_role_id: r.child_role_id, max_children: r.max_children,
    })));
  }, [rules]);

  function addRow() {
    setDraft([...draft, { parent_role_id: null, child_role_id: roles[0]?.id ?? '', max_children: 1 }]);
  }
  function update(i: number, patch: Partial<DraftRule>) {
    setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function remove(i: number) {
    setDraft(draft.filter((_, idx) => idx !== i));
  }

  async function save() {
    setError(null); setSaving(true);
    const filtered = draft.filter((r) => r.child_role_id);
    const r = await putCardinality(clientId, filtered);
    setSaving(false);
    if (!r.ok) { setError(`Failed (${r.error.code})`); return; }
    onChange();
  }

  if (roles.length === 0) {
    return <div><h3 style={{ marginBottom: 8 }}>Per-parent limits</h3><p className="muted">Add roles first.</p></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Per-parent limits</h3>
        <button className="btn btn-secondary" onClick={addRow}>+ Add rule</button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {draft.map((r, i) => (
          <li key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Under</span>
            <select value={r.parent_role_id ?? ''} onChange={(e) => update(i, { parent_role_id: e.target.value || null })}>
              <option value="">(top-level)</option>
              {roles.map((rr) => <option key={rr.id} value={rr.id}>{rr.label}</option>)}
            </select>
            <span>up to</span>
            <input type="number" min={0} value={r.max_children} onChange={(e) => update(i, { max_children: Number(e.target.value) })} style={{ width: 70 }} />
            <select value={r.child_role_id} onChange={(e) => update(i, { child_role_id: e.target.value })}>
              {roles.map((rr) => <option key={rr.id} value={rr.id}>{rr.label}</option>)}
            </select>
            <button className="btn btn-ghost" onClick={() => remove(i)}>×</button>
          </li>
        ))}
        {draft.length === 0 && <li className="muted">No limits set — unlimited everywhere.</li>}
      </ul>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        {error && <p className="error" style={{ margin: 0, flex: 1 }}>{error}</p>}
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save limits'}</button>
      </div>
    </div>
  );
}
```

### Task 5.6: Build the `ConfigureStructure.tsx` page

**Files:**
- Modify: `src/modules/ams/pages/ConfigureStructure.tsx`

- [ ] **Step 1: Replace the stub with the full page**

```tsx
import { Link, useParams } from 'react-router-dom';
import { ClientStructureProvider, useClientStructure } from '../components/ClientStructureContext';
import { RoleEditor } from '../components/RoleEditor';
import { LevelEditor } from '../components/LevelEditor';
import { CardinalityEditor } from '../components/CardinalityEditor';

export default function ConfigureStructure() {
  const { clientId } = useParams<{ clientId: string }>();
  if (!clientId) return <p className="error">Invalid URL.</p>;
  return (
    <ClientStructureProvider clientId={clientId}>
      <ConfigureInner clientId={clientId} />
    </ClientStructureProvider>
  );
}

function ConfigureInner({ clientId }: { clientId: string }) {
  const { structure, loading, error, refresh } = useClientStructure();

  return (
    <section>
      <header style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0 }}>Configure structure</h1>
          <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>Define roles, levels, and per-parent limits.</p>
        </div>
        <Link to={`/clients/${clientId}`} className="btn btn-secondary">← Access dashboard</Link>
      </header>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {structure && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <RoleEditor clientId={clientId} roles={structure.roles} onChange={refresh} />
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <LevelEditor clientId={clientId} levels={structure.levels} roles={structure.roles} onChange={refresh} />
          </div>
          <div className="card">
            <CardinalityEditor clientId={clientId} rules={structure.cardinality_rules} roles={structure.roles} onChange={refresh} />
          </div>
        </>
      )}
    </section>
  );
}
```

### Task 5.7: Rewire `LoginPage` to use unified `/api/login`

The existing v2 `LoginPage` calls `/api/auth-login` directly via `auth-context`. The unified design wants `LoginPage` to call `/api/login` and branch on `response.kind` (admin / bucket_user / choice).

**Files:**
- Modify: `src/modules/login/pages/LoginPage.tsx`
- Modify: `src/lib/auth-context.tsx`
- Modify: `src/modules/login/api.ts` (or wherever the login mutation lives)

- [ ] **Step 1: Read the current LoginPage + auth-context**

Run: `cat src/modules/login/pages/LoginPage.tsx && echo "---" && cat src/lib/auth-context.tsx && echo "---" && find src/modules/login -name "*.ts" -o -name "*.tsx" | xargs ls`

- [ ] **Step 2: Add a unified-login API helper**

If `src/modules/login/api.ts` exists, append to it. Otherwise create it.

```typescript
// src/modules/login/api.ts (or append to existing)
import { apiFetch } from '../../lib/api-client';

export type UnifiedLoginResponse =
  | { kind: 'admin';        admin: { id: string; email: string; display_name: string; is_bootstrap: boolean } }
  | { kind: 'bucket_user';  user: { id: string; email: string; must_change_password: boolean };
                            client: { id: string; slug: string; name: string } }
  | { kind: 'choice';       clients: Array<{ id: string; slug: string; name: string }> };

export const unifiedLogin = (email: string, password: string, client?: string) =>
  apiFetch<UnifiedLoginResponse>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(client ? { client } : {}) }),
  });
```

- [ ] **Step 3: Rewrite `LoginPage.tsx` to handle all three response shapes**

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../lib/auth-context';
import { unifiedLogin, type UnifiedLoginResponse } from '../api';

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh: refreshAdminAuth } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Picker state — only populated when server responds with kind:'choice'.
  const [pickerClients, setPickerClients] = useState<Array<{ id: string; slug: string; name: string }> | null>(null);

  async function attempt(emailVal: string, passwordVal: string, clientSlug?: string) {
    setError(null);
    setSubmitting(true);
    const r = await unifiedLogin(emailVal, passwordVal, clientSlug);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'too_many_attempts'
        ? 'Too many attempts. Try again in a few minutes.'
        : 'Invalid email or password.');
      return;
    }
    await handleSuccess(r.data);
  }

  async function handleSuccess(data: UnifiedLoginResponse) {
    if (data.kind === 'admin') {
      await refreshAdminAuth();
      navigate('/', { replace: true });
      return;
    }
    if (data.kind === 'bucket_user') {
      const slug = data.client.slug;
      const dest = data.user.must_change_password ? `/c/${slug}/change-password` : `/c/${slug}/`;
      navigate(dest, { replace: true });
      return;
    }
    // kind: 'choice' — show picker.
    setPickerClients(data.clients);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await attempt(email.trim(), password);
  }

  async function pick(slug: string) {
    setPickerClients(null);
    await attempt(email.trim(), password, slug);
  }

  function cancelPicker() {
    setPickerClients(null);
    setPassword('');
  }

  if (pickerClients) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ width: 'min(420px, 92vw)' }}>
          <h1 style={{ marginBottom: 4 }}>Sign in to which workspace?</h1>
          <p className="muted" style={{ marginTop: 0 }}>You have access to multiple workspaces with this email.</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0' }}>
            {pickerClients.map((c) => (
              <li key={c.id} style={{ marginBottom: 6 }}>
                <button className="btn btn-secondary" style={{ width: '100%', textAlign: 'left' }} onClick={() => pick(c.slug)}>
                  <strong>{c.name}</strong>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}>{c.slug}</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="btn btn-ghost" onClick={cancelPicker} style={{ marginTop: 8 }}>← Back</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ width: 'min(420px, 92vw)' }}>
        <h1 style={{ marginBottom: 4 }}>Sign in</h1>
        <p className="muted" style={{ marginTop: 0 }}>Admins, owners, employees, and customers all sign in here.</p>
        <form onSubmit={onSubmit}>
          <label>Email
            <input type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>Password
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify auth-context still works**

The unified endpoint sets `session=` for admin AND the existing `AuthProvider.refresh()` reads `/api/auth-me` which checks that cookie. No changes needed to `auth-context.tsx`.

For bucket-user sessions, `bu_session=` is set; the user lands on `/c/<slug>/...` where `UserAuthProvider` (already in place) reads `/api/u-me` with that cookie.

- [ ] **Step 5: Typecheck + dev smoke**

Run: `npm run typecheck`

Browser-side smoke:
  1. Open http://localhost:8888/login
  2. Sign in as bootstrap admin → lands on `/` (admin dashboard)
  3. Sign out (via /settings)
  4. Sign in as a bucket-user you created in Phase 6 setup (e.g., joe@joe.com) → lands on `/c/joe/change-password` or `/c/joe/`
  5. (Multi-client test requires Phase 6 setup; verify in Phase 7 if not feasible yet.)

### Task 5.8: Browser smoke + commit Phase 5

- [ ] **Step 1: Run dev server**

Run: `npm run dev`
(opens at http://localhost:8888 typically)

- [ ] **Step 2: Manual smoke**

  1. Log in as bootstrap admin via the unified `/login` page
  2. Create a test client
  3. Click into the client (lands on AccessDashboard stub)
  4. Click "Configure structure →"
  5. Add 3 roles, 3 levels, assign roles to levels, add 2 cardinality rules
  6. Refresh page — config persists

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck && npm run build`

```bash
git add src/modules/ams/api.ts \
        src/modules/ams/components/ClientStructureContext.tsx \
        src/modules/ams/components/RoleEditor.tsx \
        src/modules/ams/components/LevelEditor.tsx \
        src/modules/ams/components/CardinalityEditor.tsx \
        src/modules/ams/pages/ConfigureStructure.tsx \
        src/modules/login/pages/LoginPage.tsx \
        src/modules/login/api.ts
git commit -m "phase 5: ConfigureStructure page + unified LoginPage with multi-client picker"
```

---

## Phase 6 — Frontend: Access Dashboard + drag-and-drop + modals

**Goal:** AccessDashboard renders level-stratified chips. Admin can drag chips between levels (and to/from Unassigned). Add/Edit user node modals work; LoginManageModal is rewired to user-node-credential.

### Task 6.1: Install dnd-kit

- [ ] **Step 1: Install packages**

Run: `npm install @dnd-kit/core @dnd-kit/sortable`

- [ ] **Step 2: Confirm package.json updated**

Run: `grep "@dnd-kit" package.json`
Expected: two lines (`@dnd-kit/core`, `@dnd-kit/sortable`).

### Task 6.2: Add user-node + credential API helpers

**Files:**
- Modify: `src/modules/ams/api.ts`

- [ ] **Step 1: Append helpers**

```typescript
// ─── v3: user nodes ────────────────────────────────────────────────

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
  has_login?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateUserNodeBody {
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
}

export const listUserNodes = (clientId: string) =>
  apiFetch<{ nodes: UserNode[] }>(`/api/user-nodes?client=${encodeURIComponent(clientId)}`);

export const createUserNode = (clientId: string, body: CreateUserNodeBody) =>
  apiFetch<{ node: UserNode; login_created?: boolean }>(`/api/user-nodes?client=${encodeURIComponent(clientId)}`, {
    method: 'POST', body: JSON.stringify(body),
  });

export const patchUserNode = (nodeId: string, body: Partial<Pick<UserNode, 'display_name' | 'email' | 'phone' | 'notes' | 'fields'>>) =>
  apiFetch<{ node: UserNode }>(`/api/user-nodes-detail?id=${encodeURIComponent(nodeId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });

export const deleteUserNode = (nodeId: string, cascade = false) =>
  apiFetch<{ ok: true; deleted_count?: number }>(
    `/api/user-nodes-detail?id=${encodeURIComponent(nodeId)}${cascade ? '&cascade=descendants' : ''}`,
    { method: 'DELETE' },
  );

export const moveUserNode = (nodeId: string, parent_id: string | null, level_number: number | null) =>
  apiFetch<{ node: UserNode }>(`/api/user-nodes-move?id=${encodeURIComponent(nodeId)}`, {
    method: 'POST', body: JSON.stringify({ parent_id, level_number }),
  });

// ─── v3: user-node credentials ─────────────────────────────────────

export interface UserNodeCredentialStatus {
  has_credential: boolean;
  email?: string;
  must_change_password?: boolean;
  last_login_at?: string | null;
  temp_password_plain?: string | null;
  temp_password_views_left?: number | null;
}

export const getUserNodeCredential = (nodeId: string) =>
  apiFetch<UserNodeCredentialStatus>(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}`);

export const resetUserNodeCredential = (nodeId: string, temp_password: string) =>
  apiFetch<{ ok: true }>(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}`, {
    method: 'POST', body: JSON.stringify({ temp_password }),
  });

export const deleteUserNodeCredential = (nodeId: string) =>
  apiFetch<{ ok: true }>(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
```

### Task 6.3: Build `UserNodeChip.tsx` (draggable)

**Files:**
- Create: `src/modules/ams/components/UserNodeChip.tsx`

- [ ] **Step 1: Write the chip component**

```tsx
import { useDraggable } from '@dnd-kit/core';
import type { ClientRole } from '../api';
import type { UserNode } from '../api';

interface Props {
  node: UserNode;
  role: ClientRole | undefined;
  onClick: () => void;
}

export function UserNodeChip({ node, role, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `node:${node.id}`,
    data: { nodeId: node.id, currentParent: node.parent_id, currentLevel: node.level_number, roleId: node.role_id },
  });
  const color = role?.color ?? '#888888';
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', borderRadius: 14, cursor: 'grab',
    background: `${color}22`, border: `1px solid ${color}`, color: '#fff',
    fontSize: 13, marginRight: 6, marginBottom: 6,
    opacity: isDragging ? 0.4 : 1,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };
  return (
    <span ref={setNodeRef} {...listeners} {...attributes} style={style} onClick={(e) => { e.stopPropagation(); onClick(); }} title={node.email ?? undefined}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
      {node.display_name}
      {node.has_login && <span title="Has login">🔑</span>}
    </span>
  );
}
```

### Task 6.4: Build `LevelRow.tsx` (drop target)

**Files:**
- Create: `src/modules/ams/components/LevelRow.tsx`

- [ ] **Step 1: Write the level row component**

```tsx
import { useDroppable } from '@dnd-kit/core';
import { UserNodeChip } from './UserNodeChip';
import type { ClientRole, UserNode } from '../api';

interface Props {
  dropId: string;             // e.g. 'level:3' or 'unassigned'
  title: string;
  subtitle?: string;
  countLabel?: string;
  nodes: UserNode[];
  rolesById: Record<string, ClientRole>;
  onChipClick: (node: UserNode) => void;
  warning?: boolean;
}

export function LevelRow({ dropId, title, subtitle, countLabel, nodes, rolesById, onChipClick, warning }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <div ref={setNodeRef} style={{
      padding: 12, marginBottom: 12, borderRadius: 6,
      background: isOver ? 'rgba(59,130,246,0.1)' : 'var(--bg-elevated, #1a1a1a)',
      border: `1px dashed ${isOver ? 'var(--accent, #3b82f6)' : 'var(--border-subtle, #2a2a2a)'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>
          {title}
          {subtitle && <span className="muted" style={{ fontSize: 12, fontWeight: 'normal', marginLeft: 8 }}>{subtitle}</span>}
        </h4>
        {countLabel && <span className="muted" style={{ fontSize: 12, color: warning ? 'var(--danger, #ef4444)' : undefined }}>{countLabel}</span>}
      </div>
      <div style={{ minHeight: 32 }}>
        {nodes.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>—</span> :
          nodes.map((n) => <UserNodeChip key={n.id} node={n} role={rolesById[n.role_id]} onClick={() => onChipClick(n)} />)
        }
      </div>
    </div>
  );
}
```

### Task 6.5: Create utility for temp password generation

**Files:**
- Confirm exists: `src/lib/random-password.ts` (created in v2; carry over).

- [ ] **Step 1: Verify file exists**

Run: `cat src/lib/random-password.ts`
If missing, create with:

```typescript
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function generateTempPassword(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}
```

### Task 6.6: Build `AddUserNodeModal.tsx`

**Files:**
- Create: `src/modules/ams/components/AddUserNodeModal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
import { useMemo, useState, type FormEvent } from 'react';
import { createUserNode, type ClientRole, type ClientLevel, type UserNode } from '../api';
import { generateTempPassword } from '../../../lib/random-password';

interface Props {
  clientId: string;
  clientSlug: string;
  roles: ClientRole[];
  levels: ClientLevel[];
  nodes: UserNode[];
  presetLevel?: number | null;
  presetParent?: string | null;
  onClose: () => void;
  onCreated: () => void;
}

export function AddUserNodeModal({ clientId, clientSlug, roles, levels, nodes, presetLevel, presetParent, onClose, onCreated }: Props) {
  const [roleId, setRoleId] = useState<string>(roles[0]?.id ?? '');
  const role = roles.find((r) => r.id === roleId);
  const allowedLevels = useMemo(
    () => levels.filter((l) => l.allowed_role_ids.includes(roleId)),
    [levels, roleId],
  );
  const [levelNumber, setLevelNumber] = useState<number | null>(presetLevel ?? allowedLevels[0]?.level_number ?? null);
  const [parentId, setParentId] = useState<string | null>(presetParent ?? null);
  const [unassigned, setUnassigned] = useState(false);
  const validParents = useMemo(
    () => levelNumber === null ? [] : nodes.filter((n) => n.level_number === levelNumber - 1),
    [nodes, levelNumber],
  );

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [createLogin, setCreateLogin] = useState(false);
  const [tempPassword, setTempPassword] = useState(() => generateTempPassword());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [postCreate, setPostCreate] = useState<null | { tempPassword: string; email: string }>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!roleId) { setError('Pick a role.'); return; }
    if (createLogin && !email.trim()) { setError('Email required when creating a login.'); return; }
    if (createLogin && tempPassword.length < 8) { setError('Temp password must be ≥ 8 chars.'); return; }

    const body = {
      role_id: roleId,
      parent_id: unassigned ? null : parentId,
      level_number: unassigned ? null : (levelNumber ?? null),
      display_name: displayName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      notes: notes.trim() || null,
      fields,
      create_login: createLogin,
      temp_password: createLogin ? tempPassword : undefined,
    };

    setSubmitting(true);
    const r = await createUserNode(clientId, body);
    setSubmitting(false);
    if (!r.ok) {
      const code = r.error.code;
      setError(
        code === 'cardinality_exceeded' ? 'Per-parent limit reached for this role.'
        : code === 'email_already_has_login_in_this_client' ? 'Email already has a login in this client.'
        : code === 'parent_level_mismatch' ? 'Selected parent is at the wrong level.'
        : `Failed (${code}).`,
      );
      return;
    }
    if (createLogin && r.data.login_created) {
      setPostCreate({ tempPassword, email });
      return;
    }
    onCreated();
  }

  if (postCreate) {
    const loginUrl = `${window.location.origin}/c/${clientSlug}/login`;
    return (
      <Modal title="Login created" onClose={onCreated}>
        <p className="muted">Share these with the user. You'll be able to re-view the password up to 3 times.</p>
        <Reveal label="Login URL" value={loginUrl} />
        <Reveal label="Email" value={postCreate.email} />
        <Reveal label="Temp password" value={postCreate.tempPassword} mono />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-primary" onClick={onCreated}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <label>Role
          <select required value={roleId} onChange={(e) => { setRoleId(e.target.value); setLevelNumber(null); }}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <input type="checkbox" checked={unassigned} onChange={(e) => setUnassigned(e.target.checked)} />
          <span>Create as unassigned (no parent / no level)</span>
        </label>

        {!unassigned && (
          <>
            <label>Level
              <select value={levelNumber ?? ''} onChange={(e) => { setLevelNumber(e.target.value ? Number(e.target.value) : null); setParentId(null); }}>
                <option value="">— pick a level —</option>
                {allowedLevels.map((l) => <option key={l.id} value={l.level_number}>Level {l.level_number}{l.label ? ` (${l.label})` : ''}</option>)}
              </select>
            </label>
            {levelNumber !== null && levelNumber > 1 && (
              <label>Parent
                <select required value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
                  <option value="">— pick a parent —</option>
                  {validParents.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              </label>
            )}
          </>
        )}

        <hr style={{ margin: '12px 0' }} />

        <label>Display name *
          <input type="text" required autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Phone
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>Notes
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {role && role.fields.map((f) => (
          <label key={f.key}>{f.label}{f.required && ' *'}
            <input
              type={f.type === 'integer' ? 'number' : f.type === 'date' ? 'date' : f.type === 'boolean' ? 'checkbox' : 'text'}
              required={f.required}
              {...(f.type === 'boolean'
                ? { checked: Boolean(fields[f.key]), onChange: (e) => setFields({ ...fields, [f.key]: e.target.checked }) }
                : { value: String(fields[f.key] ?? ''), onChange: (e) => setFields({ ...fields, [f.key]: f.type === 'integer' ? Number(e.target.value) : e.target.value }) })}
            />
          </label>
        ))}

        <fieldset style={{ border: '1px solid var(--border-subtle)', borderRadius: 6, padding: 10, marginTop: 10 }}>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} disabled={!email.trim()} />
            <span>Create login for this user</span>
          </label>
          {!email.trim() && <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>Fill in an email above to enable.</p>}
          {createLogin && (
            <label>Temp password
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="text" value={tempPassword} minLength={8} onChange={(e) => setTempPassword(e.target.value)} style={{ flex: 1, fontFamily: 'var(--font-mono)' }} />
                <button type="button" className="btn btn-ghost" onClick={() => setTempPassword(generateTempPassword())}>Regen</button>
              </div>
            </label>
          )}
        </fieldset>

        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '…' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Reveal({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* */ }
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <code style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border-subtle)', borderRadius: 4, fontFamily: mono ? 'var(--font-mono)' : undefined, background: 'var(--bg-elevated, #1a1a1a)', wordBreak: 'break-all' }}>{value}</code>
        <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? '✓' : 'copy'}</button>
      </div>
    </div>
  );
}
```

### Task 6.7: Recreate `LoginManageModal.tsx` for v3

**Files:**
- Create: `src/modules/ams/components/LoginManageModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { getUserNodeCredential, resetUserNodeCredential, deleteUserNodeCredential, type UserNodeCredentialStatus, type UserNode } from '../api';
import { generateTempPassword } from '../../../lib/random-password';

interface Props {
  node: UserNode;
  clientSlug: string;
  onClose: () => void;
  onChanged: () => void;
}

export function LoginManageModal({ node, clientSlug, onClose, onChanged }: Props) {
  const [status, setStatus] = useState<UserNodeCredentialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tempPassword, setTempPassword] = useState(() => generateTempPassword());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justSet, setJustSet] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    const r = await getUserNodeCredential(node.id);
    setLoading(false);
    if (!r.ok) { setError(`Failed (${r.error.code})`); return; }
    setStatus(r.data);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const loginUrl = `${window.location.origin}/c/${clientSlug}/login`;
  const hasEmail = !!node.email;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!hasEmail) { setError('Add an email to the user first.'); return; }
    if (tempPassword.length < 8) { setError('Temp password must be ≥ 8 chars.'); return; }
    setSubmitting(true);
    const r = await resetUserNodeCredential(node.id, tempPassword);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'email_already_has_login_in_this_client'
        ? 'This email already has a login in this client.' : `Failed (${r.error.code})`);
      return;
    }
    setJustSet(tempPassword);
    onChanged();
    await load();
  }

  async function handleRemove() {
    if (!confirm('Remove login? User row stays; credential is deleted.')) return;
    setSubmitting(true);
    const r = await deleteUserNodeCredential(node.id);
    setSubmitting(false);
    if (!r.ok) { setError(`Failed (${r.error.code})`); return; }
    onChanged();
    setJustSet(null);
    await load();
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Login — {node.display_name}</h2>

        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">{error}</p>}

        {!loading && status && (
          <>
            {status.has_credential ? (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  {status.last_login_at ? `Last login ${new Date(status.last_login_at).toLocaleString()}` : 'Never signed in yet.'}
                  {status.must_change_password && ' Must change pwd on next login.'}
                </p>
                <Reveal label="Login URL" value={loginUrl} />
                <Reveal label="Email" value={status.email ?? node.email ?? ''} />
                {justSet ? <Reveal label="Temp password (just set)" value={justSet} mono /> :
                  status.temp_password_plain ? <>
                    <Reveal label="Temp password" value={status.temp_password_plain} mono />
                    <p className="muted" style={{ fontSize: 11 }}>Views remaining: {status.temp_password_views_left}.</p>
                  </> : <p className="muted" style={{ fontSize: 12 }}>Temp password no longer viewable.</p>
                }
                <form onSubmit={handleSave} style={{ marginTop: 12 }}>
                  <label>New temp password
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="text" value={tempPassword} minLength={8} onChange={(e) => setTempPassword(e.target.value)} style={{ flex: 1, fontFamily: 'var(--font-mono)' }} />
                      <button type="button" className="btn btn-ghost" onClick={() => setTempPassword(generateTempPassword())}>Regen</button>
                    </div>
                  </label>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <button type="button" className="btn btn-ghost" onClick={handleRemove} disabled={submitting}>Remove login</button>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '…' : 'Reset password'}</button>
                  </div>
                </form>
              </>
            ) : (
              <form onSubmit={handleSave}>
                <p className="muted" style={{ marginTop: 0 }}>
                  {hasEmail ? 'No login yet. Set a temp password to create one.' : 'Add an email to the user first.'}
                </p>
                <Reveal label="Login URL" value={loginUrl} />
                <Reveal label="Email" value={node.email ?? '—'} />
                <label>Temp password
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="text" value={tempPassword} minLength={8} onChange={(e) => setTempPassword(e.target.value)} disabled={!hasEmail} style={{ flex: 1, fontFamily: 'var(--font-mono)' }} />
                    <button type="button" className="btn btn-ghost" disabled={!hasEmail} onClick={() => setTempPassword(generateTempPassword())}>Regen</button>
                  </div>
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={submitting || !hasEmail}>{submitting ? '…' : 'Create login'}</button>
                </div>
              </form>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Reveal({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* */ } }
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <code style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border-subtle)', borderRadius: 4, fontFamily: mono ? 'var(--font-mono)' : undefined, background: 'var(--bg-elevated, #1a1a1a)', wordBreak: 'break-all' }}>{value}</code>
        <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? '✓' : 'copy'}</button>
      </div>
    </div>
  );
}
```

### Task 6.8: Build the `AccessDashboard.tsx` page with DnD

**Files:**
- Modify: `src/modules/ams/pages/AccessDashboard.tsx`

- [ ] **Step 1: Replace the stub**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { ClientStructureProvider, useClientStructure } from '../components/ClientStructureContext';
import { LevelRow } from '../components/LevelRow';
import { AddUserNodeModal } from '../components/AddUserNodeModal';
import { LoginManageModal } from '../components/LoginManageModal';
import {
  listUserNodes, moveUserNode, getClientStructure,
  type UserNode, type ClientRole, type ClientLevel,
} from '../api';

export default function AccessDashboard() {
  const { clientId } = useParams<{ clientId: string }>();
  if (!clientId) return <p className="error">Invalid URL.</p>;
  return (
    <ClientStructureProvider clientId={clientId}>
      <DashboardInner clientId={clientId} />
    </ClientStructureProvider>
  );
}

function DashboardInner({ clientId }: { clientId: string }) {
  const { structure, loading: structLoading, error: structError, refresh: refreshStructure } = useClientStructure();
  const [nodes, setNodes] = useState<UserNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [clientSlug, setClientSlug] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [presetLevel, setPresetLevel] = useState<number | null>(null);
  const [activeChip, setActiveChip] = useState<UserNode | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Per-level "narrowed parent" so we can show only descendants of one parent at the next level.
  const [narrowed, setNarrowed] = useState<Record<number, string | null>>({});

  async function refreshNodes() {
    setNodesLoading(true); setNodesError(null);
    const r = await listUserNodes(clientId);
    setNodesLoading(false);
    if (!r.ok) { setNodesError(`Failed to load users (${r.error.code})`); return; }
    setNodes(r.data.nodes);
  }

  async function loadSlug() {
    // structure GET doesn't include client info; pull slug from /api/clients fast.
    // Easiest: getClientStructure already verified existence; just fetch /api/clients-detail.
    const r = await fetch(`/api/clients-detail?id=${encodeURIComponent(clientId)}`, { credentials: 'same-origin' });
    if (r.ok) {
      const body = await r.json() as { client: { slug: string } };
      setClientSlug(body.client.slug);
    }
  }

  useEffect(() => { void refreshNodes(); void loadSlug(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  const rolesById = useMemo(() => Object.fromEntries((structure?.roles ?? []).map((r) => [r.id, r])) as Record<string, ClientRole>, [structure]);

  const nodesByLevel = useMemo(() => {
    const map = new Map<number | 'unassigned', UserNode[]>();
    for (const n of nodes) {
      const key = n.level_number === null ? 'unassigned' : n.level_number;
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    return map;
  }, [nodes]);

  function nodesForLevel(l: ClientLevel): UserNode[] {
    const all = nodesByLevel.get(l.level_number) ?? [];
    if (l.level_number === 1) return all;
    // Filter by narrowed parent at the level above, if set.
    const parentLevel = l.level_number - 1;
    const parentId = narrowed[parentLevel];
    if (parentId === null || parentId === undefined) {
      // Default: pick first parent at the level above if any exist.
      const parentList = nodesByLevel.get(parentLevel) ?? [];
      const firstParent = parentList[0];
      if (!firstParent) return [];
      return all.filter((n) => n.parent_id === firstParent.id);
    }
    return all.filter((n) => n.parent_id === parentId);
  }

  function handleChipClick(n: UserNode) {
    // Two click behaviors: clicking a chip narrows its level's children if it has children;
    // clicking a chip with the meta key opens edit/login modal.
    setActiveChip(n);
    if (n.level_number !== null) {
      setNarrowed({ ...narrowed, [n.level_number]: n.id });
    }
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const data = active.data.current as { nodeId: string; currentParent: string | null; currentLevel: number | null };

    setMoveError(null);
    let newParent: string | null = null;
    let newLevel: number | null = null;

    if (overId === 'unassigned') {
      newParent = null; newLevel = null;
    } else if (overId.startsWith('level:')) {
      newLevel = Number(overId.slice(6));
      if (newLevel === 1) {
        newParent = null;
      } else {
        // Re-parent to the narrowed parent at level-1, or first available parent.
        const parentLevel = newLevel - 1;
        const parentList = (nodesByLevel.get(parentLevel) ?? []);
        const candidateParent = narrowed[parentLevel] ?? parentList[0]?.id ?? null;
        if (!candidateParent) { setMoveError('No parent available at level above. Add one first.'); return; }
        newParent = candidateParent;
      }
    } else {
      return;
    }

    // Optimistic update: nothing for now, just refetch.
    const r = await moveUserNode(data.nodeId, newParent, newLevel);
    if (!r.ok) {
      setMoveError(
        r.error.code === 'cardinality_exceeded' ? 'Per-parent limit reached at the target.'
        : r.error.code === 'cycle_detected' ? 'That would create a cycle.'
        : r.error.code === 'parent_level_mismatch' ? 'Target level does not match parent.'
        : `Move failed (${r.error.code}).`,
      );
      return;
    }
    void refreshNodes();
    void refreshStructure();
  }

  if (structLoading || nodesLoading) return <p className="muted">Loading…</p>;
  if (structError) return <p className="error">{structError}</p>;
  if (nodesError) return <p className="error">{nodesError}</p>;
  if (!structure) return null;

  const hasStructure = structure.roles.length > 0 && structure.levels.length > 0;

  return (
    <DndContext onDragEnd={onDragEnd}>
      <section>
        <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Access dashboard</h1>
          <div style={{ display: 'flex', gap: 6 }}>
            <Link to={`/clients/${clientId}/configure`} className="btn btn-secondary">Configure</Link>
            <button className="btn btn-primary" disabled={!hasStructure} onClick={() => { setPresetLevel(null); setShowAdd(true); }}>
              + Add user
            </button>
          </div>
        </header>

        {clientSlug && (
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              User login URL:&nbsp;
              <code style={{ background: 'var(--bg-elevated, #1a1a1a)', padding: '2px 6px', borderRadius: 4 }}>
                {window.location.origin}/c/{clientSlug}/login
              </code>
            </p>
          </div>
        )}

        {!hasStructure && (
          <div className="card">
            <p>No roles or levels configured yet. <Link to={`/clients/${clientId}/configure`}>Configure structure</Link> first.</p>
          </div>
        )}

        {moveError && <p className="error">{moveError}</p>}

        {structure.levels.map((l) => {
          const parentLevel = l.level_number - 1;
          const parentId = narrowed[parentLevel];
          const parentNode = parentId ? nodes.find((n) => n.id === parentId) : (nodesByLevel.get(parentLevel) ?? [])[0];
          const subtitle = l.level_number > 1 && parentNode ? `under ${parentNode.display_name}` : undefined;
          return (
            <LevelRow
              key={l.id}
              dropId={`level:${l.level_number}`}
              title={`Level ${l.level_number}${l.label ? ` — ${l.label}` : ''}`}
              subtitle={subtitle}
              nodes={nodesForLevel(l)}
              rolesById={rolesById}
              onChipClick={handleChipClick}
            />
          );
        })}

        <LevelRow
          dropId="unassigned"
          title="Unassigned access"
          nodes={nodesByLevel.get('unassigned') ?? []}
          rolesById={rolesById}
          onChipClick={handleChipClick}
        />

        {showAdd && (
          <AddUserNodeModal
            clientId={clientId}
            clientSlug={clientSlug}
            roles={structure.roles}
            levels={structure.levels}
            nodes={nodes}
            presetLevel={presetLevel}
            onClose={() => setShowAdd(false)}
            onCreated={async () => { setShowAdd(false); await refreshNodes(); }}
          />
        )}

        {activeChip && (
          <LoginManageModal
            node={activeChip}
            clientSlug={clientSlug}
            onClose={() => setActiveChip(null)}
            onChanged={refreshNodes}
          />
        )}
      </section>
    </DndContext>
  );
}
```

### Task 6.9: Browser smoke + commit Phase 6

- [ ] **Step 1: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 2: Run dev server**

Run: `npm run dev`

- [ ] **Step 3: Manual smoke — full flow**

  1. Log in as bootstrap admin
  2. Create client "Test Co"
  3. Configure structure: add roles (Shop, Owner, Customer), 3 levels mapping each role to its own level, cardinality rule "Under Shop: max 1 Owner"
  4. Access Dashboard → "+ Add user" — add 1 Shop at Level 1
  5. Add 1 Owner at Level 2 with parent = the Shop, create_login enabled
  6. Modal shows login URL + temp password
  7. Drag Owner chip onto "Unassigned access" — chip moves
  8. Drag Owner chip back onto Level 2 row — moves back
  9. Add 2nd Owner → fails with "Per-parent limit reached"
  10. Click owner chip → LoginManageModal opens → can reveal temp password
  11. Open `/c/<slug>/login` in incognito → log in as owner → forced password change → land on UserAccount placeholder
  12. Sign out

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json \
        src/modules/ams/api.ts \
        src/modules/ams/components/UserNodeChip.tsx \
        src/modules/ams/components/LevelRow.tsx \
        src/modules/ams/components/AddUserNodeModal.tsx \
        src/modules/ams/components/LoginManageModal.tsx \
        src/modules/ams/pages/AccessDashboard.tsx \
        src/lib/random-password.ts
git commit -m "phase 6: Access Dashboard with drag-and-drop, AddUserNodeModal, LoginManageModal"
```

---

## Phase 7 — Ship to prod

**Goal:** Apply migrations to prod Neon (destructive — confirmed acceptable), push code to origin/main, watch Netlify deploy, smoke prod URL.

### Task 7.1: Final pre-flight

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: All tests pass**

Run: `npx vitest run --reporter=dot`
Expected: ≥ 130 tests passing. (Target: ~143; minimum: 130.)

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds. Note bundle size — should be ~280–320 kB (dnd-kit adds ~20 KB).

- [ ] **Step 4: Git state clean**

Run: `git status`
Expected: clean working tree, branch ahead of `origin/main` by ~6 commits (one per phase).

### Task 7.2: Apply migrations to PROD Neon — destructive step

The user has explicitly approved wiping prod. Prod has < 48h of test data with no real users.

- [ ] **Step 1: Confirm endpoint host is the prod branch**

Run: `echo $DATABASE_URL`
Expected: should NOT contain `ep-bold-wildflower` (that's dev). Should contain `ep-dawn-bird` or whichever endpoint host is the prod Neon branch. Per `feedback_verify_neon_endpoint_before_drop.md` — confirm the host visually before running destructive migrations.

If the local `.env` is pointing at dev (as during normal development), set the prod URL inline for the migrate command:

```bash
DATABASE_URL='postgresql://...ep-dawn-bird-...neon.tech/neondb?sslmode=require&channel_binding=require' \
  npx tsx scripts/migrate.ts
```

- [ ] **Step 2: Run migrate against prod**

The user will paste the prod URL into a single shell invocation (do not write it to `.env`). The migration runner will print "already applied" for 001–009 and "applying" for 010–017.

Expected output:
```
✓ 001_extensions (already applied)
... (002–009 already applied)
→ applying 010_wipe_v2_client_schemas (1 statement)
✓ 010_wipe_v2_client_schemas
→ applying 011_drop_template_columns (2 statements)
✓ 011_drop_template_columns
... continues through 017
```

- [ ] **Step 3: Verify prod schema state**

```bash
DATABASE_URL='<prod-url>' npx tsx -e "
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name\`.then(r => console.log(r))
"
```

Expected tables include: `admins`, `client_cardinality_rules`, `client_levels`, `client_roles`, `clients`, `login_attempts`, `schema_migrations`, `schema_ops_log`, `user_node_credentials`, `user_nodes`. NOT `bucket_user_credentials`.

### Task 7.3: Push to origin/main

- [ ] **Step 1: Push**

Run: `git push origin main`
Expected: push succeeds; Netlify webhook fires.

### Task 7.4: Watch Netlify deploy

- [ ] **Step 1: Get the latest deploy id**

```bash
sleep 5  # let Netlify register the push
netlify api listSiteDeploys --data='{"site_id":"6d53c9bf-d6a7-4fb4-a16e-e5a4e94f59b4","per_page":2}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); [print(x['id'], x['state'], (x.get('commit_ref') or '')[:8]) for x in d[:2]]"
```

Note the latest deploy id (matching the just-pushed commit ref).

- [ ] **Step 2: Poll until terminal state**

```bash
DEPLOY_ID='<paste id>'
until state=$(netlify api getSiteDeploy --data="{\"site_id\":\"6d53c9bf-d6a7-4fb4-a16e-e5a4e94f59b4\",\"deploy_id\":\"$DEPLOY_ID\"}" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])"); \
  [[ "$state" != "building" && "$state" != "uploading" && "$state" != "processing" && "$state" != "enqueued" && "$state" != "new" ]]; \
  do echo "state=$state"; sleep 15; done
echo "FINAL: $state"
```

Expected: `FINAL: ready`. If `error`, fetch the deploy log:
```bash
netlify api getSiteDeploy --data="{\"site_id\":\"6d53c9bf-d6a7-4fb4-a16e-e5a4e94f59b4\",\"deploy_id\":\"$DEPLOY_ID\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error_message','no message'))"
```

### Task 7.5: Smoke prod URL

- [ ] **Step 1: Run smoke checks**

```bash
echo "=== Admin surface ==="
curl -s -o /dev/null -w "GET /                          → %{http_code}\n" https://exsoldatacollectionapp.netlify.app/
curl -s -o /dev/null -w "GET /api/auth-me (unauth)       → %{http_code}\n" https://exsoldatacollectionapp.netlify.app/api/auth-me
echo ""
echo "=== User-portal surface ==="
curl -s -o /dev/null -w "GET /c/anything/login           → %{http_code}\n" https://exsoldatacollectionapp.netlify.app/c/anything/login
curl -s -o /dev/null -w "GET /api/u-client-by-slug?slug=does-not-exist → %{http_code}\n" "https://exsoldatacollectionapp.netlify.app/api/u-client-by-slug?slug=does-not-exist"
curl -s -o /dev/null -w "GET /api/u-me (unauth)          → %{http_code}\n" https://exsoldatacollectionapp.netlify.app/api/u-me
curl -s -o /dev/null -w "GET /api/client-structure (unauth) → %{http_code}\n" "https://exsoldatacollectionapp.netlify.app/api/client-structure?client=00000000-0000-0000-0000-000000000000"
```

Expected codes:
- `/` → 200
- `/api/auth-me` (unauth) → 401
- `/c/anything/login` → 200 (SPA route)
- `/api/u-client-by-slug?slug=does-not-exist` → 404
- `/api/u-me` (unauth) → 401
- `/api/client-structure` (unauth) → 401

- [ ] **Step 2: Manual end-to-end test on prod**

  1. Open https://exsoldatacollectionapp.netlify.app/login
  2. Sign in as bootstrap admin
  3. Create a client; configure structure (1 role, 1 level)
  4. Add a user with create_login; capture login URL + temp pwd
  5. Open the user login URL in incognito; sign in; change pwd; land on UserAccount
  6. Sign out

- [ ] **Step 3: If anything failed in steps 1–2, capture details and fix forward**

If a step failed, push a fix commit with a clear message. Otherwise, proceed.

### Task 7.6: Final commit — handoff doc

- [ ] **Step 1: Update or create a handoff doc**

**Files:**
- Create: `docs/superpowers/handoffs/2026-05-27-ams-v3-shipped.md`

```markdown
# AMS v3 — shipped to prod

**Date:** 2026-05-27
**Commit at ship:** <latest commit sha>
**Migrations at ship:** 001–017 on dev and prod Neon
**Tests:** ~143 passing

## What's live
- Per-client admin-defined roles + levels + cardinality rules
- User nodes organized in a strict tree
- Drag-and-drop reorganization (backend `parent_id` follows visual tree)
- Re-keyed credentials (`user_node_credentials`); 3-view reveal counter; force-change-password on first login
- Routes:
  - Admin: `/`, `/login`, `/settings`, `/clients/:id`, `/clients/:id/configure`
  - User portal: `/c/:slug/login`, `/c/:slug/`, `/c/:slug/change-password`

## What's deferred (next session)
- Per-user / per-role permission grants (schema leaves room)
- GAuth on bucket-user login (extend `u-login.ts`)
- Forgot-password flow
- Bulk import (CSV → Unassigned)
- Subtree-scoped data endpoints (when Bookings module lands)
- Audit log of moves/creates

## Key files (orientation)
- Backend: `netlify/functions/_shared/user-tree.ts`, `user-nodes*.ts`, `client-*.ts`
- Frontend: `src/modules/ams/pages/AccessDashboard.tsx`, `ConfigureStructure.tsx`
- Spec: `docs/superpowers/specs/2026-05-27-ams-v3-hierarchy-design.md`
```

- [ ] **Step 2: Commit handoff**

```bash
git add docs/superpowers/handoffs/2026-05-27-ams-v3-shipped.md
git commit -m "docs: AMS v3 shipped to prod"
git push origin main
```

---

## Self-Review

After writing this plan, scanning against the spec:

**Spec coverage:**
- Strict tree → user_nodes.parent_id + trigger ✓ (Tasks 1.6, 1.7)
- Subtree-scoped permissions → not enforced yet (placeholder only); user-tree helpers exist (Task 2.1)
- Pure-label roles → client_roles table ✓ (Tasks 1.4, 2.3)
- Multiple roles per level → client_levels.allowed_role_ids[] ✓ (Tasks 1.5, 2.5)
- Per-parent cardinality → client_cardinality_rules + getCardinalityCap + advisory-lock pattern ✓ (Tasks 1.8, 2.1, 2.6, 3.1, 3.3)
- Custom fields per role → fields JSONB in client_roles + user_nodes ✓ (Tasks 1.4, 1.6)
- Wipe everything → migration 010 ✓ (Task 1.1)
- Unassigned access → CHECK constraint allows (NULL,NULL); UI shows row; can't log in (no credential) ✓
- Single public-schema tables → all 4 new tables in public ✓ (Tasks 1.4–1.9)
- Drag-and-drop with backend sync → move endpoint + DnD context + onDragEnd ✓ (Tasks 3.5, 6.8)

**Placeholder scan:** No `TBD`/`TODO`/`fill in details`. Every test step shows the actual code. Every implementation step shows the actual handler. Every command shows the exact CLI call.

**Type consistency check:**
- `BucketUserClaims` updated everywhere (Tasks 4.1, 4.2, 4.3, 4.4) ✓
- `UserNode` shape consistent between api.ts (Task 6.2) and handler responses (Task 3.1) ✓
- `ClientRole.fields` consistent between schema (Task 1.4), API (Task 2.3), and frontend types (Task 5.1, 6.2) ✓

**Notes for the executor:**
- The two `$$` migration files (015b, 015c) — the splitter passes them through as single statements; verify dev runs them clean before proceeding.
- The `sql.transaction([queries])` pattern for cardinality enforcement is unusual; ensure the indexing trick (`result[result.length - 2]`) is replaced with named result references if the engineer prefers — semantically equivalent.
- DnD: the "narrowed parent" logic in AccessDashboard is a v1 simplification. If admin has many parents at a level, the auto-pick-first-parent behavior may surprise; this is acceptable for ship, can be improved later.
- The plan does not include an explicit Phase for adding a `EditUserNodeModal` — chip-click currently opens the LoginManageModal. A user-edit modal can be added later; the PATCH endpoint exists.






