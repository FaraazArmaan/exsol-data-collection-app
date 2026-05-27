# AMS v3 — Hierarchical Access Control Overhaul (Design)

**Date:** 2026-05-27
**Status:** Approved through brainstorming; awaiting user spec review before implementation planning
**Supersedes:** `2026-05-26-ams-module-design.md` (v2), `2026-05-26-bucket-user-auth-design.md`
**Predecessor in prod:** Phases 0–9 (admin auth, flat bucket templates, slug-based user portal)

## TL;DR

Replace the v2 flat-bucket / hardcoded-template AMS with a per-client hierarchical org tree:

- **Per-client custom role types** (admin defines "Owner", "Doctor", "Vendor" etc.) — no developer template files.
- **Per-client custom level structure** (Level 1..N), each level admitting any subset of roles.
- **Strict tree** of users — every user except top-level has exactly one parent.
- **Permissions follow the subtree** (a user sees descendants, not siblings or peers).
- **Drag-and-drop** in the admin dashboard reorganizes the tree both visually and in the database — the adjacency-list `parent_id` IS the file structure.
- **Wipe and replace** — all v2 client data (≤ 24h old, no real users) is dropped.

This removes ~600 lines of v2 template/bucket infrastructure and replaces them with four small generic tables + a richer admin UX.

## Goals

1. Admin onboards a client → client (or admin) defines role types and the level hierarchy that fits their business.
2. Same role labels can sit at different levels for different clients (Shop is L1 for Client A; Shop is L2 under an Owner for Client B).
3. Users are organized into a tree; admin reorganizes by dragging chips between levels and parents.
4. Auth substrate from v2 survives: `/c/<slug>/login`, `bu_session` cookie, JWT kind enforcement, reveal-counter on temp passwords — all unchanged.

## Non-goals (deferred)

- Per-user or per-role permission grants beyond subtree scope (future iteration).
- Forgot-password flow / Resend-based email delivery of temp passwords.
- Google Sign-In for bucket users (`u-login` is extensible for it).
- Bulk CSV import into the Unassigned bucket.
- Per-node audit log of moves/creates.
- Workspace features (Bookings, data modules) for logged-in bucket users.

## Brainstormed decisions (locked in)

| # | Question | Decision |
| -- | -- | -- |
| 1 | Tree or graph? | Strict tree — exactly one `parent_id` (or NULL for top-level / unassigned) |
| 2 | Level semantics | Position in tree; permissions follow subtree; level number = depth (no privilege rank) |
| 3 | Role semantics | Pure labels (name + color + custom field schema). Per-user permission grants are a future expansion; schema leaves room. |
| 4 | Roles per level | Multiple allowed (each level has an `allowed_role_ids[]`) |
| 5 | Cardinality | Per-parent caps ("each Shop has up to 3 Owners") |
| 6 | Custom fields | Per role (defined in `client_roles.fields` JSONB), values stored in `user_nodes.fields` JSONB |
| 7 | Existing v2 prod data | Wipe — drop all `client_<id>` schemas, truncate `clients`, drop `bucket_user_credentials` |
| 8 | "Unassigned Access" | Allowed limbo state (`parent_id IS NULL AND level_number IS NULL`); unassigned users CANNOT log in |
| 9 | Schema location | Approach A — single public-schema tables with `client_id` discriminator (no more per-client Postgres schemas) |
| 10 | Drag-and-drop | First-class: backend `move` endpoint is the source of truth; UI optimistically updates and rolls back on error |

## Conceptual model

