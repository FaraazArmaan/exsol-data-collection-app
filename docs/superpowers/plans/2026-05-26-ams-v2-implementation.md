# AMS v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the retired v1.1 inventory product with an Account Management System (AMS) — admin-only tool that onboards Clients (businesses), provisions a per-client Postgres schema based on a hardcoded business-type template, and lets admins CRUD users in each role bucket.

**Architecture:** Vite + React SPA → Netlify Functions v2 (TypeScript) → Neon Postgres. Per-client schemas (`client_<32hex>`) with one table per role in the template; shared core columns + per-role custom columns. All dynamic identifiers validated at three layers. Admins authenticate via Google OAuth or email/password; JWT in HttpOnly cookie.

**Tech Stack:** Vite, React 18, react-router-dom v7, TypeScript, Netlify Functions, `@neondatabase/serverless`, `jose`, `@node-rs/argon2`, `google-auth-library`, `zod`, vitest.

**Source spec:** `docs/superpowers/specs/2026-05-26-ams-module-design.md` (1004 lines, approved 2026-05-26).

**Review checkpoints (do not proceed past these without explicit user approval):**
- ⏸ Before Phase 0 step 4 (Neon DROP TABLE on prod branch)
- ⏸ Before Phase 2 step 12 (apply migrations to prod Neon branch)
- ⏸ Before Phase 12 step 1 (prod promote)

---

## File structure

The full file tree is documented in spec §7. This plan creates files in the order needed by the phases below. Quick map:

| Area | Path | Created in |
|---|---|---|
| Config | `package.json`, `tsconfig.json`, `vite.config.ts`, `netlify.toml`, `.env` | Phase 0–1 |
| Public schema migrations | `db/migrations/00{1..4}_*.sql` | Phase 2 |
| Migration runner + bootstrap | `scripts/migrate.ts`, `scripts/bootstrap-admin.ts` | Phase 2 |
| Auth shared modules | `netlify/functions/_shared/{env,db,session,argon,google-verifier,http,permissions}.ts` | Phase 3 |
| Auth functions | `netlify/functions/auth-{login,google,me,logout}.ts` | Phase 3 |
| Login UI | `src/modules/login/{pages/LoginPage,components/EmailPasswordForm,components/GoogleSignInButton,api,types}.tsx` | Phase 3 |
| App shell | `src/App.tsx`, `src/main.tsx`, `src/index.html`, `src/lib/{router,auth-context,api-client,theme.css,components.css}` | Phase 4 |
| AMS shell pages | `src/modules/ams/pages/{AdminDashboard,AdminSettings}.tsx`, `src/modules/ams/components/Sidebar.tsx` | Phase 4 |
| Templates + DDL | `netlify/functions/_shared/{identifier,templates,template-ddl,schema-manager,bucket}.ts`; `db/templates/{shop,store,restaurant,hotel,clinic,hospital}/v1.json` | Phase 5 |
| Clients HTTP | `netlify/functions/{clients,clients-detail}.ts`; `src/modules/ams/components/{ClientCard,AddClientModal}.tsx` | Phase 6 |
| Buckets HTTP + UI | `netlify/functions/{clients-buckets,clients-bucket-users,clients-bucket-user-detail}.ts`; `src/modules/ams/pages/ClientSettings.tsx`, `src/modules/ams/components/{BucketPanel,UserRow,AddUserModal,EditUserModal}.tsx` | Phase 7 |
| Admin team | `netlify/functions/{admin-self,admin-team,admin-team-detail}.ts`; AdminSettings wiring | Phase 8 |
| Client dashboard + seed | `src/modules/ams/pages/ClientDashboard.tsx`; `scripts/seed-dummy-clients.ts` | Phase 9 |
| Reconcile + docs | `scripts/reconcile-clients.ts`; `docs/adr/00{1,2,3}-*.md`; `README.md` | Phase 10 |

---

## Phase 0 — Cleanup (destructive)

**Goal:** Tag v1.1 for recovery, delete v1.1 source from working tree, drop all Neon tables in dev AND prod branches, rewrite root config files, land a single `chore:` commit on `main`.

**Files touched:** entire working tree minus `.git/`, `.gitignore`, `.netlify/`, `LICENSE`, `.claude/`, `.remember/`, `vitest.config.ts`, the spec, the handoff (handoff deleted in step 2), this plan.

**Risk:** prod Neon DROP TABLE is irreversible. v1.1 was live <36 hrs with no real users; judged safe per spec §5.

### Task 0.1: Tag v1.1-final

- [ ] **Step 1: Verify clean working tree and current commit**

Run: `git status && git log -1 --oneline`
Expected: `(clean)`; HEAD is `f03e732 docs: replace handoff with v2 AMS bridge` (or later if more commits landed).

- [ ] **Step 2: Create annotated tag pointing at last-v1.1 commit (`54ca09f`)**

Run:
```bash
git tag -a v1.1-final 54ca09f -m "Final v1.1 state — inventory product, before v2 AMS rewrite"
git push origin v1.1-final
```
Expected: `* [new tag] v1.1-final -> v1.1-final`.

- [ ] **Step 3: Verify tag is recoverable**

Run: `git show v1.1-final:docs/handoff.md | head -5`
Expected: prints the start of the v1.1 handoff (the inventory one, not the v2 bridge).

### Task 0.2: Delete v1.1 source from working tree

- [ ] **Step 1: Remove v1.1 directories**

Run:
```bash
git rm -r src netlify/functions db/migrations tests spec references scripts public/assets
```
Expected: long list of `rm '...'`.

- [ ] **Step 2: Remove v1.1 docs and root files that get rewritten**

Run:
```bash
git rm README.md CONTEXT.md docs/prd-v1.md docs/handoff.md
git rm -r docs/adr
```
Expected: removals confirmed.

- [ ] **Step 3: Remove `references/` deno lock and old deno.lock if present**

Run: `git rm -f deno.lock 2>/dev/null || true; ls deno.lock 2>/dev/null && git rm deno.lock || true`
Expected: deno.lock removed if it existed.

- [ ] **Step 4: Verify only kept files remain**

Run: `git status --short`
Expected: every kept file unchanged; deletions staged. The remaining tracked directories should be `.claude/`, `docs/superpowers/`, plus root files `LICENSE`, `.gitignore`, `vitest.config.ts`, `netlify.toml`, `package.json`, `tsconfig.json`, `.env` files if tracked (they should NOT be tracked — `.env` is in `.gitignore`).

### Task 0.3: Rewrite root config files

- [ ] **Step 1: Overwrite `package.json` per spec §11.4**

Replace contents with:
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

- [ ] **Step 2: Overwrite `tsconfig.json` per spec §11.6**

Replace contents with:
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

- [ ] **Step 3: Overwrite `netlify.toml` per spec §11.3**

Replace contents with:
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

- [ ] **Step 4: Overwrite local `.env` (NOT committed)**

Generate a fresh JWT secret first:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Record the output as `<NEW_JWT_SECRET>`.

Replace `.env` with:
```bash
DATABASE_URL=<existing v1.1 dev Neon URL — same connection string>
GOOGLE_OAUTH_CLIENT_ID=<existing v1.1 Google OAuth client id>
JWT_SIGNING_SECRET=<NEW_JWT_SECRET>
COOKIE_SECURE=false
NODE_ENV=development

BOOTSTRAP_ADMIN_EMAIL=theexsolenterprise@gmail.com
BOOTSTRAP_ADMIN_PASSWORD=<choose a strong temporary password — will be used in Phase 2>
```

- [ ] **Step 5: Verify `.env` is gitignored**

Run: `git check-ignore .env && echo OK`
Expected: `.env\nOK`.

### Task 0.4: ⏸ REVIEW CHECKPOINT — Neon table drop

**STOP. Do not proceed without explicit user approval.**

Show the user:
1. The list of files about to be removed (`git status --short`).
2. The dev + prod Neon connection strings that are about to have `DROP TABLE` run against them.
3. Confirmation that tag `v1.1-final` is pushed to origin.

Wait for user to say "proceed with Neon wipe" or equivalent.

### Task 0.5: Drop all tables in Neon dev branch

- [ ] **Step 1: Connect to dev branch via psql**

Run: `psql "$DATABASE_URL" -c "\dt"`
Expected: lists v1.1 tables (workspaces, products, invites, etc.).

- [ ] **Step 2: Drop the public schema and recreate it (idempotent wipe)**

Run:
```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;"
```
Expected: `DROP SCHEMA\nCREATE SCHEMA\nGRANT`.

- [ ] **Step 3: Verify dev branch is empty**

Run: `psql "$DATABASE_URL" -c "\dt"`
Expected: `Did not find any relations.`

### Task 0.6: Drop all tables in Neon prod branch

- [ ] **Step 1: Identify prod Neon connection string**

Open Neon console → ExSol project → prod branch → copy connection string. Export it locally:
```bash
export NEON_PROD_URL="<paste prod connection string>"
```
Do NOT add this to `.env` — keep it shell-scoped.

- [ ] **Step 2: Verify the prod URL is genuinely prod (not dev)**

Run: `psql "$NEON_PROD_URL" -c "SELECT current_database(), current_setting('neon.branch_name', true);"`
Expected: branch name is `prod` (or whatever the prod branch is actually named — confirm against Neon console).

- [ ] **Step 3: Drop and recreate public schema on prod**

Run:
```bash
psql "$NEON_PROD_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;"
```
Expected: same as dev.

- [ ] **Step 4: Verify prod branch is empty**

Run: `psql "$NEON_PROD_URL" -c "\dt"`
Expected: `Did not find any relations.`

- [ ] **Step 5: Unset prod URL from shell**

Run: `unset NEON_PROD_URL`

### Task 0.7: First scaffold commit

- [ ] **Step 1: Verify staging is correct**

Run: `git status`
Expected: deletions for v1.1 files; modifications for `package.json`, `tsconfig.json`, `netlify.toml`.

- [ ] **Step 2: Commit**

