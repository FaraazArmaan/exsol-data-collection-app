# AMS Module — Design Spec

| | |
|---|---|
| **Date** | 2026-05-26 |
| **Status** | Approved (brainstorming complete) |
| **Modules in scope** | Login Module, AMS Module (v1) |
| **Author** | brainstorming session, theexsolenterprise@gmail.com |
| **Supersedes** | All v1.1 PRDs and ADRs (v1.1 is being wiped — see `git tag v1.1-final`) |

---

## 1. Context

The previous app (ExSol Data Collection App v1.1) was an inventory / marketplace-overlay product. It was deployed to production on 2026-05-25 (`54ca09f`), then the user decided the product vision had changed. This spec defines its replacement.

The new product is an **Account Management System (AMS)** under an Admin layer, deployed on the same Neon project, same Google OAuth client, same Netlify site. The previous codebase is being deleted from `main` (tagged `v1.1-final` for recovery), the Neon database wiped, and the new app scaffolded fresh.

The user has stated the app will be built **modularly**, one feature at a time. This spec covers only the first two modules: **Login** (auth shell) and **AMS** (account/client/role management). Future modules (Bookings, etc.) are explicit non-goals here.

---

## 2. Goals

1. Admins (peers, multiple allowed, bootstrap = `theexsolenterprise@gmail.com`) sign in via Google OAuth or email+password.
2. Admins manage a list of Clients (businesses). Each Client has a **business type** (template) that determines its account structure.
3. When a Client is added, the system **dynamically provisions a Postgres schema** with one table per role in that template (e.g., Hospital → `directors`, `doctors`, `nurses`, `staff`, `patients`).
4. Each role table captures **domain-specific data** (Doctor has `specialty`, Patient has `dob`, etc.) on top of a shared core (name, email, phone, notes).
5. Admins can add/remove/edit users in any role bucket. Singleton roles (exactly-one, e.g., Owner) are enforced at UI, API, and DB layers.
6. UI is a 20% sidebar / 80% main shell, dark gray + off-white palette, minimal.
7. v1 ships with 6 templates (Shop, Store, Restaurant, Hotel, Clinic, Hospital) and 3 seeded dummy clients (Shop, Restaurant, Hospital).

## 3. Non-Goals (explicit, will NOT ship in v1)

- Non-admin sign-in (Owners, Employees, Customers do not authenticate yet — they are records, not users).
- Bookings module (Owner/Employee/Customer sidebar items mentioned in the whiteboard are deferred to a future module).
- Per-row attachments, photos, ID documents.
- Soft-delete or row-level audit history beyond `public.schema_ops_log`.
- Pagination / search / filtering on bucket lists (buckets are expected to hold dozens of rows, not thousands).
- Bulk imports / exports.
- Row-Level Security (only admins read everything — RLS is overhead for now).
- Internationalisation.
- Foreign keys between role tables in the same client (e.g., `patients.primary_doctor_id`) — replaced with a `primary_doctor_name` text field.
- Per-template column-type extensions beyond text/date/integer/boolean (no enums, arrays, or JSONB in v1).
- Admin UI for editing templates (template definitions live in code; changes require deploys).
- Mobile-first responsive design (desktop-first; doesn't break on smaller screens but isn't optimised).

---

## 4. Locked-in decisions

| # | Decision | Choice | Reasoning |
|---|---|---|---|
| 1 | Driver | Fresh product on same infra | Product vision changed |
| 2 | First modules | Login + AMS (paired) | Admin needs to sign in to use AMS |
| 3 | Frontend stack | Vite + React + TypeScript | Standard, well-documented, fits sidebar SPA |
| 4 | Backend | Netlify Functions + `@neondatabase/serverless` | Same as v1.1 — proven, lean |
| 5 | Auth library | `jose` (JWT) + `@node-rs/argon2` (passwords) + `google-auth-library` (Google ID tokens) | Same as v1.1 |
| 6 | Routing | `react-router-dom` v7 | Standard for SPAs |
| 7 | Styling | Plain CSS with custom properties (no Tailwind, no UI library) | Minimal, matches design ethos |
| 8 | Data model | Per-client Postgres schema, per-role tables inside | Matches "buckets" mental model literally |
| 9 | Templates | 6 hardcoded in TypeScript (Shop, Store, Restaurant, Hotel, Clinic, Hospital) | Deployment-versioned source of truth |
| 10 | Cardinality | Per-role `singleton` vs `multi` flag | UI + API + DB enforcement |
| 11 | Custom columns | Per-role columns supporting text/date/integer/boolean | Domain-aware records, not generic identity |
| 12 | Bootstrap admin | `theexsolenterprise@gmail.com`, undeletable | Seeded by script, marked `is_bootstrap = true` |
| 13 | Admin team | Multiple admins, all peers | All admins have full powers |
| 14 | Non-admin auth | Deferred | Future module |
| 15 | Seed clients | Joe's Hardware (shop), Bistro Verde (restaurant), St Mercy Hospital | Diverse role lists exercise templates |
| 16 | UI shell | 20% sidebar / 80% main | Per user whiteboard |
| 17 | Palette | Dark gray + off-white, minimal | Per user direction |

---

## 5. Cleanup plan (Phase 0)

Run *before* any new code is added.

1. `git tag v1.1-final && git push origin v1.1-final` — permanent recovery point.
2. Delete from working tree on `main`:
   - `src/` (entire v1.1 lib)
   - `netlify/functions/` (all 30+ functions)
   - `db/migrations/` (all 11 SQL files)
   - `tests/`, `spec/`, `references/`, `scripts/`, `public/assets/`
   - `README.md`, `CONTEXT.md`, `docs/prd-v1.md`, `docs/handoff.md`, `docs/adr/` (old ADRs)