```
┌──────────────────────────────────────────────────────────┐
│  CLIENT (e.g., "Joe's Hardware")                         │
│                                                          │
│  ROLES (admin-defined labels — per client)               │
│   🔴 shop      🔵 owner    🟢 empA    🟣 empB    🟡 cust │
│                                                          │
│  LEVELS (admin-defined depths, with allowed roles)       │
│   Level 1 → [shop]                                       │
│   Level 2 → [owner]                                      │
│   Level 3 → [empA]                                       │
│   Level 4 → [empB]                                       │
│   Level 5 → [cust]                                       │
│                                                          │
│  TREE (user nodes connected by parent_id)                │
│       shop#1                                             │
│      ╱  │  ╲                                             │
│  own#1 own#2 own#3                                       │
│   │     │                                                │
│  empA#1 empA#2                                           │
│   │                                                      │
│  cust#1                                                  │
│                                                          │
│  PER-PARENT CARDINALITY RULES                            │
│   "Under a shop, at most 3 owners"                       │
│   "Under an owner, at most 5 empA"                       │
│   "Under an empA, unlimited customers"                   │
└──────────────────────────────────────────────────────────┘
```

**Three orthogonal pieces of configuration** + **one tree of data**.

### Invariants

| Invariant | Where enforced |
| --- | --- |
| Every user_node has a role; role belongs to the same client | DB FK + (client_id discriminator) |
| `user_node.level_number` matches one of the levels whose `allowed_role_ids` contains the node's `role_id` | API |
| Parent's level number = child's level number − 1 (or parent is NULL only when child is level 1 OR unassigned) | DB trigger |
| Parent + child are in the same client | DB trigger |
| Children-of-a-given-parent with role R ≤ cardinality cap | API (transactional row-lock pattern) |
| Tree has no cycles | API check at insert/move time |

## Data model

### `public.client_roles`

```sql
CREATE TABLE public.client_roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  key            text NOT NULL,    -- admin's slug, e.g. 'employee_a'
  label          text NOT NULL,    -- 'Employee — Primary'
  color          text NOT NULL,    -- '#22c55e' etc.
  fields         jsonb NOT NULL DEFAULT '[]'::jsonb,
                                   -- [{key, label, type, required, default?, help?, display_in_list?}]
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, key)
);
```

### `public.client_levels`

```sql
CREATE TABLE public.client_levels (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  level_number        integer NOT NULL CHECK (level_number > 0),
  label               text,
  allowed_role_ids    uuid[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, level_number)
);
```

### `public.user_nodes`