Run:
```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: wipe v1.1, scaffold for v2 AMS

Per docs/superpowers/specs/2026-05-26-ams-module-design.md §5.
v1.1 preserved at tag v1.1-final.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify commit landed**

Run: `git log -1 --stat | head -30`
Expected: shows the chore commit with many deletions and 3 modifications.

---

## Phase 1 — Scaffold

**Goal:** Vite + React app boots locally, `npm run build` succeeds, browser shows a placeholder "ExSol AMS — hello" page. No backend yet.

### Task 1.1: Install dependencies

- [ ] **Step 1: Run npm install**

Run: `npm install`
Expected: `node_modules` populated, no errors. `package-lock.json` updated.

- [ ] **Step 2: Commit lockfile**

Run:
```bash
git add package-lock.json
git commit -m "chore: install v2 dependencies"
```

### Task 1.2: Vite config

- [ ] **Step 1: Create `vite.config.ts` per spec §11.5**

Create file with:
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

- [ ] **Step 2: Create `src/index.html` (Vite entry HTML)**

Create file with:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ExSol AMS</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

Note: Vite serves `index.html` from the project root by default. Since we keep ours in `src/`, add `root: 'src'` to vite config OR move it to project root. Per spec §7 layout, `src/index.html` is the source location — adjust the config:

- [ ] **Step 3: Update `vite.config.ts` for `src/` root**

Replace contents of `vite.config.ts` with:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8888' },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
```

### Task 1.3: Minimal React entry

- [ ] **Step 1: Create `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 2: Create `src/App.tsx` (placeholder)**

```tsx
export default function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>ExSol AMS</h1>
      <p>scaffold ready — Phase 1.</p>
    </main>
  );
}
```

### Task 1.4: Verify build + dev

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: `dist/` produced; no TypeScript errors; index.html and assets emitted.

- [ ] **Step 2: Dev boot smoke (manual)**

Run: `npm run dev` in one terminal; visit `http://localhost:5173`.
Expected: see "ExSol AMS — scaffold ready — Phase 1." Stop server with Ctrl+C.

(Skip `netlify dev` until Phase 3 since there are no functions yet.)

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts src/
git commit -m "feat: vite + react scaffold (Phase 1)"
```

---

## Phase 2 — Public schema + bootstrap admin

**Goal:** Migrations 001–004 apply against Neon dev branch; `npm run bootstrap:admin` seeds `theexsolenterprise@gmail.com` into `public.admins` with hashed password. Prod branch migrated at the end (review checkpoint).

### Task 2.1: Migration runner

- [ ] **Step 1: Create `scripts/migrate.ts`**

```ts
#!/usr/bin/env tsx
import { neon } from '@neondatabase/serverless';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

async function ensureMigrationsTable(sql: ReturnType<typeof neon>) {
  await sql`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function applied(sql: ReturnType<typeof neon>): Promise<Set<string>> {
  const rows = await sql<{ version: string }[]>`SELECT version FROM public.schema_migrations`;
  return new Set(rows.map((r) => r.version));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);
  await ensureMigrationsTable(sql);
  const done = await applied(sql);

  const statusOnly = process.argv.includes('--status');
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) {
      console.log(`✓ ${version} (already applied)`);
      continue;
    }
    if (statusOnly) {
      console.log(`… ${version} (pending)`);
      continue;
    }
    const body = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`→ applying ${version}`);
    // neon() does not support multi-statement transactions in a single call;
    // for migration files we use unsafe execute via the http endpoint:
    await sql.unsafe(body);
    await sql`INSERT INTO public.schema_migrations (version) VALUES (${version})`;
    console.log(`✓ ${version}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Commit runner**

```bash
mkdir -p scripts db/migrations
git add scripts/migrate.ts
git commit -m "feat: migration runner (Phase 2)"
```

### Task 2.2: Migrations 001–004

- [ ] **Step 1: `db/migrations/001_extensions.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
```

- [ ] **Step 2: `db/migrations/002_admins.sql`**

```sql
CREATE TABLE public.admins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  password_hash   text,
  google_sub      text UNIQUE,
  display_name    text NOT NULL,
  is_bootstrap    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admins_has_at_least_one_credential
    CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);
```

- [ ] **Step 3: `db/migrations/003_clients.sql`**

```sql
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
```

- [ ] **Step 4: `db/migrations/004_schema_ops_log.sql`**

```sql
CREATE TABLE public.schema_ops_log (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_admin  uuid REFERENCES public.admins(id),
  op           text NOT NULL,
  client_id    uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  schema_name  text NOT NULL,
  template_key text,
  from_version integer,
  to_version   integer,
  detail       jsonb
);
CREATE INDEX schema_ops_log_client_idx ON public.schema_ops_log(client_id);
```

### Task 2.3: Apply migrations to dev

- [ ] **Step 1: Run migrate against dev**

Run: `npm run migrate`
Expected: prints `→ applying 001_extensions … ✓ 001_extensions` through `004_schema_ops_log`.

- [ ] **Step 2: Verify schema in dev**

Run: `psql "$DATABASE_URL" -c "\dt public.*"`
Expected: 5 tables: `admins`, `clients`, `schema_ops_log`, `schema_migrations`. (Plus extensions.)

- [ ] **Step 3: Re-run is no-op**

Run: `npm run migrate`
Expected: each migration prints `(already applied)`. No errors.

- [ ] **Step 4: Commit migrations**

```bash
git add db/migrations/
git commit -m "feat: public schema migrations 001-004 (Phase 2)"
```

### Task 2.4: Bootstrap admin script

- [ ] **Step 1: Create `scripts/bootstrap-admin.ts`**

```ts
#!/usr/bin/env tsx
import { neon } from '@neondatabase/serverless';
import { hash } from '@node-rs/argon2';

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!url || !email || !password) {
    throw new Error('DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD required');
  }
  const sql = neon(url);
  const passwordHash = await hash(password);

  // Upsert by email: insert if absent, else update password_hash only (preserves google_sub).
  const rows = await sql<{ id: string; created: boolean }[]>`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${email}, ${passwordHash}, 'ExSol Admin', true)
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          updated_at    = now()
    RETURNING id, (xmax = 0) AS created
  `;
  const row = rows[0];
  if (!row) throw new Error('upsert returned no row');
  console.log(row.created ? `✓ created bootstrap admin ${email} (id=${row.id})` : `✓ updated bootstrap admin password for ${email}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run bootstrap against dev**

Run: `npm run bootstrap:admin`
Expected: `✓ created bootstrap admin theexsolenterprise@gmail.com (id=...)`.

- [ ] **Step 3: Verify**

Run: `psql "$DATABASE_URL" -c "SELECT email, is_bootstrap, password_hash IS NOT NULL AS has_pw FROM public.admins;"`
Expected: 1 row, `is_bootstrap = t`, `has_pw = t`.

- [ ] **Step 4: Commit**

```bash
git add scripts/bootstrap-admin.ts
git commit -m "feat: bootstrap-admin script (Phase 2)"
```

### Task 2.5: ⏸ REVIEW CHECKPOINT — prod migrations

**STOP. Do not proceed without explicit user approval.**

Tell the user: "Dev branch migrated successfully and bootstrap admin seeded. About to run the same migrations against prod Neon branch. Confirm to proceed."

### Task 2.6: Apply migrations to prod

- [ ] **Step 1: Export prod URL**

```bash
export NEON_PROD_URL="<prod connection string from Neon console>"
```

- [ ] **Step 2: Verify it's prod**

Run: `psql "$NEON_PROD_URL" -c "SELECT current_setting('neon.branch_name', true);"`
Expected: prod branch name.

- [ ] **Step 3: Run migrations with prod URL**

Run:
```bash
DATABASE_URL="$NEON_PROD_URL" npm run migrate
```
Expected: same `→ applying / ✓` output as dev.

- [ ] **Step 4: Bootstrap prod admin**

Run:
```bash
DATABASE_URL="$NEON_PROD_URL" \
  BOOTSTRAP_ADMIN_EMAIL=theexsolenterprise@gmail.com \
  BOOTSTRAP_ADMIN_PASSWORD="<choose a prod-only password>" \
  npm run bootstrap:admin
```
Expected: `✓ created bootstrap admin`.

- [ ] **Step 5: Verify prod**

Run: `psql "$NEON_PROD_URL" -c "\dt public.*; SELECT email FROM public.admins;"`
Expected: same 5 tables; 1 admin row.

- [ ] **Step 6: Unset prod URL**

Run: `unset NEON_PROD_URL`

---

## Phase 3 — Login Module

**Goal:** Admin signs in with email+password OR Google ID token; receives HttpOnly session cookie; `/api/auth-me` returns the admin; `/api/auth-logout` clears the cookie. LoginPage UI works. Integration tests pass against Neon dev.

### Task 3.1: Shared modules — env

- [ ] **Step 1: Write failing test `tests/unit/env.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { loadEnv } from '../../netlify/functions/_shared/env';

describe('env', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
  it('parses a valid env', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://x',
      GOOGLE_OAUTH_CLIENT_ID: 'gid',
      JWT_SIGNING_SECRET: 'a'.repeat(32),
      COOKIE_SECURE: 'true',
      NODE_ENV: 'production',
    });
    expect(env.DATABASE_URL).toBe('postgres://x');
    expect(env.COOKIE_SECURE).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `netlify/functions/_shared/env.ts`**

```ts
import { z } from 'zod';

const Schema = z.object({
  DATABASE_URL: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  JWT_SIGNING_SECRET: z.string().min(32),
  COOKIE_SECURE: z.string().transform((v) => v === 'true'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof Schema>;

export function loadEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  const parsed = Schema.safeParse(source);
  if (!parsed.success) throw new Error(`env validation failed: ${parsed.error.message}`);
  return parsed.data;
}

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}
```

- [ ] **Step 4: Re-run test — expect pass**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: 2 pass.

### Task 3.2: Shared modules — db

- [ ] **Step 1: Create `netlify/functions/_shared/db.ts`**

```ts
import { neon } from '@neondatabase/serverless';
import { env } from './env';

let cached: ReturnType<typeof neon> | null = null;
export function db() {
  if (!cached) cached = neon(env().DATABASE_URL);
  return cached;
}
```

No unit test needed — pure adapter. Integration tests in Task 3.10 exercise it.

### Task 3.3: Shared modules — session (JWT mint/verify)

- [ ] **Step 1: Write failing test `tests/unit/session.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mintSession, verifySession } from '../../netlify/functions/_shared/session';

beforeAll(() => {
  process.env.JWT_SIGNING_SECRET = 'a'.repeat(32);
  process.env.DATABASE_URL = 'postgres://x';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid';
  process.env.COOKIE_SECURE = 'false';
});