3. Wipe Neon **dev** branch (drop all v1.1 tables) then **prod** branch (same).
4. Keep: `.git/`, `.gitignore`, `.env` (rewrite contents), `.netlify/` (link stays), `LICENSE`, `package.json` (rewrite deps), `netlify.toml` (rewrite), `tsconfig.json` (rewrite), `vitest.config.ts`, `.claude/`, `.remember/`.
5. Commit: `chore: wipe v1.1, scaffold for v2 AMS`.

**Irreversibility note:** dropping the prod Neon tables is irreversible. v1.1 was live for less than 36 hours with no real users; this is judged safe.

---

## 6. Architecture

```
Browser (SPA: Vite + React)
    │  fetch /api/* with HttpOnly cookie
    ▼
Netlify Functions v2 (TypeScript)
    │  reads/writes via @neondatabase/serverless
    ▼
Neon Postgres
    ├── public schema      → admins, clients (registry), schema_ops_log
    └── client_<32hex>     → one schema PER CLIENT
           ├── _meta       ← per-client metadata (template_version_applied)
           ├── owners      ← one table PER ROLE in template, shared core + custom columns
           ├── employees
           ├── customers
           └── ...
```

**Key invariants:**
- Every dynamic SQL identifier (schema name, role table name, column name) is validated against a strict regex AND lives in code-controlled sources. No user-typed string ever becomes an identifier.
- Every cross-client read goes through `public.clients`. Per-client schemas are accessed *only* through the `Bucket(clientId, role)` abstraction or the `schema-manager` module.
- Templates are immutable per version. Changing a template = bumping its version + writing a forward-only migration delta. Reconcile applies the delta to every existing client.

---

## 7. Repo layout

```
ExSol Data Collection App/
├── src/
│   ├── modules/
│   │   ├── login/
│   │   │   ├── pages/LoginPage.tsx
│   │   │   ├── components/
│   │   │   │   ├── EmailPasswordForm.tsx
│   │   │   │   └── GoogleSignInButton.tsx
│   │   │   ├── api.ts
│   │   │   └── types.ts
│   │   └── ams/
│   │       ├── pages/
│   │       │   ├── AdminDashboard.tsx       # client list + Add Client
│   │       │   ├── AdminSettings.tsx        # own creds + admin team
│   │       │   ├── ClientDashboard.tsx      # selected client overview
│   │       │   └── ClientSettings.tsx       # bucket panels (Edit Accounts)
│   │       ├── components/
│   │       │   ├── Sidebar.tsx              # 20% left rail
│   │       │   ├── ClientCard.tsx
│   │       │   ├── AddClientModal.tsx
│   │       │   ├── BucketPanel.tsx          # accordion, one per role
│   │       │   ├── UserRow.tsx
│   │       │   ├── AddUserModal.tsx         # dynamic form per role.columns
│   │       │   └── EditUserModal.tsx        # dynamic form per role.columns
│   │       ├── api.ts
│   │       └── types.ts
│   ├── lib/
│   │   ├── api-client.ts                    # fetch wrapper + Result<T>
│   │   ├── auth-context.tsx                 # React context for current admin
│   │   ├── theme.css                        # palette tokens
│   │   ├── components.css                   # shared button/input/card styles
│   │   └── router.tsx                       # route definitions
│   ├── App.tsx                              # AuthProvider + RequireAdmin + shell
│   ├── main.tsx                             # Vite entry
│   └── index.html
│
├── netlify/
│   └── functions/
│       ├── _shared/                         # not deployed as functions (leading _)
│       │   ├── db.ts                        # neon() client + safe-id query helpers
│       │   ├── env.ts                       # zod-validated env
│       │   ├── session.ts                   # jose JWT + cookie helpers
│       │   ├── argon.ts                     # password hash/verify
│       │   ├── google-verifier.ts
│       │   ├── http.ts                      # response/error helpers
│       │   ├── permissions.ts               # admin-only guard
│       │   ├── identifier.ts                # schema/table/column name validator + quoter
│       │   ├── templates.ts                 # 6 hardcoded template defs
│       │   ├── template-ddl.ts              # template → CREATE/ALTER TABLE generator
│       │   ├── schema-manager.ts            # CREATE/DROP/RECONCILE schema operations
│       │   └── bucket.ts                    # Bucket(clientId, role) abstraction
│       ├── auth-login.ts                    # POST /api/auth-login
│       ├── auth-google.ts                   # POST /api/auth-google
│       ├── auth-me.ts                       # GET  /api/auth-me
│       ├── auth-logout.ts                   # POST /api/auth-logout
│       ├── admin-self.ts                    # PATCH /api/admin-self
│       ├── admin-team.ts                    # GET/POST /api/admin-team
│       ├── admin-team-detail.ts             # DELETE /api/admin-team-detail?id=...
│       ├── clients.ts                       # GET/POST /api/clients
│       ├── clients-detail.ts                # GET/DELETE /api/clients-detail?id=...
│       ├── clients-buckets.ts               # GET /api/clients-buckets?client=...
│       ├── clients-bucket-users.ts          # GET/POST /api/clients-bucket-users?client=...&role=...
│       └── clients-bucket-user-detail.ts    # PATCH/DELETE .../?client=...&role=...&user=...
│
├── db/
│   ├── migrations/                          # public schema only
│   │   ├── 001_extensions.sql
│   │   ├── 002_admins.sql
│   │   ├── 003_clients.sql
│   │   └── 004_schema_ops_log.sql
│   └── templates/                           # one JSON per template version, source-of-truth duplicate of templates.ts
│       ├── shop/v1.json
│       ├── store/v1.json
│       ├── restaurant/v1.json
│       ├── hotel/v1.json
│       ├── clinic/v1.json
│       └── hospital/v1.json
│
├── scripts/
│   ├── migrate.ts                           # applies public schema migrations
│   ├── reconcile-clients.ts                 # walks public.clients, applies template-version diffs
│   ├── bootstrap-admin.ts                   # seeds theexsolenterprise@gmail.com
│   └── seed-dummy-clients.ts                # creates 3 dummy clients with populated buckets
│
├── tests/
│   ├── unit/
│   │   ├── identifier.test.ts
│   │   ├── templates.test.ts
│   │   ├── template-ddl.test.ts             # golden-file tests, one per template
│   │   ├── session.test.ts                  # JWT mint/verify
│   │   └── argon.test.ts
│   └── integration/
│       ├── auth.test.ts                     # login, Google, /me, logout, cookie refresh
│       ├── clients-lifecycle.test.ts        # create → schema appears → delete → schema gone
│       ├── buckets-cardinality.test.ts      # concurrent inserts to singleton → 1 wins
│       └── reconcile.test.ts                # template v1 → v2 with new column → ALTER applied
│
├── docs/
│   ├── superpowers/specs/2026-05-26-ams-module-design.md   # this file
│   └── adr/
│       ├── 001-per-client-schemas.md
│       ├── 002-hardcoded-templates-with-versioning.md
│       └── 003-no-rls-admin-only.md
│
├── public/                                  # favicon etc.
├── .env                                     # rewritten — see §11
├── .gitignore                               # carry-over
├── LICENSE                                  # carry-over
├── package.json                             # rewritten — see §11
├── netlify.toml                             # rewritten — see §11
├── tsconfig.json                            # rewritten — see §11
├── vite.config.ts                           # NEW
└── vitest.config.ts                         # carry-over (minor tweaks)
```