```sql
CREATE TABLE public.user_nodes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  parent_id           uuid REFERENCES public.user_nodes(id) ON DELETE RESTRICT,
  level_number        integer,    -- NULL = unassigned
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
  CHECK (
    (level_number IS NULL AND parent_id IS NULL) OR
    (level_number = 1 AND parent_id IS NULL) OR
    (level_number > 1 AND parent_id IS NOT NULL)
  )
);

CREATE INDEX user_nodes_client_parent_idx ON public.user_nodes (client_id, parent_id);
CREATE INDEX user_nodes_client_level_idx  ON public.user_nodes (client_id, level_number);
CREATE UNIQUE INDEX user_nodes_email_per_client_idx
  ON public.user_nodes (client_id, lower(email)) WHERE email IS NOT NULL;

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

CREATE TRIGGER user_nodes_validate_trig
  BEFORE INSERT OR UPDATE ON public.user_nodes
  FOR EACH ROW EXECUTE FUNCTION public.user_nodes_validate();

CREATE TRIGGER user_nodes_set_updated_at
  BEFORE UPDATE ON public.user_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### `public.client_cardinality_rules`

```sql
CREATE TABLE public.client_cardinality_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  parent_role_id  uuid REFERENCES public.client_roles(id) ON DELETE CASCADE,
                                       -- NULL = applies to top-level (no parent role)
  child_role_id   uuid NOT NULL REFERENCES public.client_roles(id) ON DELETE CASCADE,
  max_children    integer NOT NULL CHECK (max_children >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, parent_role_id, child_role_id)
);
```

Enforcement note: cardinality is checked **in the API** inside a transaction that first acquires a `SELECT … FOR UPDATE` lock on the parent row, then counts children, then inserts/moves. CHECK constraints can't span rows; a trigger using `SELECT COUNT(*)` is vulnerable to phantom-read races.

### `public.user_node_credentials` (renamed from `bucket_user_credentials`)

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

Real FK + ON DELETE CASCADE: deleting a user node automatically removes its credential.

### `public.clients` — adjusted

Drop two columns no longer needed (templates are gone):

```sql
ALTER TABLE public.clients DROP COLUMN template_key;
ALTER TABLE public.clients DROP COLUMN template_version_applied;
```

`slug` column stays.

## API endpoints

### Structure config (admin auth)

| Method | Path | Purpose |
| --- | --- | --- |
| GET    | `/api/client-structure?client=<id>` | Returns `{roles, levels, cardinality_rules}` — used for config UI and form validation |
| POST   | `/api/client-roles?client=<id>` | Create role: `{key, label, color, fields?}` |
| PATCH  | `/api/client-roles-detail?id=<role_id>` | Edit role |
| DELETE | `/api/client-roles-detail?id=<role_id>` | Delete role; 409 `role_in_use` if any node references it |
| POST   | `/api/client-levels?client=<id>` | Create level: `{level_number, label?, allowed_role_ids[]}` |
| PATCH  | `/api/client-levels-detail?id=<level_id>` | Edit level's label / allowed_role_ids |
| DELETE | `/api/client-levels-detail?id=<level_id>` | Delete level; 409 `level_in_use` if any node sits at it |
| PUT    | `/api/client-cardinality?client=<id>` | Replace full cardinality ruleset atomically with `{rules: [{parent_role_id?, child_role_id, max_children}, ...]}` |

### User nodes (admin auth)

| Method | Path | Purpose |
| --- | --- | --- |
| GET    | `/api/user-nodes?client=<id>` | Returns ALL nodes for the client as flat list (UI builds the tree). Includes derived `credential_status` per node. |
| POST   | `/api/user-nodes?client=<id>` | Create node: `{role_id, parent_id?, level_number?, display_name, email?, phone?, notes?, fields?, create_login?, temp_password?}` |
| GET    | `/api/user-nodes-detail?id=<node_id>` | Single node with `children_count` |
| PATCH  | `/api/user-nodes-detail?id=<node_id>` | Edit node fields (NOT structural — see `/move` for that) |
| DELETE | `/api/user-nodes-detail?id=<node_id>[&cascade=descendants]` | Delete node. Default refuses if has children (409 `has_children`); `?cascade=descendants` removes the whole subtree |
| POST   | `/api/user-nodes-move?id=<node_id>` | **Drag-and-drop endpoint.** Body `{parent_id, level_number}`. Atomically validates + re-parents + re-levels descendants. See "Move endpoint logic" below. |

### Bucket-user credentials (renamed)

| Method | Path | Purpose |
| --- | --- | --- |
| GET    | `/api/user-node-credential?node=<id>` | Status + plaintext (decrements reveal counter) |
| POST   | `/api/user-node-credential?node=<id>` | Reset: `{temp_password}` |
| DELETE | `/api/user-node-credential?node=<id>` | Remove login (node row stays) |

### Move endpoint logic

```
POST /api/user-nodes-move?id=<node_id>
Body: { parent_id: <uuid> | null, level_number: <int> | null }