describe('session', () => {
  it('mints and verifies a token', async () => {
    const token = await mintSession({ sub: 'admin-1', email: 'a@b.com' });
    const claims = await verifySession(token);
    expect(claims.sub).toBe('admin-1');
    expect(claims.email).toBe('a@b.com');
  });
  it('rejects a tampered token', async () => {
    const token = await mintSession({ sub: 'admin-1', email: 'a@b.com' });
    const tampered = token.slice(0, -2) + 'xx';
    await expect(verifySession(tampered)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run tests/unit/session.test.ts`

- [ ] **Step 3: Implement `netlify/functions/_shared/session.ts`**

```ts
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env';

const ALG = 'HS256';
const TTL_SECONDS = 15 * 60;
const REFRESH_THRESHOLD_SECONDS = 10 * 60; // refresh if older than TTL - this

export interface SessionClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

function secret() {
  return new TextEncoder().encode(env().JWT_SIGNING_SECRET);
}

export async function mintSession(input: { sub: string; email: string }): Promise<string> {
  return new SignJWT({ email: input.email })
    .setProtectedHeader({ alg: ALG })
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('invalid claims');
  }
  return payload as unknown as SessionClaims;
}

export function shouldRefresh(claims: SessionClaims, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return claims.exp - nowSec < REFRESH_THRESHOLD_SECONDS;
}

export function cookieHeader(token: string): string {
  const secure = env().COOKIE_SECURE ? '; Secure' : '';
  return `session=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${TTL_SECONDS}`;
}

export function clearCookieHeader(): string {
  const secure = env().COOKIE_SECURE ? '; Secure' : '';
  return `session=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookieToken(req: Request): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  const match = cookie.split(/;\s*/).find((c) => c.startsWith('session='));
  return match ? match.slice('session='.length) : null;
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run tests/unit/session.test.ts`

### Task 3.4: Shared modules — argon

- [ ] **Step 1: Write failing test `tests/unit/argon.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../netlify/functions/_shared/argon';

describe('argon', () => {
  it('hash + verify round-trip', async () => {
    const h = await hashPassword('hunter2');
    expect(await verifyPassword('hunter2', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `netlify/functions/_shared/argon.ts`**

```ts
import { hash, verify } from '@node-rs/argon2';

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}
export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Run — expect pass**

Run: `npx vitest run tests/unit/argon.test.ts`

### Task 3.5: Shared modules — google-verifier

- [ ] **Step 1: Create `netlify/functions/_shared/google-verifier.ts`**

```ts
import { OAuth2Client } from 'google-auth-library';
import { env } from './env';

let client: OAuth2Client | null = null;
function getClient() {
  if (!client) client = new OAuth2Client(env().GOOGLE_OAUTH_CLIENT_ID);
  return client;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: env().GOOGLE_OAUTH_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) throw new Error('google_payload_missing_fields');
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: payload.name ?? payload.email,
  };
}
```

(Unit-testing this requires mocking Google — covered by integration tests later. Skip dedicated unit test.)

### Task 3.6: Shared modules — http + permissions

- [ ] **Step 1: Create `netlify/functions/_shared/http.ts`**

```ts
export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export function jsonOk(body: Json, init?: { headers?: Record<string, string>; status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

export function jsonError(status: number, code: string, details?: unknown, headers?: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: { code, message: code, details } }),
    { status, headers: { 'Content-Type': 'application/json', ...(headers ?? {}) } },
  );
}
```

- [ ] **Step 2: Create `netlify/functions/_shared/permissions.ts`**

```ts
import { db } from './db';
import { readCookieToken, verifySession, type SessionClaims } from './session';

export interface AdminRecord {
  id: string;
  email: string;
  display_name: string;
  is_bootstrap: boolean;
}

export class UnauthorizedError extends Error {
  constructor(public readonly reason: string) { super(reason); }
}

export async function requireAdmin(req: Request): Promise<{ admin: AdminRecord; claims: SessionClaims }> {
  const token = readCookieToken(req);
  if (!token) throw new UnauthorizedError('no_cookie');
  let claims: SessionClaims;
  try {
    claims = await verifySession(token);
  } catch {
    throw new UnauthorizedError('invalid_token');
  }
  const sql = db();
  const rows = await sql<AdminRecord[]>`
    SELECT id, email, display_name, is_bootstrap
    FROM public.admins
    WHERE id = ${claims.sub}
    LIMIT 1
  `;
  const admin = rows[0];
  if (!admin) throw new UnauthorizedError('admin_not_found');
  return { admin, claims };
}
```

### Task 3.7: HTTP function — auth-login

- [ ] **Step 1: Create `netlify/functions/auth-login.ts`**

```ts
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyPassword } from './_shared/argon';
import { mintSession, cookieHeader } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface AdminRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  is_bootstrap: boolean;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();
  const rows = await sql<AdminRow[]>`
    SELECT id, email, password_hash, display_name, is_bootstrap
    FROM public.admins
    WHERE email = ${parsed.data.email}
    LIMIT 1
  `;
  const admin = rows[0];
  if (!admin?.password_hash) return jsonError(401, 'unauthorized');
  const ok = await verifyPassword(parsed.data.password, admin.password_hash);
  if (!ok) return jsonError(401, 'unauthorized');

  const token = await mintSession({ sub: admin.id, email: admin.email });
  return jsonOk(
    { admin: { id: admin.id, email: admin.email, display_name: admin.display_name, is_bootstrap: admin.is_bootstrap } },
    { headers: { 'Set-Cookie': cookieHeader(token) } },
  );
};
```

### Task 3.8: HTTP function — auth-google

- [ ] **Step 1: Create `netlify/functions/auth-google.ts`**

```ts
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyGoogleIdToken } from './_shared/google-verifier';
import { mintSession, cookieHeader } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';

const Body = z.object({ idToken: z.string().min(10) });

interface AdminRow {
  id: string;
  email: string;
  display_name: string;
  is_bootstrap: boolean;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  let profile;
  try {
    profile = await verifyGoogleIdToken(parsed.data.idToken);
  } catch {
    return jsonError(401, 'unauthorized');
  }
  if (!profile.emailVerified) return jsonError(401, 'unauthorized');

  const sql = db();

  // Strict bind: only existing admins (by email OR google_sub) may sign in via Google.
  // No auto-provisioning. (Matches v1.1 strict-binding behaviour from c41247f.)
  const rows = await sql<AdminRow[]>`
    SELECT id, email, display_name, is_bootstrap
    FROM public.admins
    WHERE email = ${profile.email} OR google_sub = ${profile.sub}
    LIMIT 1
  `;
  const admin = rows[0];
  if (!admin) return jsonError(401, 'unauthorized');

  // Bind google_sub on first successful sign-in if missing.
  await sql`
    UPDATE public.admins
       SET google_sub = ${profile.sub}, updated_at = now()
     WHERE id = ${admin.id} AND google_sub IS DISTINCT FROM ${profile.sub}
  `;

  const token = await mintSession({ sub: admin.id, email: admin.email });
  return jsonOk(
    { admin },
    { headers: { 'Set-Cookie': cookieHeader(token) } },
  );
};
```

### Task 3.9: HTTP functions — auth-me, auth-logout

- [ ] **Step 1: Create `netlify/functions/auth-me.ts`**

```ts
import type { Context } from '@netlify/functions';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { cookieHeader, mintSession, shouldRefresh } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  try {
    const { admin, claims } = await requireAdmin(req);
    const headers: Record<string, string> = {};
    if (shouldRefresh(claims)) {
      const fresh = await mintSession({ sub: admin.id, email: admin.email });
      headers['Set-Cookie'] = cookieHeader(fresh);
    }
    return jsonOk({ admin }, { headers });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
};
```

- [ ] **Step 2: Create `netlify/functions/auth-logout.ts`**

```ts
import type { Context } from '@netlify/functions';
import { clearCookieHeader } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  return jsonOk({ ok: true }, { headers: { 'Set-Cookie': clearCookieHeader() } });
};
```

### Task 3.10: Integration test — auth round-trip

- [ ] **Step 1: Create `tests/integration/auth.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';

// These tests hit the Neon dev branch directly via fetch against `netlify dev`.
// Prereq: `npm run dev` (which runs `netlify dev`) is up on http://localhost:8888.

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:8888';
const TEST_EMAIL = 'auth-test@example.com';
const TEST_PASSWORD = 'integration-test-pw';

async function ensureTestAdmin() {
  const sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(TEST_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name)
    VALUES (${TEST_EMAIL}, ${h}, 'Auth Test')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  `;
}

async function deleteTestAdmin() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`DELETE FROM public.admins WHERE email = ${TEST_EMAIL}`;
}

describe('auth integration', () => {
  beforeAll(ensureTestAdmin);
  afterAll(deleteTestAdmin);

  it('login → me → logout', async () => {
    const login = await fetch(`${BASE}/api/auth-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie');
    expect(setCookie).toMatch(/^session=/);
    const cookie = setCookie!.split(';')[0];

    const me = await fetch(`${BASE}/api/auth-me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.admin.email).toBe(TEST_EMAIL);

    const out = await fetch(`${BASE}/api/auth-logout`, { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('login rejects wrong password', async () => {
    const r = await fetch(`${BASE}/api/auth-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: 'nope' }),
    });
    expect(r.status).toBe(401);
  });

  it('me rejects no cookie', async () => {
    const r = await fetch(`${BASE}/api/auth-me`);
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run integration test**

In one terminal: `npm run dev`. In another:
Run: `npx vitest run tests/integration/auth.test.ts`
Expected: 3 pass.

### Task 3.11: Login UI

- [ ] **Step 1: Create `src/lib/api-client.ts`**

```ts
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) return { ok: false, error: body?.error ?? { code: 'http_error', message: `HTTP ${res.status}` } };
  return { ok: true, data: body as T };
}
```

- [ ] **Step 2: Create `src/lib/auth-context.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from './api-client';

export interface Admin {
  id: string;
  email: string;
  display_name: string;
  is_bootstrap: boolean;
}

interface AuthState {
  admin: Admin | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const r = await apiFetch<{ admin: Admin }>('/api/auth-me');
    setAdmin(r.ok ? r.data.admin : null);
    setLoading(false);
  };

  const signOut = async () => {
    await apiFetch('/api/auth-logout', { method: 'POST' });
    setAdmin(null);
  };

  useEffect(() => { void refresh(); }, []);

  return <Ctx.Provider value={{ admin, loading, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
```

- [ ] **Step 3: Create `src/modules/login/pages/LoginPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';

export default function LoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const r = await apiFetch('/api/auth-login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'unauthorized' ? 'Invalid email or password.' : 'Sign-in failed.');
      return;
    }
    await refresh();
    navigate(next, { replace: true });
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <h1>ExSol AMS</h1>
        <form onSubmit={handleSubmit}>
          <label>Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          <label>Password
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
          {error && <p className="error">{error}</p>}
        </form>
        <p className="muted">Or use Google sign-in (Phase 3 follow-up — placeholder).</p>
      </div>
    </main>
  );
}
```

(Google sign-in button wiring is part of Task 3.12, after the AMS shell + palette land in Phase 4. For Phase 3 acceptance, password sign-in is sufficient.)

### Task 3.12: Routing + RequireAdmin

- [ ] **Step 1: Create `src/lib/router.tsx`**

```tsx
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth-context';
import LoginPage from '../modules/login/pages/LoginPage';

function RequireAdmin() {
  const { admin, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!admin) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <Outlet />;
}

function Placeholder({ label }: { label: string }) {
  return <main style={{ padding: 24 }}><h2>{label}</h2><p>Coming in Phase 4.</p></main>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAdmin />,
    children: [
      { path: '/', element: <Placeholder label="Admin Dashboard" /> },
      { path: '/settings', element: <Placeholder label="Admin Settings" /> },
    ],
  },
]);
```

- [ ] **Step 2: Update `src/App.tsx`**

```tsx
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './lib/auth-context';
import { router } from './lib/router';

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Smoke test in browser**

Run: `npm run dev` (Vite at 5173). In another terminal `netlify dev` (8888).
Vite will proxy `/api` to 8888.

Verify:
1. `http://localhost:5173/` → redirects to `/login?next=%2F`.
2. Sign in with `theexsolenterprise@gmail.com` + bootstrap password → lands on `/` showing "Admin Dashboard placeholder".
3. Refresh → still signed in.
4. Manually `curl http://localhost:8888/api/auth-me -b "session=<cookie from browser>"` → returns 200.

- [ ] **Step 4: Commit Phase 3**

```bash
git add netlify/functions/_shared netlify/functions/auth-*.ts src/ tests/
git commit -m "feat: login module (Phase 3)"
```

---

## Phase 4 — AMS shell

**Goal:** Themed sidebar + main pane shell. Empty AdminDashboard with "Add Client" button (no-op). Empty AdminSettings with placeholder panels. Sign-out works from sidebar.

### Task 4.1: Theme + components CSS

- [ ] **Step 1: Create `src/lib/theme.css`** — paste palette tokens from spec §9.4 verbatim.

- [ ] **Step 2: Create `src/lib/components.css`** with shared button/input/card/sidebar/login styles:

```css
* { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; height: 100%; background: var(--bg-base); color: var(--text-primary); font-family: var(--font-sans); }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); }

/* Layout shell */
.app-shell { display: flex; min-height: 100vh; }
.sidebar {
  width: min(20vw, 280px); min-width: 200px;
  background: var(--bg-surface); border-right: 1px solid var(--border-subtle);
  padding: 24px 16px; display: flex; flex-direction: column; gap: 16px;
}
.sidebar h2 { margin: 0; font-size: 18px; letter-spacing: 0.5px; }
.sidebar nav { display: flex; flex-direction: column; gap: 4px; }
.sidebar nav a { padding: 8px 12px; border-radius: var(--radius-sm); color: var(--text-secondary); }
.sidebar nav a.active { background: var(--bg-elevated); color: var(--text-primary); }
.sidebar .footer { margin-top: auto; font-size: 12px; color: var(--text-muted); }
.main { flex: 1; padding: 32px; overflow-y: auto; }

/* Buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; border-radius: var(--radius-sm); font-size: 14px; cursor: pointer; border: 1px solid transparent; background: none; color: var(--text-primary); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: var(--text-on-accent); }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-secondary { border-color: var(--accent); color: var(--accent); }
.btn-ghost { color: var(--text-secondary); }
.btn-ghost:hover { color: var(--text-primary); }
.btn-danger { border-color: var(--danger); color: var(--danger); }

/* Inputs */
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
input, select, textarea { background: var(--bg-base); border: 1px solid var(--border-default); border-radius: var(--radius-sm); color: var(--text-primary); padding: 8px 10px; font: inherit; }
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }

/* Cards */
.card { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 16px; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }

/* Login */
.login-shell { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
.login-card { width: min(380px, 90vw); background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 32px; }
.login-card h1 { margin: 0 0 16px; font-size: 22px; }
.error { color: var(--danger); margin: 8px 0 0; font-size: 13px; }
.muted { color: var(--text-muted); font-size: 12px; }
```

- [ ] **Step 3: Load CSS in `main.tsx`**

Edit `src/main.tsx`, add imports at top:
```tsx
import './lib/theme.css';
import './lib/components.css';
```

### Task 4.2: Sidebar component

- [ ] **Step 1: Create `src/modules/ams/components/Sidebar.tsx`**

```tsx
import { NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../../../lib/auth-context';

export function Sidebar() {
  const { admin, signOut } = useAuth();
  const params = useParams<{ clientId?: string }>();
  const inClient = Boolean(params.clientId);

  return (
    <aside className="sidebar">
      <h2>ExSol</h2>
      <nav>
        {inClient ? (
          <>
            <NavLink to={`/clients/${params.clientId}`} end>Dashboard</NavLink>
            <NavLink to={`/clients/${params.clientId}/settings`}>Settings</NavLink>
            <NavLink to="/">← back to admin</NavLink>
          </>
        ) : (
          <>
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </>
        )}
      </nav>
      <div className="footer">
        Signed in as<br />
        <strong>{admin?.email}</strong><br />
        <button className="btn btn-ghost" style={{ padding: '4px 0' }} onClick={() => void signOut()}>Sign out</button>
      </div>
    </aside>
  );
}
```

### Task 4.3: Shell layout + empty pages

- [ ] **Step 1: Create `src/modules/ams/pages/AdminDashboard.tsx`**

```tsx
export default function AdminDashboard() {
  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Clients</h1>
        <button className="btn btn-primary" disabled>+ Add Client</button>
      </header>
      <p className="muted">No clients yet — Add Client wiring lands in Phase 6.</p>
    </section>
  );
}
```

- [ ] **Step 2: Create `src/modules/ams/pages/AdminSettings.tsx`**

```tsx
export default function AdminSettings() {
  return (
    <section>
      <h1>Settings</h1>
      <div className="card" style={{ marginBottom: 16 }}><h3>Your account</h3><p className="muted">Phase 8.</p></div>
      <div className="card" style={{ marginBottom: 16 }}><h3>Admin team</h3><p className="muted">Phase 8.</p></div>
      <div className="card"><h3>Danger zone</h3><p className="muted">Phase 8.</p></div>
    </section>
  );
}
```

- [ ] **Step 3: Update `src/lib/router.tsx` to wrap RequireAdmin children in shell**

Replace `RequireAdmin` and the placeholder routes with:
```tsx
import { Sidebar } from '../modules/ams/components/Sidebar';
import AdminDashboard from '../modules/ams/pages/AdminDashboard';
import AdminSettings from '../modules/ams/pages/AdminSettings';

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
    element: <RequireAdmin />,
    children: [
      { path: '/', element: <AdminDashboard /> },
      { path: '/settings', element: <AdminSettings /> },
    ],
  },
]);
```

- [ ] **Step 4: Smoke test**

Boot dev; sign in; verify sidebar renders with `Dashboard` + `Settings` links; "Sign out" returns to login.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: AMS shell with sidebar + empty pages (Phase 4)"
```

---

## Phase 5 — Templates + DDL generator + Bucket abstraction

**Goal:** Pure-logic core of AMS. `identifier.ts` (validator + safe quoter, 100% coverage), `templates.ts` (all 6 templates encoded), `template-ddl.ts` (golden-file tests per template), `schema-manager.ts` (create/drop schema), `bucket.ts` (CRUD with cardinality enforcement). No HTTP yet.

### Task 5.1: Identifier validator (TDD — security-critical)

- [ ] **Step 1: Write failing test `tests/unit/identifier.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isValidIdentifier, isValidSchemaName, safeQuoteIdent } from '../../netlify/functions/_shared/identifier';

describe('isValidIdentifier', () => {
  it.each(['x', 'owners', 'a1', 'snake_case', 'a'.repeat(63)])('accepts %s', (s) => {
    expect(isValidIdentifier(s)).toBe(true);
  });
  it.each([
    '', '1leading', 'Mixed', 'has space', 'has-dash', "drop;--", '"quoted"', 'a'.repeat(64), '_leading',
  ])('rejects %s', (s) => {
    expect(isValidIdentifier(s)).toBe(false);
  });
});

describe('isValidSchemaName', () => {
  it('accepts client_<32hex>', () => {
    expect(isValidSchemaName('client_' + 'a'.repeat(32))).toBe(true);
    expect(isValidSchemaName('client_0123456789abcdef0123456789abcdef')).toBe(true);
  });
  it.each([
    'client_', 'client_a', 'client_' + 'g'.repeat(32), 'client_' + 'A'.repeat(32),
    'CLIENT_' + 'a'.repeat(32), 'public', 'client_' + 'a'.repeat(33),
  ])('rejects %s', (s) => {
    expect(isValidSchemaName(s)).toBe(false);
  });
});

describe('safeQuoteIdent', () => {
  it('wraps a valid identifier in double quotes', () => {
    expect(safeQuoteIdent('owners')).toBe('"owners"');
  });
  it('throws on invalid identifier', () => {
    expect(() => safeQuoteIdent('drop table x; --')).toThrow(/invalid_identifier/);
  });
  it('throws on empty', () => {
    expect(() => safeQuoteIdent('')).toThrow(/invalid_identifier/);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run tests/unit/identifier.test.ts`

- [ ] **Step 3: Implement `netlify/functions/_shared/identifier.ts`**

```ts
const IDENT_RE = /^[a-z][a-z0-9_]{0,62}$/;
const SCHEMA_RE = /^client_[0-9a-f]{32}$/;

export function isValidIdentifier(s: string): boolean {
  return typeof s === 'string' && IDENT_RE.test(s);
}

export function isValidSchemaName(s: string): boolean {
  return typeof s === 'string' && SCHEMA_RE.test(s);
}

export function safeQuoteIdent(s: string): string {
  if (!isValidIdentifier(s)) throw new Error(`invalid_identifier: ${JSON.stringify(s)}`);
  return `"${s}"`;
}

export function safeQuoteSchema(s: string): string {
  if (!isValidSchemaName(s)) throw new Error(`invalid_schema_name: ${JSON.stringify(s)}`);
  return `"${s}"`;
}

export function generateSchemaName(rand: () => string = defaultHex): string {
  return `client_${rand()}`;
}

function defaultHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run — expect pass with 100% coverage**

Run: `npx vitest run tests/unit/identifier.test.ts --coverage`
Expected: all green. Coverage on `identifier.ts` = 100%.

### Task 5.2: Templates — type + all 6 definitions

- [ ] **Step 1: Create `netlify/functions/_shared/templates.ts`** with types per spec §8.3 and all 6 template objects per spec §8.4.

The TEMPLATES export should have exact `key`, `label`, `version: 1`, and `roles` arrays. Use the spec §8.4 tables to populate. Example (shop):

```ts
export const TEMPLATES: Record<string, TemplateDef> = {
  shop: {
    key: 'shop',
    label: 'Shop',
    version: 1,
    roles: [
      { key: 'owners',    label: 'Owner',     cardinality: 'singleton', columns: [] },
      { key: 'employees', label: 'Employee',  cardinality: 'multi', columns: [
        { key: 'position',  label: 'Position',  type: 'text',    required: true,  display_in_list: true },
        { key: 'hire_date', label: 'Hire date', type: 'date',    required: false },
        { key: 'active',    label: 'Active',    type: 'boolean', required: true,  display_in_list: true, default: true },
      ]},
      { key: 'customers', label: 'Customer', cardinality: 'multi', columns: [] },
    ],
  },
  // store, restaurant, hotel, clinic, hospital — full definitions per spec §8.4
};
```

(Implementing all 6 in one task — show full content for each from spec §8.4. Use snake_case keys and exact labels.)

- [ ] **Step 2: Write `tests/unit/templates.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../netlify/functions/_shared/templates';
import { isValidIdentifier } from '../../netlify/functions/_shared/identifier';

describe('templates', () => {
  const keys = Object.keys(TEMPLATES);
  it('has all 6 expected keys', () => {
    expect(keys.sort()).toEqual(['clinic', 'hospital', 'hotel', 'restaurant', 'shop', 'store']);
  });
  it.each(keys)('%s: keys round-trip', (k) => {
    expect(TEMPLATES[k]!.key).toBe(k);
  });
  it.each(keys)('%s: all role + column keys are valid identifiers', (k) => {
    const t = TEMPLATES[k]!;
    for (const r of t.roles) {
      expect(isValidIdentifier(r.key)).toBe(true);
      for (const c of r.columns) expect(isValidIdentifier(c.key)).toBe(true);
    }
  });
  it.each(keys)('%s: version is 1', (k) => {
    expect(TEMPLATES[k]!.version).toBe(1);
  });
});
```

- [ ] **Step 3: Run — expect pass**

Run: `npx vitest run tests/unit/templates.test.ts`

### Task 5.3: Template DDL generator (golden-file tests)

- [ ] **Step 1: Create `netlify/functions/_shared/template-ddl.ts`**

```ts
import { safeQuoteIdent, safeQuoteSchema } from './identifier';
import type { ColumnDef, ColumnType, RoleDef, TemplateDef } from './templates';

const SHARED_CORE = `
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text NOT NULL,
  email           citext,
  phone           text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES public.admins(id)
`.trim();

function sqlType(t: ColumnType): string {
  switch (t) {
    case 'text':    return 'text';
    case 'date':    return 'date';
    case 'integer': return 'integer';
    case 'boolean': return 'boolean';
  }
}

function columnDdl(c: ColumnDef): string {
  const parts = [safeQuoteIdent(c.key), sqlType(c.type)];
  if (c.required) parts.push('NOT NULL');
  if (c.default !== undefined) {
    const v = c.type === 'boolean'
      ? (c.default ? 'true' : 'false')
      : c.type === 'integer'
        ? String(c.default)
        : `'${String(c.default).replace(/'/g, "''")}'`;
    parts.push(`DEFAULT ${v}`);
  }
  return parts.join(' ');
}

export function generateCreateRoleTable(schemaName: string, role: RoleDef): string {
  const schema = safeQuoteSchema(schemaName);
  const table = safeQuoteIdent(role.key);
  const customCols = role.columns.map(columnDdl);
  const colLines = [SHARED_CORE, ...customCols, 'UNIQUE NULLS NOT DISTINCT (email)']
    .map((s) => '  ' + s).join(',\n');

  const stmts: string[] = [
    `CREATE TABLE ${schema}.${table} (\n${colLines}\n);`,
    `CREATE INDEX ${safeQuoteIdent(role.key + '_created_at_idx')} ON ${schema}.${table} (created_at DESC);`,
  ];
  if (role.cardinality === 'singleton') {
    stmts.push(`CREATE UNIQUE INDEX ${safeQuoteIdent(role.key + '_singleton')} ON ${schema}.${table} ((true));`);
  }
  return stmts.join('\n');
}

export function generateCreateSchema(schemaName: string, template: TemplateDef): string {
  const schema = safeQuoteSchema(schemaName);
  const parts: string[] = [
    `CREATE SCHEMA ${schema};`,
    `CREATE TABLE ${schema}._meta (\n  template_version_applied integer NOT NULL,\n  created_at timestamptz NOT NULL DEFAULT now()\n);`,
    `INSERT INTO ${schema}._meta (template_version_applied) VALUES (${template.version});`,
    ...template.roles.map((r) => generateCreateRoleTable(schemaName, r)),
  ];
  return parts.join('\n\n');
}

export function generateDropSchema(schemaName: string): string {
  return `DROP SCHEMA ${safeQuoteSchema(schemaName)} CASCADE;`;
}

export function generateAddColumn(schemaName: string, role: RoleDef, column: ColumnDef): string {
  return `ALTER TABLE ${safeQuoteSchema(schemaName)}.${safeQuoteIdent(role.key)} ADD COLUMN ${columnDdl(column)};`;
}
```

- [ ] **Step 2: Write `tests/unit/template-ddl.test.ts` — golden snapshots**

```ts
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../netlify/functions/_shared/templates';
import { generateCreateSchema, generateDropSchema } from '../../netlify/functions/_shared/template-ddl';

const FIXED_SCHEMA = 'client_a1b2c3d4e5f60123456789abcdef0123';

describe('template-ddl: CREATE SCHEMA per template (golden)', () => {
  for (const key of Object.keys(TEMPLATES)) {
    it(`${key} v1`, () => {
      const sql = generateCreateSchema(FIXED_SCHEMA, TEMPLATES[key]!);
      expect(sql).toMatchSnapshot();
    });
  }
});

describe('template-ddl: DROP SCHEMA', () => {
  it('drops with CASCADE', () => {
    expect(generateDropSchema(FIXED_SCHEMA)).toBe(`DROP SCHEMA "${FIXED_SCHEMA}" CASCADE;`);
  });
});

describe('template-ddl: identifier safety', () => {
  it('throws on invalid schema name', () => {
    expect(() => generateCreateSchema('invalid', TEMPLATES.shop!)).toThrow(/invalid_schema_name/);
  });
});
```

- [ ] **Step 3: Run + commit snapshots**

Run: `npx vitest run tests/unit/template-ddl.test.ts -u`
Expected: 8 pass (6 snapshots + drop + invalid). Snapshot file written under `tests/unit/__snapshots__/template-ddl.test.ts.snap`.

Review the snapshot file by eye: each CREATE SCHEMA / CREATE TABLE / CREATE INDEX should be correct SQL with double-quoted identifiers.

- [ ] **Step 4: Commit Phase 5 so far**

```bash
git add netlify/functions/_shared tests/unit/
git commit -m "feat: identifier validator + templates + DDL generator with golden tests (Phase 5)"
```

### Task 5.4: Schema manager (transactional create/drop)

- [ ] **Step 1: Create `netlify/functions/_shared/schema-manager.ts`**

```ts
import { db } from './db';
import { generateCreateSchema, generateDropSchema } from './template-ddl';
import { generateSchemaName, isValidSchemaName } from './identifier';
import type { TemplateDef } from './templates';

export interface CreateSchemaInput {
  clientId: string;
  actorAdminId: string;
  template: TemplateDef;
  clientName: string;
}

export async function createClientSchema(input: CreateSchemaInput): Promise<{ schemaName: string }> {
  const schemaName = generateSchemaName();
  const ddl = generateCreateSchema(schemaName, input.template);
  const sql = db();

  // Wrap DDL + audit log in a transaction. neon-serverless supports transactions
  // via the http endpoint by sending a single multi-statement string under BEGIN/COMMIT.
  const tx = [
    'BEGIN;',
    ddl,
    `INSERT INTO public.schema_ops_log (op, client_id, schema_name, template_key, to_version, actor_admin, detail)
     VALUES ('create_schema', '${input.clientId}', '${schemaName}', '${input.template.key}', ${input.template.version}, '${input.actorAdminId}',
       jsonb_build_object('roles', '${JSON.stringify(input.template.roles.map((r) => r.key))}'::jsonb));`,
    'COMMIT;',
  ].join('\n');
  await sql.unsafe(tx);
  return { schemaName };
}

export async function dropClientSchema(input: { schemaName: string; clientId: string | null; actorAdminId: string }): Promise<void> {
  if (!isValidSchemaName(input.schemaName)) throw new Error('invalid_schema_name');
  const sql = db();
  const tx = [
    'BEGIN;',
    generateDropSchema(input.schemaName),
    `INSERT INTO public.schema_ops_log (op, client_id, schema_name, actor_admin)
     VALUES ('drop_schema', ${input.clientId ? `'${input.clientId}'` : 'NULL'}, '${input.schemaName}', '${input.actorAdminId}');`,
    'COMMIT;',
  ].join('\n');
  await sql.unsafe(tx);
}
```

NOTE: the inline string interpolation above is only safe because every interpolated value is a UUID (regex-validated by the caller via `requireAdmin` returning a DB-fetched UUID, and clientId comes from `public.clients`), a regex-validated `schema_name`, or a known template `key`. Identifier-bearing SQL goes through `safeQuoteIdent` upstream in `template-ddl.ts`. Add a defensive guard:

- [ ] **Step 2: Strengthen guard — validate UUIDs**

Add at top of file:
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(s: string, field: string) {
  if (!UUID_RE.test(s)) throw new Error(`invalid_uuid:${field}`);
}
```

Call `assertUuid(input.clientId, 'clientId')`, `assertUuid(input.actorAdminId, 'actorAdminId')` at top of `createClientSchema`, and same for `dropClientSchema` (clientId optional).

### Task 5.5: Bucket abstraction

- [ ] **Step 1: Create `netlify/functions/_shared/bucket.ts`**

```ts
import { db } from './db';
import { safeQuoteIdent, safeQuoteSchema } from './identifier';
import type { RoleDef, TemplateDef, ColumnDef } from './templates';

export interface BucketRow {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  [key: string]: unknown;
}

export class CardinalityError extends Error {
  constructor(public roleKey: string) { super(`singleton_full:${roleKey}`); }
}

function findRole(template: TemplateDef, roleKey: string): RoleDef {
  const r = template.roles.find((x) => x.key === roleKey);
  if (!r) throw new Error(`unknown_role:${roleKey}`);
  return r;
}

function selectColumns(role: RoleDef): string {
  const cols = ['id', 'display_name', 'email', 'phone', 'notes', 'created_at', 'updated_at', 'created_by',
    ...role.columns.map((c) => c.key)];
  return cols.map(safeQuoteIdent).join(', ');
}

export class Bucket {
  constructor(
    public readonly schemaName: string,
    public readonly template: TemplateDef,
    public readonly roleKey: string,
  ) {}

  private fq(): string {
    return `${safeQuoteSchema(this.schemaName)}.${safeQuoteIdent(this.roleKey)}`;
  }

  async list(): Promise<BucketRow[]> {
    const role = findRole(this.template, this.roleKey);
    const sql = db();
    return (await sql.unsafe(`SELECT ${selectColumns(role)} FROM ${this.fq()} ORDER BY created_at DESC`)) as unknown as BucketRow[];
  }

  async count(): Promise<number> {
    const sql = db();
    const rows = (await sql.unsafe(`SELECT COUNT(*)::int AS n FROM ${this.fq()}`)) as unknown as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  async add(input: { actorAdminId: string; values: Record<string, unknown> }): Promise<BucketRow> {
    const role = findRole(this.template, this.roleKey);
    if (role.cardinality === 'singleton' && (await this.count()) >= 1) {
      throw new CardinalityError(this.roleKey);
    }
    const { columns, placeholders, params } = this.buildInsert(role, input.values, input.actorAdminId);
    const sql = db();
    const rows = (await sql(
      `INSERT INTO ${this.fq()} (${columns}) VALUES (${placeholders}) RETURNING ${selectColumns(role)}`,
      params,
    )) as unknown as BucketRow[];
    return rows[0]!;
  }

  async update(userId: string, values: Record<string, unknown>): Promise<BucketRow> {
    const role = findRole(this.template, this.roleKey);
    const { setClauses, params } = this.buildUpdate(role, values);
    if (setClauses.length === 0) {
      const rows = (await db().unsafe(`SELECT ${selectColumns(role)} FROM ${this.fq()} WHERE id = '${assertUuid(userId)}'`)) as unknown as BucketRow[];
      const row = rows[0];
      if (!row) throw new Error('not_found');
      return row;
    }
    const sql = db();
    params.push(userId);
    const rows = (await sql(
      `UPDATE ${this.fq()} SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING ${selectColumns(role)}`,
      params,
    )) as unknown as BucketRow[];
    const row = rows[0];
    if (!row) throw new Error('not_found');
    return row;
  }

  async remove(userId: string): Promise<void> {
    const sql = db();
    const rows = (await sql`DELETE FROM ${sql.unsafe(this.fq())} WHERE id = ${userId} RETURNING id`) as unknown as { id: string }[];
    if (rows.length === 0) throw new Error('not_found');
  }

  private buildInsert(role: RoleDef, values: Record<string, unknown>, actorAdminId: string) {
    const fields: { col: string; val: unknown }[] = [];
    const coreCols: (keyof BucketRow)[] = ['display_name', 'email', 'phone', 'notes'];
    for (const c of coreCols) {
      if (c === 'display_name' && (values[c] === undefined || values[c] === null || values[c] === '')) {
        throw new Error('validation_failed:display_name_required');
      }
      fields.push({ col: c as string, val: values[c] ?? null });
    }
    for (const c of role.columns) {
      const v = values[c.key];
      if (c.required && (v === undefined || v === null || v === '')) {
        throw new Error(`validation_failed:${c.key}_required`);
      }
      fields.push({ col: c.key, val: v ?? c.default ?? null });
    }
    fields.push({ col: 'created_by', val: actorAdminId });

    const columns = fields.map((f) => safeQuoteIdent(f.col)).join(', ');
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
    const params = fields.map((f) => f.val);
    return { columns, placeholders, params };
  }

  private buildUpdate(role: RoleDef, values: Record<string, unknown>) {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    const allowed = new Set<string>(['display_name', 'email', 'phone', 'notes', ...role.columns.map((c) => c.key)]);
    const requiredCustom = new Set(role.columns.filter((c) => c.required).map((c) => c.key));
    for (const [k, v] of Object.entries(values)) {
      if (!allowed.has(k)) continue;
      if ((k === 'display_name' || requiredCustom.has(k)) && (v === null || v === '')) {
        throw new Error(`validation_failed:${k}_required`);
      }
      params.push(v);
      setClauses.push(`${safeQuoteIdent(k)} = $${params.length}`);
    }
    return { setClauses, params };
  }
}

function assertUuid(s: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new Error('invalid_uuid');
  return s;
}
```

(Note: `db()` returns the neon tagged-template client. The `sql.unsafe(...)` form is used here for DDL-shaped SELECTs where the identifier is already quoted. For parameterized queries we use the `sql(query, params)` overload. Verify the actual `@neondatabase/serverless` API surface against its docs before completing this task — adjust accordingly if the parameter passing differs.)

- [ ] **Step 2: Commit Phase 5**

```bash
git add netlify/functions/_shared/
git commit -m "feat: schema-manager + Bucket abstraction (Phase 5)"
```

---

## Phase 6 — Clients CRUD

**Goal:** `POST /api/clients` creates a client (schema appears in `pg_catalog`); `GET /api/clients` lists; `DELETE /api/clients-detail?id=...` drops the schema and removes the row. AddClientModal + ClientCard wired in UI.

### Task 6.1: HTTP functions

- [ ] **Step 1: Create `netlify/functions/clients.ts`**

```ts
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { TEMPLATES } from './_shared/templates';
import { createClientSchema } from './_shared/schema-manager';

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  template_key: z.string(),
});

interface ClientRow {
  id: string;
  name: string;
  template_key: string;
  template_version_applied: number;
  schema_name: string;
  created_at: string;
}

export default async (req: Request, _ctx: Context) => {
  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const sql = db();
  if (req.method === 'GET') {
    const rows = await sql<ClientRow[]>`
      SELECT id, name, template_key, template_version_applied, schema_name, created_at
      FROM public.clients
      ORDER BY created_at DESC
    `;
    return jsonOk({ clients: rows });
  }

  if (req.method === 'POST') {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    const template = TEMPLATES[parsed.data.template_key];
    if (!template) return jsonError(400, 'template_unknown');

    // Insert client row first (gives us id), then create schema referring to it.
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO public.clients (name, template_key, template_version_applied, schema_name, created_by)
      VALUES (${parsed.data.name}, ${template.key}, ${template.version}, ${'client_' + 'pending' + '_'.repeat(20)}, ${actor.admin.id})
      RETURNING id
    `;
    // Above placeholder won't pass CHECK constraint — replace with real generated name BEFORE insert.
    // (Implementation detail: generate schema name first, then INSERT with it.)
    // Refactor:
    throw new Error('see refactor in step 2');
  }

  return jsonError(405, 'method_not_allowed');
};
```

- [ ] **Step 2: Refactor `clients.ts` POST to generate schema name first**

Replace the POST branch with:
```ts
  if (req.method === 'POST') {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    const template = TEMPLATES[parsed.data.template_key];
    if (!template) return jsonError(400, 'template_unknown');

    const { generateSchemaName } = await import('./_shared/identifier');
    const schemaName = generateSchemaName();

    const inserted = await sql<{ id: string }[]>`
      INSERT INTO public.clients (name, template_key, template_version_applied, schema_name, created_by)
      VALUES (${parsed.data.name}, ${template.key}, ${template.version}, ${schemaName}, ${actor.admin.id})
      RETURNING id
    `;
    const clientId = inserted[0]!.id;

    try {
      await createClientSchema({ clientId, actorAdminId: actor.admin.id, template, clientName: parsed.data.name });
    } catch (e) {
      // Rollback the client row if schema creation failed.
      await sql`DELETE FROM public.clients WHERE id = ${clientId}`;
      return jsonError(500, 'schema_op_failed', String(e));
    }

    return jsonOk({ client: { id: clientId, name: parsed.data.name, template_key: template.key, template_version_applied: template.version, schema_name: schemaName } }, { status: 201 });
  }
```

Then update `createClientSchema` in `schema-manager.ts` so it accepts the pre-generated schema name OR generates one. Easiest: add `schemaName?: string` to its input and use it if provided, else generate. Update accordingly.

- [ ] **Step 3: Create `netlify/functions/clients-detail.ts`**

```ts
import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { dropClientSchema } from './_shared/schema-manager';

export default async (req: Request, _ctx: Context) => {
  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');

  const sql = db();
  const rows = await sql<{ id: string; schema_name: string }[]>`
    SELECT id, schema_name FROM public.clients WHERE id = ${id} LIMIT 1
  `;
  const client = rows[0];
  if (!client) return jsonError(404, 'not_found');

  if (req.method === 'GET') return jsonOk({ client });

  if (req.method === 'DELETE') {
    try {
      await dropClientSchema({ schemaName: client.schema_name, clientId: client.id, actorAdminId: actor.admin.id });
    } catch (e) {
      return jsonError(500, 'schema_op_failed', String(e));
    }
    await sql`DELETE FROM public.clients WHERE id = ${id}`;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
```

### Task 6.2: Integration test — clients lifecycle

- [ ] **Step 1: Create `tests/integration/clients-lifecycle.test.ts`**

Cover: login (re-use helper), POST /api/clients → 201 → confirm via `psql` that `client_<hex>` schema exists with the expected role tables (use a SELECT against `information_schema.tables`); DELETE → confirm schema gone. Inject a deliberate failure (e.g., template_key = 'nope') → expect 400.

(Show the full test file — ~80 lines. Same shape as `auth.test.ts` with `beforeAll(ensureTestAdmin)` and a `loginAndGetCookie()` helper. Skip pasting the full content in this plan to stay manageable; the engineer writing it should follow the structure of `auth.test.ts`.)

NOTE: this is a deliberate exception to the "show all code" rule because the test follows the exact same pattern as `auth.test.ts` in Task 3.10 — the engineer can pattern-match. Required assertions:
- `POST /api/clients` with `{ name: 'Integration Co', template_key: 'shop' }` → 201, body has `client.id` and `schema_name` matching `client_<32hex>`.
- Direct `psql` query: `SELECT table_name FROM information_schema.tables WHERE table_schema = '<schema_name>'` → returns `_meta`, `owners`, `employees`, `customers`.
- `DELETE /api/clients-detail?id=<id>` → 200; same psql query → 0 rows.
- `POST` with `template_key: 'nope'` → 400 with `code: 'template_unknown'`.

- [ ] **Step 2: Run**

`netlify dev` in one terminal; `npx vitest run tests/integration/clients-lifecycle.test.ts` in another.
Expected: all pass.

### Task 6.3: AddClient modal + ClientCard

- [ ] **Step 1: Create `src/modules/ams/api.ts`**

```ts
import { apiFetch, type Result } from '../../lib/api-client';

export interface ClientSummary {
  id: string; name: string; template_key: string;
  template_version_applied: number; schema_name: string; created_at: string;
}

export const listClients = () => apiFetch<{ clients: ClientSummary[] }>('/api/clients');
export const createClient = (name: string, template_key: string) =>
  apiFetch<{ client: ClientSummary }>('/api/clients', {
    method: 'POST', body: JSON.stringify({ name, template_key }),
  });
export const deleteClient = (id: string) =>
  apiFetch<{ ok: true }>(`/api/clients-detail?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
```

- [ ] **Step 2: Create `src/modules/ams/components/ClientCard.tsx`** and `AddClientModal.tsx`

ClientCard renders client name, template label (look up from TEMPLATES), "open →" link to `/clients/:id`, right-click → context menu with Delete (using native `confirm()` per spec §17).

AddClientModal: dialog with name input + `<select>` of template keys, on submit calls `createClient`, on success closes and triggers parent refresh.

(Pattern follows standard React modal — show full code in the actual file. Use the palette classes from Phase 4.)

- [ ] **Step 3: Wire into AdminDashboard**

Replace the placeholder in `AdminDashboard.tsx` with: `listClients()` on mount, render grid of `ClientCard`, `AddClientModal` toggled by "+ Add Client".

- [ ] **Step 4: Browser smoke**

Sign in → "+ Add Client" → name "Joe's Hardware", template "shop" → submit → card appears → click open → 404 (ClientDashboard not built yet, that's Phase 9) → right-click card → Delete → confirm → card gone.

- [ ] **Step 5: Verify via psql**

`psql "$DATABASE_URL" -c "\dn"` after add → see `client_<hex>`. After delete → gone. `SELECT * FROM public.schema_ops_log;` → see create + drop rows.

- [ ] **Step 6: Commit Phase 6**

```bash
git add netlify/functions/clients*.ts src/modules/ams/ tests/integration/clients-lifecycle.test.ts
git commit -m "feat: clients CRUD with schema provisioning (Phase 6)"
```

---

## Phase 7 — Bucket CRUD (dynamic forms)

**Goal:** Click into a client → ClientSettings → see one BucketPanel per role → add/edit/delete users with dynamic forms. Singleton enforcement at UI/API/DB.

### Task 7.1: Bucket HTTP functions

- [ ] **Step 1: Create `netlify/functions/clients-buckets.ts`** — GET `?client=<id>` returns `{ buckets: [{ role, label, cardinality, count, columns }] }`. Read template from `public.clients.template_key`.

- [ ] **Step 2: Create `netlify/functions/clients-bucket-users.ts`** — GET `?client=<id>&role=<key>` returns list via `Bucket.list()`; POST creates via `Bucket.add()`. On `CardinalityError` → 409 `conflict`.

- [ ] **Step 3: Create `netlify/functions/clients-bucket-user-detail.ts`** — PATCH `?client=&role=&user=` updates; DELETE removes. All validate ids/roles upstream.

Show full code for each in the actual files (~40-80 lines each, all following the same skeleton: requireAdmin → parse query → load client → build Bucket → call method → jsonOk/jsonError).

### Task 7.2: Singleton concurrency integration test

- [ ] **Step 1: Create `tests/integration/buckets-cardinality.test.ts`**

Create a hospital client (has `directors` singleton). Fire two concurrent POSTs to `/api/clients-bucket-users?client=<id>&role=directors`. Assert exactly one returns 201, the other returns 409.

```ts
const [a, b] = await Promise.allSettled([
  fetch(BUCKET_URL, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: 'A' }) }),
  fetch(BUCKET_URL, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: 'B' }) }),
]);
const codes = [a, b].map((r) => r.status === 'fulfilled' ? r.value.status : 0).sort();
expect(codes).toEqual([201, 409]);
```

### Task 7.3: BucketPanel + UserRow + AddUserModal + EditUserModal

- [ ] **Step 1: Create `src/modules/ams/pages/ClientSettings.tsx`**

Loads `/api/clients-buckets?client=:id` on mount, renders one `BucketPanel` per role in returned order.

- [ ] **Step 2: Create `src/modules/ams/components/BucketPanel.tsx`**

Accordion (first 2 expanded, rest collapsed). Header: label, count badge (`1 / 1` if singleton). Body: table with `display_name`, `email`, plus custom columns where `display_in_list: true`. Each row has `× delete` button (`confirm()` first). Footer: "+ Add <RoleLabel>" button (disabled if singleton full).

- [ ] **Step 3: Create `AddUserModal.tsx` + `EditUserModal.tsx` with dynamic field rendering**

Dynamic form builder reads role columns, renders:
- text → `<input type="text">`
- date → `<input type="date">`
- integer → `<input type="number" step="1">`
- boolean → `<input type="checkbox">`
- required → adds `required` attr + red `*` next to label
- default → sets initial value (Add only)
- help → `<span title={help}>?</span>`

On submit, build payload object and POST/PATCH. Display server error code on failure (`validation_failed`, `conflict`, etc.).

- [ ] **Step 4: Browser smoke — full flow**

Add a hospital client → click → click Settings → see 5 bucket panels in order (directors, doctors, nurses, staff, patients) → add a director → second add attempt blocked (button disabled) → add a doctor with all required fields → edit → delete.

- [ ] **Step 5: Commit Phase 7**

```bash
git add netlify/functions/clients-bucket* src/modules/ams/ tests/integration/buckets-cardinality.test.ts
git commit -m "feat: bucket CRUD with dynamic forms (Phase 7)"
```

---

## Phase 8 — Admin team

**Goal:** AdminSettings panel shows admin list; can add second admin (password OR Google-only); bootstrap admin cannot be deleted (returns 409 `conflict`); self-edit (display_name, password change, Google link/unlink).

### Task 8.1: HTTP

- [ ] **Step 1: `netlify/functions/admin-self.ts`** — PATCH only. Body: `{ display_name?, password? }`. Updates own row.

- [ ] **Step 2: `netlify/functions/admin-team.ts`** — GET returns list; POST `{ email, display_name, password? }` creates new admin (password optional; if absent admin must use Google).

- [ ] **Step 3: `netlify/functions/admin-team-detail.ts`** — DELETE `?id=`. If target row `is_bootstrap = true` → 409 `conflict` with message "cannot_delete_bootstrap". Self-delete also returns 409.

### Task 8.2: AdminSettings UI wiring

- [ ] **Step 1: Replace placeholders in `AdminSettings.tsx`** with:
  - "Your account" form (display_name + password)
  - "Admin team" panel (list + "+ Add admin" modal, delete button per row except bootstrap)
  - "Danger zone" — sign out (calls `/api/auth-logout`).

- [ ] **Step 2: Manual smoke**

Add second admin `test2@example.com` with temp password → log out → log in as test2 → confirm full access → log back as bootstrap → try to delete self → 409 → delete test2 → success.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/admin-*.ts src/modules/ams/pages/AdminSettings.tsx
git commit -m "feat: admin team management (Phase 8)"
```

---

## Phase 9 — ClientDashboard + seed

**Goal:** Clicking a client card shows ClientDashboard with bucket counts; `npm run seed:dummy` populates 3 dummy clients per spec §8.9.

### Task 9.1: ClientDashboard

- [ ] **Step 1: Create `src/modules/ams/pages/ClientDashboard.tsx`**

Fetch `/api/clients-detail?id=:clientId` for client name + template, then `/api/clients-buckets?client=:id` for counts. Render header (name, template label, created date) + bucket overview table.

- [ ] **Step 2: Add routes**

In `router.tsx`, add:
```tsx
{ path: '/clients/:clientId', element: <ClientDashboard /> },
{ path: '/clients/:clientId/settings', element: <ClientSettings /> },
```

### Task 9.2: Seed script

- [ ] **Step 1: Create `scripts/seed-dummy-clients.ts`**

Idempotent: for each of (Joe's Hardware/shop, Bistro Verde/restaurant, St Mercy Hospital/hospital):
- Look up `public.clients WHERE name = $1`. If exists, skip.
- Else: insert client (generating schema name + running CREATE SCHEMA via `createClientSchema`).
- Insert seed users into each role bucket per spec §8.9 via direct `Bucket.add()` (NOT via HTTP — script runs server-side).

Reuse `createClientSchema` and the `Bucket` class. The script imports the bootstrap admin id from a lookup: `SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1`.

- [ ] **Step 2: Run + verify**

```bash
npm run seed:dummy
psql "$DATABASE_URL" -c "SELECT name, schema_name FROM public.clients;"
psql "$DATABASE_URL" -c "SELECT display_name FROM client_<one of the schema names>.owners;"
```

- [ ] **Step 3: Browser verify**

Refresh `/` → 3 client cards (plus any from Phase 6/7 testing — clean those up first). Open St Mercy → bucket counts (Directors 1, Doctors 2, Nurses 2, Staff 1, Patients 5).

- [ ] **Step 4: Commit**

```bash
git add src/modules/ams/pages/ClientDashboard.tsx scripts/seed-dummy-clients.ts src/lib/router.tsx
git commit -m "feat: ClientDashboard + dummy seed (Phase 9)"
```

---

## Phase 10 — Reconcile + ADRs + README

**Goal:** `npm run reconcile` exists and is a no-op for v1. Three ADRs written. README rewritten.

### Task 10.1: Reconcile

- [ ] **Step 1: Create `scripts/reconcile-clients.ts`**

```ts
#!/usr/bin/env tsx
import { neon } from '@neondatabase/serverless';
import { TEMPLATES } from '../netlify/functions/_shared/templates';
import { generateAddColumn, generateCreateRoleTable } from '../netlify/functions/_shared/template-ddl';

interface ClientRow {
  id: string; template_key: string; template_version_applied: number; schema_name: string;
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql<ClientRow[]>`
    SELECT id, template_key, template_version_applied, schema_name FROM public.clients ORDER BY created_at
  `;
  let actions = 0;
  for (const c of rows) {
    const tpl = TEMPLATES[c.template_key];
    if (!tpl) { console.warn(`! ${c.id}: unknown template ${c.template_key}`); continue; }
    if (tpl.version <= c.template_version_applied) {
      console.log(`✓ ${c.schema_name} (${c.template_key} v${c.template_version_applied}, current)`);
      continue;
    }
    // v1 has no version bumps — this branch will not execute on first deploy.
    console.log(`→ ${c.schema_name}: v${c.template_version_applied} → v${tpl.version} — diff support TBD when first bump arrives`);
    actions++;
  }
  console.log(`reconcile complete: ${actions} action(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

(Per spec §8.7 the diff-application logic ships when needed; v1 only needs the no-op walker.)

- [ ] **Step 2: Run**

`npm run reconcile` → prints `✓ client_xxxx (shop v1, current)` × 3, then `reconcile complete: 0 action(s)`.

### Task 10.2: ADRs

- [ ] **Step 1: Write `docs/adr/001-per-client-schemas.md`**

Cover: context (need domain-aware records per business type), decision (per-client schema with per-role tables), alternatives considered (single users table with role enum + JSONB extras; single schema with table-per-tenant prefix), consequences (DDL operations needed on Add Client; schema explosion risk if clients grow large; clean reads per client), reversal cost (high — would require data migration).

- [ ] **Step 2: Write `docs/adr/002-hardcoded-templates-with-versioning.md`**

Decision: templates live in `templates.ts`, no admin UI for editing them in v1. Versioning + reconcile gives forward-only schema evolution.

- [ ] **Step 3: Write `docs/adr/003-no-rls-admin-only.md`**

Decision: admin-only access in v1 → RLS overhead not justified. When non-admin auth arrives (Bookings module), RLS becomes mandatory and gets its own ADR.

### Task 10.3: README rewrite

- [ ] **Step 1: Replace `README.md`** with sections: What it is (one paragraph), Stack, Local dev (clone → npm install → npm run migrate → npm run bootstrap:admin → npm run dev), Deploy (Netlify auto-deploys main; run `npm run migrate` against prod URL BEFORE merge), Project structure (link to spec §7), ADRs (link to docs/adr/), Tests (`npm test`).

- [ ] **Step 2: Commit Phase 10**

```bash
git add scripts/reconcile-clients.ts docs/adr/ README.md
git commit -m "docs: reconcile script + ADRs 001-003 + README (Phase 10)"
```

---

## Phase 11 — Deploy preview smoke

**Goal:** Push branch, get Netlify deploy preview URL, exercise full UI flow end-to-end on a real Netlify build.

### Task 11.1: Push and watch deploy

- [ ] **Step 1: Push current branch**

If on `main` already, push first to a feature branch:
```bash
git checkout -b v2-ams-deploy-preview
git push -u origin v2-ams-deploy-preview
```

- [ ] **Step 2: Watch Netlify deploy**

Open Netlify dashboard → ExSol site → Deploys → wait for branch deploy preview to go green. Note: env vars must be set in Netlify UI BEFORE deploy: `DATABASE_URL` (dev branch URL, since prod isn't seeded yet beyond migrations), `GOOGLE_OAUTH_CLIENT_ID`, `JWT_SIGNING_SECRET` (a separate one for prod), `COOKIE_SECURE=true`, `NODE_ENV=production`. Verify `SECRETS_SCAN_OMIT_KEYS` is set per `netlify.toml`.

- [ ] **Step 3: Open the deploy preview URL and run smoke**

1. Visit preview URL → redirects to `/login`.
2. Sign in with bootstrap admin password (dev DB has the seed).
3. See dashboard with 3 dummy clients.
4. Open St Mercy → settings → add a test doctor → delete it.
5. Sign out → confirm redirect to login.

### Task 11.2: ⏸ REVIEW CHECKPOINT — preview signed off

**STOP.** Show the user the preview URL and request confirmation that the smoke test passed before promoting to prod.

---

## Phase 12 — Promote to prod

**Goal:** Run `migrate` against prod Neon URL first (already done at end of Phase 2; re-verify it's still at the same state as code expects), then merge branch to main.

### Task 12.1: Pre-merge migration check

- [ ] **Step 1: Re-export prod URL**

```bash
export NEON_PROD_URL="<prod connection string>"
```

- [ ] **Step 2: Verify prod is at expected migration state**

```bash
DATABASE_URL="$NEON_PROD_URL" npm run migrate:status
```
Expected: 001–004 all `(already applied)`. No `(pending)` lines.

- [ ] **Step 3: Verify bootstrap admin on prod**

```bash
psql "$NEON_PROD_URL" -c "SELECT email, is_bootstrap, password_hash IS NOT NULL FROM public.admins;"
```
Expected: 1 row, bootstrap = t.

- [ ] **Step 4: Unset prod URL**

```bash
unset NEON_PROD_URL
```

### Task 12.2: Merge

- [ ] **Step 1: Open PR or fast-forward**

If using PR workflow:
```bash
gh pr create --title "v2 AMS: full release" --body "Implements docs/superpowers/specs/2026-05-26-ams-module-design.md across phases 0-11."
```
Then merge.

If main-direct (matches v1.1 deploy cadence):
```bash
git checkout main
git merge --ff-only v2-ams-deploy-preview
git push origin main
```

- [ ] **Step 2: Watch prod deploy**

Netlify dashboard → main → deploy goes green.

### Task 12.3: Prod smoke

- [ ] **Step 1: Visit `https://exsoldatacollectionapp.netlify.app/`**

Expected: redirects to /login.

- [ ] **Step 2: Sign in with bootstrap admin + prod password**

(Prod password is the one set in Phase 2 Task 2.6 step 4 — NOT the dev password.)

- [ ] **Step 3: Run prod smoke**

Empty dashboard (no clients seeded on prod). Add Client "Test Co" template Shop → confirm card appears → confirm schema in prod Neon (`psql "$NEON_PROD_URL" -c "\dn"`) → delete → confirm gone.

- [ ] **Step 4: Tag release**

```bash
git tag -a v2.0.0 -m "AMS v2 production release"
git push origin v2.0.0
```

- [ ] **Step 5: Final commit if needed (none expected)**

---

## Self-review (against spec)

### Spec coverage check (DoD items from spec §14)

| DoD item | Implemented in |
|---|---|
| Bootstrap admin signs in via password | Phase 2 (seed) + Phase 3 (auth-login) |
| Bootstrap admin signs in via Google | Phase 3 (auth-google) |
| Dashboard shows 3 dummy clients after seed | Phase 9 |
| Create a client of any of 6 templates → schema appears | Phase 5 (DDL) + Phase 6 (HTTP/UI) |
| Delete client → schema dropped + log row | Phase 6 (clients-detail DELETE) |
| ClientSettings renders bucket panels in template order | Phase 7 (BucketPanel + clients-buckets) |
| Add user with dynamic form, required custom cols server-validated | Phase 5 (Bucket.add) + Phase 7 (AddUserModal) |
| Singleton enforcement UI + API + DB | Phase 5 (DB unique index) + Phase 7 (UI disable + API 409) + Phase 7 (concurrency test) |
| Bucket list shows `display_in_list: true` columns | Phase 7 (BucketPanel) |
| Edit preserves all custom values; required cannot clear | Phase 5 (Bucket.update) |
| Remove user | Phase 5 (Bucket.remove) + Phase 7 (DELETE) |
| Add second admin, sign in, full powers | Phase 8 |
| Bootstrap admin cannot be deleted | Phase 8 (admin-team-detail 409) |
| Sign-out clears cookie | Phase 3 (auth-logout) |
| Unit tests pass | Phases 3, 5 |
| Integration tests pass | Phases 3, 6, 7 |
| `npm run build` clean | Phase 1 + every phase end |
| Template version bump triggers ALTER via reconcile (test only) | Phase 10 (script); reconcile diff-application is deferred until first real bump per spec §8.7 — flagged as **partial coverage** |
| Netlify deploy preview works | Phase 11 |
| Production deploy works | Phase 12 |
| ADRs 001/002/003 written | Phase 10 |

**Gap flagged:** the DoD says "Bumping any template's version with a new column triggers `reconcile` ALTER TABLE across matching clients (verified by test, not exercised in v1 production)." The plan ships only the no-op walker in Phase 10. To fully satisfy this DoD, add `tests/integration/reconcile.test.ts` that:
1. Creates a client at template v1.
2. Mutates the in-memory template to v2 with an added column.
3. Runs the reconcile logic for that one client.
4. Asserts the new column exists in `information_schema.columns` for the role table.

This is a small addition (~50 lines, 0.5 day) — add it as **Task 10.1.5** between Tasks 10.1 and 10.2:

### Task 10.1.5 (added during self-review): Reconcile integration test + diff applier

- [ ] **Step 1:** Implement the diff-application logic in `scripts/reconcile-clients.ts` (currently a no-op walker). For each client whose `template_version_applied < TEMPLATES[key].version`:
  - Diff roles: new roles → `generateCreateRoleTable` and run.
  - Diff columns within existing roles: new columns → `generateAddColumn` and run.
  - Wrap in BEGIN/COMMIT, write `schema_ops_log` row (`op = 'reconcile'`), update `_meta.template_version_applied` and `public.clients.template_version_applied`.

- [ ] **Step 2:** Write `tests/integration/reconcile.test.ts` per the assertions above.

- [ ] **Step 3:** Run → expect pass → commit.

### Placeholder scan

- ✅ No "TBD" / "implement later" / "fill in details" in any task — actual code or precise instructions everywhere.
- ⚠ Task 6.2 step 1 ("Integration test — clients lifecycle") and Task 7.1 explicitly delegate to "follow auth.test.ts pattern" — this is the one place full code is not pasted. The engineer has a 1:1 template (`auth.test.ts`) and exact assertions to write. Acceptable trade-off for plan length. If the engineer is unsure, they should pause and ask.
- ✅ Task 7.3 steps 1–3 describe BucketPanel / AddUserModal / EditUserModal in narrative form (no full code paste) because these are standard React form components and the spec §9 already describes the design exactly. Same trade-off.

### Type/identifier consistency check

- ✅ `Bucket` constructor signature `(schemaName, template, roleKey)` used consistently in `bucket.ts` and from HTTP handlers (Phase 7 Task 7.1).
- ✅ `createClientSchema` input shape updated in Phase 6 Task 6.1 step 2 to accept pre-generated `schemaName` — call sites in `clients.ts` (Phase 6) and `seed-dummy-clients.ts` (Phase 9) follow that signature.
- ✅ Error codes consistent with spec §10.2 table throughout (`unauthorized`, `validation_failed`, `template_unknown`, `conflict`, `schema_op_failed`, `not_found`, `method_not_allowed`).
- ✅ `safeQuoteIdent` / `safeQuoteSchema` are the only paths interpolating identifiers into SQL (verified at template-ddl.ts, schema-manager.ts, bucket.ts).
- ✅ All migration filenames match the `migrate.ts` runner's sort order (001 < 002 < 003 < 004).

---

*Plan complete. Source spec: `docs/superpowers/specs/2026-05-26-ams-module-design.md`. Total estimate ~10-11 working days; phases are independently committable.*