**Naming + URL convention:** Netlify Function file names use hyphens (`auth-login.ts`), and they map directly to URL paths via the redirect in `netlify.toml` (`/api/auth-login`). No path parameters (`:id`) in URLs — IDs always go in query string. This avoids the routing collision bug captured in `feedback_netlify_routing.md`.

---

## 8. Data model

### 8.1 Public schema DDL

```sql
-- db/migrations/001_extensions.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive emails

-- db/migrations/002_admins.sql
CREATE TABLE public.admins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  password_hash   text,                       -- nullable: Google-only admins allowed
  google_sub      text UNIQUE,                -- nullable: password-only admins allowed
  display_name    text NOT NULL,
  is_bootstrap    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admins_has_at_least_one_credential
    CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);

-- db/migrations/003_clients.sql
CREATE TABLE public.clients (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL,
  template_key              text NOT NULL,
  template_version_applied  integer NOT NULL,
  schema_name               text NOT NULL UNIQUE,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NOT NULL REFERENCES public.admins(id),
  CONSTRAINT clients_schema_name_format
    CHECK (schema_name ~ '^client_[0-9a-f]{32}$')
);
CREATE INDEX clients_template_key_idx ON public.clients(template_key);

-- db/migrations/004_schema_ops_log.sql
CREATE TABLE public.schema_ops_log (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_admin  uuid REFERENCES public.admins(id),
  op           text NOT NULL,                 -- 'create_schema'|'drop_schema'|'reconcile'|'add_role_table'|'add_role_column'
  client_id    uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  schema_name  text NOT NULL,
  template_key text,
  from_version integer,
  to_version   integer,
  detail       jsonb
);
CREATE INDEX schema_ops_log_client_idx ON public.schema_ops_log(client_id);
```

### 8.2 Per-client schema DDL (generated by `template-ddl.ts`)

For a Shop client whose generated schema name is `client_a1b2c3d4e5f60123456789abcdef0123` (all subsequent references use the full name for SQL validity):

```sql
BEGIN;
CREATE SCHEMA client_a1b2c3d4e5f60123456789abcdef0123;

CREATE TABLE client_a1b2c3d4e5f60123456789abcdef0123._meta (
  template_version_applied integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO client_a1b2c3d4e5f60123456789abcdef0123._meta (template_version_applied) VALUES (1);

-- For each role in the template (Shop v1 → owners, employees, customers).
-- owners: singleton, no custom columns.
CREATE TABLE client_a1b2c3d4e5f60123456789abcdef0123.owners (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text NOT NULL,
  email           citext,
  phone           text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES public.admins(id),
  UNIQUE NULLS NOT DISTINCT (email)
);
CREATE INDEX owners_created_at_idx
  ON client_a1b2c3d4e5f60123456789abcdef0123.owners (created_at DESC);
CREATE UNIQUE INDEX owners_singleton
  ON client_a1b2c3d4e5f60123456789abcdef0123.owners ((true));

-- employees: multi, three custom columns.
CREATE TABLE client_a1b2c3d4e5f60123456789abcdef0123.employees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text NOT NULL,
  email           citext,
  phone           text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES public.admins(id),
  position        text NOT NULL,
  hire_date       date,
  active          boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (email)
);
CREATE INDEX employees_created_at_idx
  ON client_a1b2c3d4e5f60123456789abcdef0123.employees (created_at DESC);
-- (no singleton index — multi)

-- customers: multi, no custom columns.
CREATE TABLE client_a1b2c3d4e5f60123456789abcdef0123.customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text NOT NULL,
  email           citext,
  phone           text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES public.admins(id),
  UNIQUE NULLS NOT DISTINCT (email)
);
CREATE INDEX customers_created_at_idx
  ON client_a1b2c3d4e5f60123456789abcdef0123.customers (created_at DESC);

INSERT INTO public.schema_ops_log
  (op, client_id, schema_name, template_key, to_version, actor_admin, detail)
VALUES
  ('create_schema',
   '<new-client-uuid>',
   'client_a1b2c3d4e5f60123456789abcdef0123',
   'shop',
   1,
   '<acting-admin-uuid>',
   jsonb_build_object('roles', '["owners","employees","customers"]'::jsonb));

COMMIT;
```