Inside ONE transaction:
  1. Lock the node row (SELECT FOR UPDATE).
  2. If parent_id == null AND level_number == null:
       → moving to Unassigned.
       → Cycle check: skip (we're un-placing).
       → Cardinality check: skip.
       → UPDATE the node + all descendants: parent_id stays, level_number := NULL,
         except the moving node which also gets parent_id := NULL.
         (Subtree relativities preserved as NULLs; on re-place, we'd re-level.)
  3. Else:
       → Load new parent (if any), verify same client_id.
       → If parent_id is null, level_number MUST be 1.
       → If parent_id is set, level_number MUST be parent.level + 1.
       → Cycle check: walk ancestor chain from new parent; fail if node id appears.
       → Cardinality check:
            - If new parent is non-NULL: SELECT FOR UPDATE the new parent;
              look up rule with (parent_role_id = parent.role_id, child_role_id = node.role_id);
              COUNT existing children of that parent with our role_id; fail if >= max_children.
            - If new parent is NULL (moving to top-level / level 1): take advisory lock
              on (client_id, role_id) tuple; look up rule with (parent_role_id IS NULL,
              child_role_id = node.role_id); COUNT existing top-level nodes in this client
              with our role_id; fail if >= max_children.
       → Compute delta = new_level - old_level (NULL→N counts as N - old_level).
       → Recursive CTE: UPDATE all descendants SET level_number = level_number + delta.
       → UPDATE the moving node: parent_id = new_parent_id, level_number = new_level.
  4. Commit.

Response: { node, descendants_moved: <count> }
Errors:
  - 400 parent_level_mismatch
  - 400 cross_client_parent
  - 400 cycle_detected
  - 404 not_found
  - 409 cardinality_exceeded { max, current, role_id }
```

### Endpoints removed (v2 cleanup)

- `/api/clients-buckets`
- `/api/clients-bucket-users`
- `/api/clients-bucket-user-detail`
- `/api/bucket-user-credential` (renamed)

### User-portal endpoints (`/api/u-*`) — unchanged URLs, internals rekeyed

| Endpoint | Change |
| --- | --- |
| `u-login` | Look up credential by `(client_id, email)`; mint JWT with `node_id` |
| `u-me` | Join `user_nodes` + `client_roles` + `client_levels`; return `{display_name, email, role: {label, color}, level_number, must_change_password, client}` |
| `u-change-password` | Update by `user_node_credentials.id`; same wipe-temp behavior |
| `u-logout` | Unchanged |
| `u-client-by-slug` | Unchanged |

JWT claim shape changes from `{sub: bucket_user_id, kind, client_id, role_key}` → `{sub: user_node_id, kind, client_id}`. `role_key` drops out (derived via the `u-me` join) and the redundant `node_id` claim is dropped (it equals `sub`).

## UI architecture

### Routing

| Route | Page |
| --- | --- |
| `/` | AdminDashboard (lists clients) |
| `/login` | LoginPage (admin) |
| `/settings` | AdminSettings (admin team) |
| `/clients/:id` | **AccessDashboard** (new — merges old ClientDashboard) |
| `/clients/:id/configure` | **ConfigureStructure** (new) |
| `/c/:slug/login` | UserLogin (unchanged) |
| `/c/:slug/` | UserAccount (unchanged) |
| `/c/:slug/change-password` | UserChangePassword (unchanged) |

### Pages

#### `ConfigureStructure.tsx`

Three editable sections on one page, saved per-section (no global save):

1. **Roles** — list with [+ Add role]; each row has color swatch, label, key, [edit fields] action.
2. **Levels** — list with [+ Add level]; each row has level_number (read-only), label, multi-select of allowed roles.
3. **Per-parent limits** — list of cardinality rules; each row is "Under <parent role>: up to <N> <child role>".

Save semantics per-row:
- POST/PATCH/DELETE individual rows for roles and levels.
- PUT replaces the whole cardinality ruleset (the rules list is small; replacing in one call avoids partial state).

#### `AccessDashboard.tsx`

Stacked horizontal rows, one per level + an "Unassigned" row at the bottom. Each row shows draggable chips colored by role. A breadcrumb at the top of each row narrows children to one parent at a time:

```
LEVEL 1                              [+ Add user]   1 / 1
  [🔴 Joe's Main Shop]

LEVEL 2  · under Joe's Main Shop                    3 / 3 ⚠
  [🔵 Jane]  [🔵 Mark]  [🔵 Sara]

LEVEL 3  · under [Jane ▾]                           2 / 5
  [🟢 Alice]  [🟢 Bob]
  └─ click a Level-2 chip above to see L3 under another owner

LEVEL 4  · under [Alice ▾]                          4 / ∞
  ...

UNASSIGNED ACCESS                                    2
  [🔵 New owner?]  [🟢 Untriaged]
```

Drag-and-drop targets:
- Drop on a level row (with the "narrowed parent" set) → re-parent to that parent + relevel.
- Drop on Unassigned → un-place node + subtree.
- Drop on a chip → that chip becomes the parent (re-parent to that chip).

#### `AddUserNodeModal.tsx`

Three coupled selects (role → level → parent) drive the rest of the form:

- Role select shows all `client_roles`.
- Level select narrows to levels whose `allowed_role_ids` includes the chosen role.
- Parent select narrows to nodes at `level - 1` (within the same subtree if drilldown was active; else any).
- "Create as unassigned" checkbox bypasses level + parent.
- Identity + custom fields (based on chosen role's `fields` schema).
- "Create login" toggle + temp password generator (same UX as v2).

### Components

| New | Purpose |
| --- | --- |
| `ClientStructureContext.tsx` | Loads `/api/client-structure` once per page mount; supplies role/level lookup to all children |
| `UserNodeChip.tsx` | Draggable role-colored chip |
| `LevelRow.tsx` | Horizontal row of chips with drop-target + parent-narrowing dropdown |
| `RoleEditor.tsx`, `LevelEditor.tsx`, `CardinalityEditor.tsx` | Inline editors for Configure page |
| `AddUserNodeModal.tsx`, `EditUserNodeModal.tsx` | Replace v2 modals |
| `LoginManageModal.tsx` | **Kept**, re-wired to `user-node-credential` endpoint |

### npm additions

```
@dnd-kit/core
@dnd-kit/sortable
```

(Chose dnd-kit over react-dnd: smaller bundle, better mobile/touch support.)

## Migration plan

### Migration sequence (010 → 017)

```
010_wipe_v2_client_schemas.sql       DROP all client_<id> schemas + TRUNCATE clients
011_drop_template_columns.sql        ALTER clients DROP template_key, template_version_applied
012_drop_bucket_user_credentials.sql DROP TABLE bucket_user_credentials
013_client_roles.sql                 CREATE TABLE
014_client_levels.sql                CREATE TABLE
015_user_nodes.sql                   CREATE TABLE + trigger function (single $$ statement)
016_client_cardinality_rules.sql     CREATE TABLE
017_user_node_credentials.sql        CREATE TABLE + updated_at trigger
```

010 script (the destructive one):

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

### Backend files removed

| File | Reason |
| --- | --- |
| `netlify/functions/_shared/templates.ts` | Hardcoded templates gone |
| `netlify/functions/_shared/template-ddl.ts` | No per-client DDL generation |
| `netlify/functions/_shared/schema-manager.ts` | No per-client schemas |
| `netlify/functions/_shared/bucket.ts` | Bucket abstraction replaced by user-tree helpers |
| `netlify/functions/clients-buckets.ts` | Replaced by user-nodes |
| `netlify/functions/clients-bucket-users.ts` | Replaced |
| `netlify/functions/clients-bucket-user-detail.ts` | Replaced |
| `netlify/functions/bucket-user-credential.ts` | Renamed |

### Backend files modified

| File | Changes |
| --- | --- |
| `netlify/functions/_shared/identifier.ts` | Drop `generateSchemaName`, `safeQuoteSchema`, `safeQuoteIdent` (no per-client schema names anymore); keep `assertUuid`, `deriveSlug`, `isValidSlug` |
| `netlify/functions/clients.ts` | Drop `template_key` requirement and `createClientSchema()` call; client create is just a row insert + slug derivation |
| `netlify/functions/clients-detail.ts` | Drop `schema_name` handling |
| `netlify/functions/_shared/permissions.ts` | Update `requireBucketUser` to load credential by `user_node_id` |
| `netlify/functions/_shared/session.ts` | Update `BucketUserClaims` shape (replace `role_key` with `node_id`) |
| `netlify/functions/u-*.ts` (all five) | Re-key from bucket_user_credentials → user_node_credentials; update join shapes |

### Backend files added

| File | Purpose |
| --- | --- |
| `netlify/functions/_shared/user-tree.ts` | Helpers: `loadStructure`, `enforceCardinality`, `cycleCheck`, `getDescendantIds`, `subtreeRelevel` |
| `netlify/functions/client-structure.ts` | GET full structure |
| `netlify/functions/client-roles.ts` | POST role |
| `netlify/functions/client-roles-detail.ts` | PATCH / DELETE role |
| `netlify/functions/client-levels.ts` | POST level |
| `netlify/functions/client-levels-detail.ts` | PATCH / DELETE level |
| `netlify/functions/client-cardinality.ts` | PUT (replace) rules |
| `netlify/functions/user-nodes.ts` | GET list / POST create |
| `netlify/functions/user-nodes-detail.ts` | GET / PATCH / DELETE single |
| `netlify/functions/user-nodes-move.ts` | POST move (drag-and-drop) |
| `netlify/functions/user-node-credential.ts` | GET / POST / DELETE (renamed) |

### Frontend files removed

| File | Reason |
| --- | --- |
| `src/modules/ams/pages/ClientSettings.tsx` | Split into Configure + AccessDashboard |
| `src/modules/ams/components/BucketPanel.tsx` | Replaced by LevelRow + chips |
| `src/modules/ams/components/AddUserModal.tsx` | Replaced by AddUserNodeModal |
| `src/modules/ams/components/EditUserModal.tsx` | Replaced by EditUserNodeModal |

### Frontend files modified

| File | Changes |
| --- | --- |
| `src/lib/router.tsx` | Add `/clients/:id/configure` route; default `/clients/:id` → AccessDashboard |
| `src/modules/ams/api.ts` | Replace bucket-API with user-nodes / client-structure / cardinality calls |
| `src/modules/ams/components/ClientCard.tsx` | Drop template label (template gone) |
| `src/modules/ams/components/LoginManageModal.tsx` | Re-wire to `user-node-credential` endpoint, accept `nodeId` instead of `(role, userId)` |
| `src/modules/ams/pages/ClientDashboard.tsx` | Merge into AccessDashboard (delete file, content moves) |

### Frontend files added

| File | Purpose |
| --- | --- |
| `src/modules/ams/pages/ConfigureStructure.tsx` | New page |
| `src/modules/ams/pages/AccessDashboard.tsx` | New page (replaces ClientDashboard + ClientSettings) |
| `src/modules/ams/components/ClientStructureContext.tsx` | Shared structure-load context |
| `src/modules/ams/components/UserNodeChip.tsx` | Draggable chip |
| `src/modules/ams/components/LevelRow.tsx` | Horizontal row + drop target |
| `src/modules/ams/components/RoleEditor.tsx` | Inline role editor |
| `src/modules/ams/components/LevelEditor.tsx` | Inline level editor |
| `src/modules/ams/components/CardinalityEditor.tsx` | Inline cardinality editor |
| `src/modules/ams/components/AddUserNodeModal.tsx` | New unified add modal |
| `src/modules/ams/components/EditUserNodeModal.tsx` | Edit-only (no DnD inside) |

## Tests

### Removed (v2-shaped)

- `tests/integration/schema-bucket.test.ts`
- `tests/integration/buckets-cardinality.test.ts`
- `tests/integration/bucket-user-auth.test.ts` (replaced by user-node-auth.test.ts)

### Modified

- `tests/integration/clients-lifecycle.test.ts` — drop `template_key` from create payloads; assertions on `schema_name` removed.

### Added

#### `tests/integration/client-structure.test.ts`
- Admin creates roles + levels + cardinality; GET structure returns assembled config.
- Delete role-in-use → 409 `role_in_use`.
- Delete level-in-use → 409 `level_in_use`.
- PUT cardinality replaces full ruleset atomically.
- Cross-tenant: cannot read another client's structure.

#### `tests/integration/user-nodes-crud.test.ts`
- Create top-level (parent=null, level=1) → 201.
- Create child with valid parent + level → 201.
- Create child with parent at wrong level → 400 `parent_level_mismatch`.
- Create violating cardinality cap → 409 `cardinality_exceeded`.
- Concurrent dual-create against cap=1 → exactly one 201, one 409 (generalized singleton concurrency test).
- Create unassigned (parent=null, level=null) → 201; verify cannot log in.
- Delete with children → 409 `has_children`.
- Delete with `?cascade=descendants` → subtree gone; credentials cascaded.

#### `tests/integration/user-nodes-move.test.ts`
- Move to valid new parent → 200; descendants re-leveled.
- Move that creates cycle → 400 `cycle_detected`.
- Move violating cardinality → 409 `cardinality_exceeded`.
- Move to Unassigned → entire subtree levels become NULL.
- Move from Unassigned into tree → node + subtree get level numbers.
- Forged cross-client parent_id → 400 `cross_client_parent`.

#### `tests/integration/user-node-auth.test.ts`
- Re-key of v2 bucket-user-auth tests; same coverage:
  - login happy path / wrong pwd / must_change_password
  - reveal counter decrement + wipe at 0
  - dup email → 409 (now `email_already_has_login_in_this_client` against credentials table)
  - cascade-on-delete (now via real FK, not app cleanup)
  - kind enforcement (admin token cannot auth `/api/u-me` and vice versa)

### Test count targets

- v2 baseline: 123 tests
- Deleted: ~30
- Added: ~50
- v3 target: ~143 tests

## Rollout

1. Apply migrations 010–017 to **dev Neon**.
2. Implement backend + frontend; iterate until all tests pass locally.
3. Confirm test count ≥ 143; typecheck + prod build clean.
4. Apply migrations 010–017 to **prod Neon** (this wipes prod; the existing prod has < 24h of test data, no real users).
5. `git push origin main` → Netlify auto-deploy.
6. Wait for Netlify deploy `ready` state via API.
7. Smoke prod:
   - `GET /` → 200 (SPA loads)
   - `GET /api/auth-me` (unauth) → 401
   - `GET /api/u-me` (unauth) → 401
   - `GET /c/anything/login` → 200 (SPA route)
   - `GET /api/u-client-by-slug?slug=does-not-exist` → 404
8. Log in as bootstrap admin; create a test client; configure structure; add a user with login; drag the user to another parent; reveal temp password.

## Implementation phases (preview for writing-plans)

Suggested phase decomposition:

- **Phase A — DB wipe + new schema** (migrations 010–017, applied to dev). Tests cleared.
- **Phase B — Backend shared helpers + structure endpoints** (`user-tree.ts`, client-roles, client-levels, client-cardinality, client-structure). Integration tests for config CRUD.
- **Phase C — Backend user-node endpoints** (user-nodes CRUD + move). Integration tests for CRUD + concurrent cardinality + move + cycle.
- **Phase D — Credentials rekey + u-portal rewiring** (user-node-credential, updated u-login/u-me/u-change-password). Integration tests for auth.
- **Phase E — Frontend Configure Structure page** + ClientStructureContext + Role/Level/Cardinality editors.
- **Phase F — Frontend Access Dashboard** + LevelRow + UserNodeChip + drag-and-drop wiring.
- **Phase G — Frontend Add/Edit modals** + LoginManageModal rewire.
- **Phase H — End-to-end manual smoke** + prod migrations + push + deploy verify.

Each phase: typecheck + tests + commit at the end. Estimate: 4–6 hours of focused execution.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Drag-and-drop edge cases (cycle, cardinality, level mismatch) on a busy tree | Backend `/move` is the source of truth; UI optimistically updates, rolls back on error code. Integration tests cover every error branch. |
| Concurrent cardinality violations under load | Same row-lock pattern as v2 singletons; generalized concurrency test included |
| Recursive CTE for subtree relevel slow on huge trees | v1 expects ≤ few hundred nodes per client; revisit if a client exceeds 1000 |
| Frontend bundle bloat from dnd-kit | Confirmed: dnd-kit adds ~20KB gzipped, acceptable. react-dnd is larger |
| User accidentally cascades delete | Default DELETE refuses on children; cascade requires explicit `?cascade=descendants` query param + a confirm() in UI |
| Future per-user permissions need to slot in cleanly | Schema leaves room for a `user_node_permissions` join table without touching existing tables |