**Failure mode:** any error mid-transaction triggers `ROLLBACK`; Postgres guarantees no partial schema. The HTTP response returns `schema_op_failed` with the underlying error code.

### 8.3 Template schema language

```ts
// netlify/functions/_shared/templates.ts

export type ColumnType = 'text' | 'date' | 'integer' | 'boolean';

export interface ColumnDef {
  key: string;                  // snake_case → DB column name (strict validator)
  label: string;                // UI label
  type: ColumnType;
  required: boolean;
  default?: string | number | boolean;
  display_in_list?: boolean;    // true → shown in bucket panel list view
  help?: string;                // optional tooltip
}

export type Cardinality = 'singleton' | 'multi';

export interface RoleDef {
  key: string;                  // snake_case → table name (strict validator)
  label: string;                // UI label
  cardinality: Cardinality;
  columns: ColumnDef[];         // additive to shared core (never replaces)
}

export interface TemplateDef {
  key: string;
  label: string;
  version: number;
  roles: RoleDef[];             // order matters — bucket panels render in this order
}

export const TEMPLATES: Record<string, TemplateDef> = {
  shop:       { /* see §8.4 */ },
  store:      { /* see §8.4 */ },
  restaurant: { /* see §8.4 */ },
  hotel:      { /* see §8.4 */ },
  clinic:     { /* see §8.4 */ },
  hospital:   { /* see §8.4 */ },
};
```

**Shared core columns** (always present, in this order):

```
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
display_name  text NOT NULL
email         citext NULL                      -- UNIQUE NULLS NOT DISTINCT within bucket
phone         text NULL
notes         text NULL
created_at    timestamptz NOT NULL DEFAULT now()
updated_at    timestamptz NOT NULL DEFAULT now()
created_by    uuid NOT NULL REFERENCES public.admins(id)
```

### 8.4 The 6 templates (v1) — full column definitions

#### Shop (v1, 3 roles)
| Role | Cardinality | Custom columns |
|---|---|---|
| `owners` | singleton | — |
| `employees` | multi | `position` (text, required, "Position", list✓); `hire_date` (date, optional, "Hire date"); `active` (boolean, required, "Active", list✓, default `true`) |
| `customers` | multi | — |

#### Store (v1, 4 roles)
| Role | Cardinality | Custom columns |
|---|---|---|
| `owners` | singleton | — |
| `managers` | singleton | `hire_date` (date, optional, "Hire date"); `active` (boolean, required, "Active", list✓, default `true`) |
| `employees` | multi | `position` (text, required, "Position", list✓); `hire_date` (date, optional); `active` (boolean, required, list✓, default `true`) |
| `customers` | multi | — |

#### Restaurant (v1, 5 roles)
| Role | Cardinality | Custom columns |
|---|---|---|
| `owners` | singleton | — |
| `managers` | singleton | `hire_date` (date, optional); `active` (boolean, required, list✓, default `true`) |
| `chefs` | multi | `cuisine_specialty` (text, optional, "Specialty", list✓); `hire_date` (date, optional); `active` (boolean, required, list✓, default `true`) |
| `waiters` | multi | `shift` (text, optional, "Shift", list✓); `hire_date` (date, optional); `active` (boolean, required, list✓, default `true`) |
| `customers` | multi | — |

#### Hotel (v1, 5 roles)
| Role | Cardinality | Custom columns |
|---|---|---|
| `owners` | singleton | — |
| `managers` | singleton | `hire_date` (date, optional); `active` (boolean, required, list✓, default `true`) |
| `reception` | multi | `shift` (text, optional, "Shift", list✓); `hire_date` (date, optional); `active` (boolean, required, list✓, default `true`) |
| `housekeeping` | multi | `assigned_floor` (integer, optional, "Assigned floor", list✓); `hire_date` (date, optional); `active` (boolean, required, list✓, default `true`) |
| `guests` | multi | `room_number` (text, optional, "Room", list✓); `check_in` (date, optional, "Check-in", list✓); `check_out` (date, optional, "Check-out", list✓); `id_document_no` (text, optional, "ID document") |

#### Clinic (v1, 4 roles)
| Role | Cardinality | Custom columns |
|---|---|---|
| `doctors` | singleton | `specialty` (text, required, "Specialty", list✓); `license_no` (text, optional, "License #"); `years_practising` (integer, optional, "Years practising") |
| `nurses` | multi | `ward` (text, optional, "Ward", list✓); `shift` (text, optional, "Shift", list✓); `license_no` (text, optional) |
| `staff` | multi | `position` (text, required, "Position", list✓); `hire_date` (date, optional); `active` (boolean, required, list✓, default `true`) |
| `patients` | multi | `dob` (date, optional, "DOB", list✓); `blood_type` (text, optional, "Blood type", list✓); `allergies` (text, optional, "Allergies"); `primary_doctor_name` (text, optional, "Primary doctor") |

#### Hospital (v1, 5 roles)
| Role | Cardinality | Custom columns |
|---|---|---|
| `directors` | singleton | — |
| `doctors` | multi | `specialty` (text, required, "Specialty", list✓); `license_no` (text, optional); `years_practising` (integer, optional) |
| `nurses` | multi | `ward` (text, optional, "Ward", list✓); `shift` (text, optional, "Shift", list✓); `license_no` (text, optional) |
| `staff` | multi | `department` (text, optional, "Department", list✓); `position` (text, required, "Position", list✓); `hire_date` (date, optional); `active` (boolean, required, list✓, default `true`) |
| `patients` | multi | `dob` (date, optional, "DOB", list✓); `blood_type` (text, optional, "Blood type", list✓); `allergies` (text, optional); `admission_date` (date, optional, "Admitted", list✓); `ward` (text, optional, "Ward", list✓) |

### 8.5 Cardinality enforcement (3 layers)

| Layer | Mechanism |
|---|---|
| UI | "Add <Role>" button disabled when singleton bucket already holds 1 row |
| API | `Bucket.add()` checks role cardinality + current count BEFORE INSERT; returns 409 `conflict` if full |
| DB | Singleton role tables have `CREATE UNIQUE INDEX <role>_singleton ON ... ((true))`; concurrent INSERTs fail atomically |

The DB layer is the only authoritative one. UI + API are UX optimisations.

### 8.6 Identifier safety

All dynamic identifiers (schema names, table names, column names) are validated against:

- Schema name: `/^client_[0-9a-f]{32}$/`
- Role / column name (from template): `/^[a-z][a-z0-9_]{0,62}$/`

Validation happens at:
1. Template load time (boot of every function) — invalid template = function refuses to start.
2. Every DDL generator call — even though templates are already validated, we re-validate at the SQL-string-building site.
3. Every query builder — `safeQuoteIdent(name)` is the only way to interpolate an identifier into SQL.

`safeQuoteIdent` returns the name wrapped in `"..."` (Postgres identifier quoting), with the regex check applied. Any failure throws synchronously — never returns an unsafe string.

### 8.7 Reconcile (template version upgrades)

When a template's `version` in code is higher than `template_version_applied` in `public.clients` for some client:

1. `reconcile-clients.ts` walks every `public.clients` row whose `template_key` matches and `template_version_applied < TEMPLATES[key].version`.
2. For each, it computes the forward diff (new roles to add, new columns to add to existing roles).
3. Applies it in a transaction:
   - `CREATE TABLE` for new roles (full DDL via template-ddl.ts).
   - `ALTER TABLE ... ADD COLUMN` for new columns on existing roles.
   - Updates `_meta.template_version_applied` and `public.clients.template_version_applied`.
   - Writes a `schema_ops_log` row.
4. Idempotent — re-running against an already-current client is a no-op.

**v1 has no version bumps yet** — every template is at v1, every client at v1, reconcile is a no-op on first deploy. The infrastructure is built so the *next* template change is non-disruptive.

**Removal of roles/columns is NOT supported in v1.** Forward-only. If you need to remove, you write a manual migration; the reconcile system won't do it for you.

### 8.8 Indexes

Per per-client schema, per role table:
- `<role>_created_at_idx` on `(created_at DESC)` — bucket panel sorts newest first.
- `(email)` is implicitly indexed via `UNIQUE NULLS NOT DISTINCT`.
- Singleton tables additionally have `<role>_singleton` unique index on `((true))`.

No other indexes for v1.

### 8.9 Seed data

`scripts/seed-dummy-clients.ts`, idempotent (checks `WHERE name = ?` before insert):

| Client | Template | Users created |
|---|---|---|
| Joe's Hardware | shop | Owner: Joe Smith. Employees: Alex (Cashier, active), Sam (Stocker, active), Pat (Cashier, inactive). Customers: Mary, Lee. |
| Bistro Verde | restaurant | Owner: Anna Greene. Manager: Tom Reyes (active). Chefs: Marco (Italian), Yuki (Japanese, active). Waiters: Rosa (Evening), Kai (Morning). Customers: David, Emma, Jin. |
| St Mercy Hospital | hospital | Director: Dr. Hale. Doctors: Dr. Chen (Cardiology), Dr. Patel (Neurology). Nurses: Maya (ICU/Day), Theo (ER/Night). Staff: Jordan (Admin, Receptionist, active). Patients: Five rows with realistic DOB/blood-type/allergies/admission/ward combinations. |

All seed users have `display_name` set; emails are populated where realistic (`alex@joeshw.example`); custom required fields populated per the template.

---

## 9. UI architecture

### 9.1 Routes

| Path | Page | Auth |
|---|---|---|
| `/login` | `LoginPage` | Public |
| `/` | `AdminDashboard` | RequireAdmin |
| `/settings` | `AdminSettings` | RequireAdmin |
| `/clients/:clientId` | `ClientDashboard` | RequireAdmin |
| `/clients/:clientId/settings` | `ClientSettings` | RequireAdmin |

`App.tsx` wraps the route tree in `<AuthProvider>` and `<RequireAdmin>`. Unauthenticated → redirect `/login?next=<current>`.

### 9.2 Layout shell

```
┌──────────────────────────────────────────────────────────────┐
│  ┌───────────────┐  ┌──────────────────────────────────────┐ │
│  │  ExSol        │  │                                      │ │
│  │  ───────────  │  │                                      │ │
│  │               │  │                                      │ │
│  │  Dashboard    │  │           ACTIVE PAGE                │ │
│  │  Settings     │  │           (80% width)                │ │
│  │               │  │                                      │ │
│  │  ───────────  │  │                                      │ │
│  │  ← back to    │  │                                      │ │
│  │     admin     │  │                                      │ │
│  │  (only in     │  │                                      │ │
│  │   client ctx) │  │                                      │ │
│  │               │  │                                      │ │
│  │  ───────────  │  │                                      │ │
│  │  Signed in:   │  │                                      │ │
│  │  theexsol...  │  │                                      │ │
│  │  Sign out     │  │                                      │ │
│  └───────────────┘  └──────────────────────────────────────┘ │
│   min(20vw, 280px)              flex: 1                      │
└──────────────────────────────────────────────────────────────┘
```

Sidebar width: `min(20vw, 280px)`, never below 200px. Sidebar items vary by context:

- Admin context (`/`, `/settings`): Dashboard, Settings.
- Client context (`/clients/:id`, `/clients/:id/settings`): Dashboard, Settings, "← back to admin".

### 9.3 Page details

**AdminDashboard (`/`):** Grid of `ClientCard` (3 cols desktop, 2 tablet, 1 mobile). Each card: client name, business type label, "N users · created <date>", "open →" link. Header has `[ + Add Client ]` button. Right-click on card opens context menu with Delete (confirms first).

**AddClientModal:** Client name (text), business type (`<select>` of 6 templates). Live preview of the bucket list expected from the chosen template. Submit calls `POST /api/clients`.

**AdminSettings (`/settings`):**
- "Your account" panel: edit email, change password, manage Google connection (link/unlink).
- "Admin team" panel: list of admins (you marked "(you, bootstrap)" + delete-disabled), `[ + Add admin ]` opens modal for email + (temp password OR Google-only).
- "Danger zone" panel: "Sign out everywhere" (invalidates all sessions for current admin).

**ClientDashboard (`/clients/:clientId`):** Client name + template label + "created <date>" header. Below: bucket overview (one row per role with count, e.g. "Owner: 1 / 1", "Employees: 3"). Placeholder for future activity feed.

**ClientSettings (`/clients/:clientId/settings`):** Same header. Below: one `BucketPanel` per role in the template, in template order. Each panel:
- Accordion (expanded by default for first 2 panels, collapsed for rest).
- Header: role label, count badge (`1 / 1` for singleton, `3` for multi), expand toggle.
- Rows: shared core (`display_name`, `email`) + custom columns marked `display_in_list: true`.
- Each row has `[ × ]` delete button (confirm modal).
- Footer: `[ + Add <RoleLabel> ]` (disabled with tooltip for full singletons).

**AddUserModal / EditUserModal:** Dynamic form built from the role's `columns` array + shared core fields. Field rendering:
- `display_name` (always): text input, required.
- `email` (always): email input, optional, validated.
- `phone` (always): tel input, optional.
- `notes` (always): textarea, optional.
- Each custom `ColumnDef`:
  - `type: 'text'` → text input
  - `type: 'date'` → date input
  - `type: 'integer'` → number input with `step="1"`
  - `type: 'boolean'` → checkbox (or styled toggle)
  - `required: true` → adds `required` HTML attr + red asterisk + zod `.min(1)` on submit
  - `default` → applied to empty field on Add modal
  - `help` → tooltip icon

### 9.4 Palette + tokens

```css
/* src/lib/theme.css — loaded once in main.tsx */
:root {
  /* Surfaces */
  --bg-base:        #161616;
  --bg-surface:     #1f1f1f;
  --bg-elevated:    #2a2a2a;

  /* Lines */
  --border-subtle:  #2e2e2e;
  --border-default: #3a3a3a;
  --border-strong:  #4a4a4a;

  /* Text */
  --text-primary:   #ece8df;
  --text-secondary: #a8a39a;
  --text-muted:     #6b6862;
  --text-on-accent: #161616;

  /* Accent */
  --accent:         #ece8df;
  --accent-hover:   #ffffff;

  /* Feedback */
  --danger:         #c97064;
  --success:        #7fa97f;

  /* Geometry */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Type */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}
```

Button variants (defined in `components.css`):
- **Primary:** off-white bg, dark text. Used once per page max.
- **Secondary:** transparent bg, off-white border, off-white text.
- **Ghost:** transparent bg, off-white text, no border. Used for nav.
- **Danger:** transparent bg, danger-red border + text.

### 9.5 Auth flow

```
LoginPage (public)
    │
    ├─── Email + password submit ────► POST /api/auth-login
    │                                    │ argon2.verify(password, admins.password_hash)
    │                                    │ mint JWT (jose, 15min TTL)
    │                                    └─► Set-Cookie: session=<JWT>; HttpOnly; Secure; SameSite=Lax
    │                                          ↓
    │                                       redirect /
    │
    └─── Google ID token  ────────────► POST /api/auth-google
                                          │ google-auth-library verifies ID token
                                          │ find/create admin by google_sub
                                          │ mint JWT (same shape)
                                          └─► Set-Cookie + redirect /
```

- JWT: `{ sub: admin_id, email, iat, exp }`. Signed HS256 with `JWT_SIGNING_SECRET`.
- Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900` (15 min).
- Sliding session: every `/api/*` request whose cookie is >5 min old gets a fresh cookie in the response.
- `GET /api/auth-me` returns `{ admin: {id, email, display_name, is_bootstrap} }` or 401.
- `POST /api/auth-logout` returns `Set-Cookie: session=; Max-Age=0`.

---

## 10. Backend conventions

### 10.1 Function structure

Every function file follows this skeleton:

```ts
import type { Context } from "@netlify/functions";
import { z } from "zod";
import { requireAdmin } from "./_shared/permissions";
import { jsonOk, jsonError } from "./_shared/http";

const Body = z.object({ /* ... */ });

export default async (req: Request, ctx: Context) => {
  const admin = await requireAdmin(req);           // throws 401 if no/invalid cookie
  if (req.method !== "POST") return jsonError(405, "method_not_allowed");

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError(400, "validation_failed", parsed.error.flatten());

  // ... business logic ...

  return jsonOk({ /* ... */ });
};
```

### 10.2 Error shape

```ts
{ error: { code: string, message: string, details?: unknown } }
```

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | Missing/invalid/expired session cookie |
| `forbidden` | 403 | Reserved for future non-admin auth |
| `not_found` | 404 | Resource id doesn't exist |
| `validation_failed` | 400 | zod parse failed |
| `conflict` | 409 | Singleton full; email duplicate; bootstrap-admin delete attempt |
| `template_unknown` | 400 | `template_key` not in registry |
| `schema_op_failed` | 500 | DDL transaction rolled back |
| `method_not_allowed` | 405 | Wrong HTTP method |
| `internal` | 500 | Catch-all; logged with request_id |

### 10.3 Logging

Every request logs a single JSON line to stdout:

```json
{"ts":"2026-05-26T12:00:00Z","request_id":"...","route":"/api/clients","method":"POST","status":200,"ms":124,"admin_id":"...","template_key":"shop"}
```

DDL operations additionally write a row to `public.schema_ops_log` (durable audit trail).

---

## 11. Config files

### 11.1 `.env` (dev only — not in git)

```bash
DATABASE_URL=postgres://...neon dev branch...
GOOGLE_OAUTH_CLIENT_ID=<reuse v1.1 client id from same Google project>
JWT_SIGNING_SECRET=<NEW — 32-byte random secret, generated fresh>
COOKIE_SECURE=false                  # dev only; prod overrides to true
NODE_ENV=development

# Only read by scripts/bootstrap-admin.ts
BOOTSTRAP_ADMIN_EMAIL=theexsolenterprise@gmail.com
BOOTSTRAP_ADMIN_PASSWORD=<NEW — set on first bootstrap run>
```

Prod values set via Netlify env UI. `JWT_SIGNING_SECRET` is **new** — v1.1's secret is invalidated by the wipe.

### 11.2 Netlify env

Add: `SECRETS_SCAN_OMIT_KEYS=GOOGLE_OAUTH_CLIENT_ID` to prevent the secret-scanner false-positive that bit us in v1.1's `dfc50a1` handoff.

### 11.3 `netlify.toml`

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "20"
  SECRETS_SCAN_OMIT_KEYS = "GOOGLE_OAUTH_CLIENT_ID"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### 11.4 `package.json`

```json
{
  "name": "exsol-data-collection-app",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "netlify dev",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "migrate": "tsx --env-file=.env scripts/migrate.ts",
    "migrate:status": "tsx --env-file=.env scripts/migrate.ts --status",
    "reconcile": "tsx --env-file=.env scripts/reconcile-clients.ts",
    "bootstrap:admin": "tsx --env-file=.env scripts/bootstrap-admin.ts",
    "seed:dummy": "tsx --env-file=.env scripts/seed-dummy-clients.ts"
  },
  "dependencies": {
    "@neondatabase/serverless": "^0.10.0",
    "@node-rs/argon2": "^2.0.0",
    "google-auth-library": "^9.14.0",
    "jose": "^5.9.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^7.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@netlify/functions": "^2.8.0",
    "@types/node": "^22.7.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

Dropped from v1.1: `@netlify/blobs`, `exceljs`, `jszip`, `papaparse`, `resend`, `ws`. Re-added when modules that need them are built.

### 11.5 `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8888' },
  },
  build: { outDir: 'dist', sourcemap: true },
});
```

### 11.6 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src/**/*", "netlify/functions/**/*", "scripts/**/*", "tests/**/*", "db/templates/**/*"]
}
```

---

## 12. Testing strategy

| Tier | Tool | What it covers |
|---|---|---|
| Unit | vitest | Identifier validator, DDL generator (golden files per template), template validation, JWT mint/verify, argon hash/verify, Bucket cardinality logic |
| Integration | vitest + Neon test branch | Full HTTP round-trip: auth flows, client lifecycle (create → schema appears in pg_catalog → drop), bucket CRUD, singleton concurrency (two parallel inserts → exactly one succeeds with 409), reconcile applying template-version diff |
| Manual smoke | browser | UI flows on local + Netlify deploy preview before promote |

**Coverage rules:**
- `identifier.ts`: 100%. SQL-injection containment, no excuses.
- `template-ddl.ts`: golden-file tests for all 6 templates × current version. Snapshot the exact CREATE TABLE output.
- Singleton enforcement: integration test fires concurrent INSERTs, asserts 1 success + 1 409.
- Auth: login/Google/me/logout/cookie-refresh.
- Transactional DDL: inject failure mid-CREATE-SCHEMA, assert no orphan schema in `pg_catalog`.

**Out of scope:**
- React component snapshots (too fragile).
- All 6 templates × full HTTP integration (pick 2: Shop + Hospital; rest covered by unit DDL tests).

---

## 13. Phase plan (build order)

Each phase is independently committable and verifiable. The `writing-plans` skill (next step) will expand each into atomic tasks.

| Phase | Deliverable | Verification | Estimate |
|---|---|---|---|
| 0. Cleanup | `v1.1-final` tagged, v1.1 source deleted, Neon dev+prod tables dropped, `.env` rewritten | Working tree contains only kept files; `psql \dt` against both branches shows zero tables | < 1 hr |
| 1. Scaffold | `package.json` + `vite.config.ts` + `tsconfig.json` + `netlify.toml` + empty `App.tsx` saying "Hello" | `npm run dev` boots; `npm run build` succeeds; browser shows "Hello" | 1 hr |
| 2. Public schema + bootstrap admin | Migrations 001–004 apply; `bootstrap-admin` script seeds `theexsolenterprise@gmail.com` | `psql` shows `public.admins` has 1 row | 2 hr |
| 3. Login Module (auth) | `auth-*` functions, `LoginPage`, `AuthContext`, `RequireAdmin` | Sign-in (password + Google) works manually + integration tests pass | 1 day |
| 4. AMS shell | Sidebar, route shell, palette, empty `AdminDashboard`, `AdminSettings` self-edit | Signed-in admin sees empty grid + "Add Client" button | 0.5 day |
| 5. Templates + DDL generator + Bucket abstraction | `templates.ts`, `template-ddl.ts`, `identifier.ts`, `schema-manager.ts`, `bucket.ts`; all 6 templates with custom columns; golden files | All unit tests + golden files pass | 2 days |
| 6. Clients CRUD | `clients.ts`, `clients-detail.ts`, AddClientModal + Delete | Add Client → schema appears in `\dn`; Delete → gone; integration tests for atomicity | 1 day |
| 7. Bucket CRUD (dynamic forms) | `clients-buckets.ts`, `clients-bucket-users.ts`, `clients-bucket-user-detail.ts`, `BucketPanel`, dynamic `AddUserModal` / `EditUserModal`, `UserRow` | Add/edit/delete users in any bucket; required custom columns validated; singleton button disables | 2 days |
| 8. Admin team | `admin-team.ts`, `admin-team-detail.ts`, `admin-self.ts`, Settings page wired | Add second admin; sign in as them; bootstrap delete returns 409 | 0.5 day |
| 9. ClientDashboard + seed | Bucket-count overview; `seed-dummy-clients.ts` populates 3 clients | After fresh DB + seed: 3 cards, each opens with populated buckets | 0.5 day |
| 10. Reconcile + ADRs + README | `reconcile-clients.ts` (no-op for v1); ADRs 001–003; README rewrite | `npm run reconcile` exits 0; ADRs committed | 1 day |
| 11. Deploy preview smoke | Push to branch → Netlify deploy preview | Full clickthrough on the preview URL | 0.5 day |
| 12. Promote to prod | Run `npm run migrate` against prod Neon URL FIRST, then merge to main | `/` on prod loads; sign in; create/delete real client | 0.5 day |

**Total estimate: ~10–11 working days.** (vs ~8 days for the shared-columns-only version that was rejected in favour of domain-aware records.)

---

## 14. Definition of Done (AMS v1)

- [ ] Bootstrap admin can sign in via password.
- [ ] Bootstrap admin can sign in via Google with `theexsolenterprise@gmail.com`.
- [ ] Admin dashboard shows 3 dummy clients after seed.
- [ ] Admin can create a new client of any of the 6 templates. A per-client schema appears in Postgres with the correct role tables and per-role custom columns.
- [ ] Admin can delete a client. The schema is dropped; `public.clients` row removed; `schema_ops_log` row written.
- [ ] Each client's Settings page renders every role as its own bucket panel in template order, with correct count badges.
- [ ] Admin can add a user to any bucket; the form is dynamically built from the role's columns; required custom columns are validated server-side.
- [ ] Singleton enforcement works at UI (button disables), API (409 conflict), and DB (unique index) layers.
- [ ] Bucket list view shows custom columns marked `display_in_list: true`.
- [ ] Editing a row preserves all custom column values; required custom columns cannot be cleared.
- [ ] Admin can remove any user.
- [ ] Admin can add a second admin (password OR Google); that admin can sign in and has full powers.
- [ ] Bootstrap admin cannot be deleted (409 conflict).
- [ ] Sign-out clears the cookie and redirects to `/login`.
- [ ] All unit tests pass.
- [ ] Integration tests pass against the Neon test branch.
- [ ] `npm run build` produces a clean `dist` with no TypeScript errors.
- [ ] Bumping any template's version with a new column triggers `reconcile` ALTER TABLE across matching clients (verified by test, not exercised in v1 production).
- [ ] Netlify deploy preview works end-to-end.
- [ ] Production deploy works end-to-end.
- [ ] `docs/adr/001-per-client-schemas.md`, `002-hardcoded-templates-with-versioning.md`, `003-no-rls-admin-only.md` are written and committed.

---

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| SQL injection via dynamic identifier | Strict regex validators applied at three layers (template load, DDL build, query build). 100% test coverage on `identifier.ts`. Only `safeQuoteIdent` interpolates identifiers. |
| Half-created schema on Add Client failure | All DDL wrapped in transactions. Postgres guarantees no partial schema. Test injects failure mid-transaction to verify. |
| Template version drift between clients | `reconcile-clients.ts` runs on every deploy; idempotent; logs every action to `schema_ops_log`. |
| Wrong env vars in prod (e.g., dev `DATABASE_URL` leaks to prod) | `env.ts` validates with zod at function start; mismatches abort the function with a clear log line. |
| Bootstrap admin lockout (forgets password, no Google linked) | `bootstrap-admin` script links Google during the bootstrap flow (Phase 2). Recovery path: re-run `bootstrap-admin` with a fresh password — it updates the existing row by email match. |
| Netlify secret scanner false-positive (v1.1 lesson) | `SECRETS_SCAN_OMIT_KEYS=GOOGLE_OAUTH_CLIENT_ID` set in `netlify.toml` env block. |
| Prod migration drift (v1.1 lesson) | Phase 12 explicitly runs `npm run migrate` against prod Neon URL before merging code that depends on it. |
| DDL operations timing out on big templates | All current templates have ≤5 roles; transaction completes well under Netlify's 10s function timeout. If a future template grows huge, split into multiple smaller DDL operations. |
| Concurrent Add Client for the same client name | `public.clients.name` is NOT unique (clients can share names — they're separate businesses). The schema name is UUID-random, so no collision possible. |

---

## 16. ADRs to write during implementation

1. **ADR-001: Per-client Postgres schemas with per-role tables inside.**
   - Captures the trade-off discussion from this spec's §8.
   - Records why per-client schemas were chosen over a single `users` table with role filtering.
2. **ADR-002: Templates hardcoded in TypeScript with version-based reconcile.**
   - Why templates aren't editable from the UI in v1.
   - The reconcile design (forward-only, idempotent).
3. **ADR-003: No RLS in v1 (admin-only access).**
   - Why we skip the RLS work from v1.1.
   - When we'd revisit (non-admin sign-in module).

Future ADRs as decisions arise.

---

## 17. Open questions deferred to implementation

These are minor enough to resolve during the plan phase or the build itself:

- Exact JWT TTL + sliding-refresh threshold (currently 15 min + 5 min, may tune).
- Whether `notes` column should be included in `display_in_list` by default (currently no; could surface as truncated text).
- Tooltip implementation (CSS-only vs library).
- Confirm dialog component (native `confirm()` for v1, custom modal later).
- Loading states on `BucketPanel` initial fetch (skeleton vs spinner vs nothing).

---

*End of spec. Implementation plan to follow via the `writing-plans` skill.*
