# CRM Module v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a CRM module v1 — a derived read-model unifying customers across POS `sales` and Booking, with a vendor list/search + detail-with-timeline + notes CRUD UI at `/c/:slug/crm`.

**Architecture:** Two new tables (`crm_customers`, `crm_notes`, migration 055). An idempotent `POST /api/crm/refresh` materializes `crm_customers` from `user_nodes` customers + paid `sales`, deduped by a computed `dedupe_key` (reusing Booking's `dedupe.ts` in a pure `merge.ts`). GET endpoints are pure reads; the detail timeline is queried live. No edits to POS/Booking handlers. Registry + authz + FE mirror the Booking module.

**Tech Stack:** React 18 + Vite SPA, Netlify Functions v2 (flat `.ts`), Neon Postgres (HTTP driver), vitest, tsx migrations.

**Spec:** `docs/superpowers/specs/2026-07-03-crm-module-design.md`.

## Global Constraints

- Worktree `../ExSol-Booking-WT`, branch `feat/crm-iso`. **Local commits only — never push/merge.** Run `git branch --show-current` before the first commit (must say `feat/crm-iso`).
- Migration number is **055** exactly. One SQL statement per line; comments on their own line, never after a `;`. No `$$` (keeps the multi-statement splitter working). Lowercase idempotent DDL style (mirror `db/migrations/050_brand_columns.sql`).
- Permission keys are **bucket×verb only**: `crm.customers.{view,create,edit,delete}`. Never action-namespaced.
- Authz: `_crm-authz.ts` enable-gate THEN `level_number === 1` Owner bypass. Same bypass in `Sidebar.tsx` AND `CrmRouteMounts.tsx`.
- Netlify functions: flat top-level files only. Distinct `config.path` per file (method array only where one path is shared).
- Tests share one persistent dev DB (no teardown): randomize unique-constrained literals (phones/emails/slugs). CRM touches no Blobs → no `getStore()` mock. Run the FULL vitest suite before declaring done.
- **Done = `npm run typecheck` AND the full vitest suite, both green** (CLAUDE.md).
- Reuse `normalizePhone` / `dedupeKey` from `src/modules/booking/lib/dedupe.ts` — do NOT reimplement phone/email normalization.

---

### Task 1: Migration 055 — `crm_customers` + `crm_notes`

**Files:**
- Create: `db/migrations/055_crm.sql`

**Interfaces:**
- Produces: tables `public.crm_customers` (unique `(client_id, dedupe_key)`) and `public.crm_notes` (FK → `crm_customers`).

- [ ] **Step 1: Confirm the id-default convention.** Run: `grep -n "id uuid primary key" db/migrations/050_brand_columns.sql db/migrations/048_bookings.sql` (or `grep -rn "gen_random_uuid" db/migrations | head`). Confirm the codebase uses `default gen_random_uuid()` for UUID PKs. Use whatever the existing migrations use.

- [ ] **Step 2: Write the migration.** Create `db/migrations/055_crm.sql`:

```sql
-- Migration 055: CRM read-model (crm_customers + crm_notes)
-- Spec: docs/superpowers/specs/2026-07-03-crm-module-design.md
-- Reserved number 055; 051-054 reserved for sibling chats and not yet present.
-- The migrate runner applies files individually (scripts/migrate.ts), so the gap is fine.
-- crm_customers is a derived read-model; dedupe_key = normalizePhone|lower(email).
create table if not exists public.crm_customers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  display_name text not null,
  phone text,
  email text,
  dedupe_key text not null,
  source text not null check (source in ('pos','storefront','booking')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_customers_client_dedupe_idx on public.crm_customers (client_id, dedupe_key);
create index if not exists crm_customers_client_lastseen_idx on public.crm_customers (client_id, last_seen desc);
create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  customer_id uuid not null references public.crm_customers(id) on delete cascade,
  body text not null,
  created_by_user_node uuid references public.user_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_notes_customer_idx on public.crm_notes (customer_id);
```

- [ ] **Step 3: Apply to dev.** Run: `npm run migrate`
Expected: `→ applying 055_crm (N statements)` then `✓ 055_crm`. (If it errors on a trailing-comment-after-`;`, move that comment to its own line.)

- [ ] **Step 4: Verify schema.** Run:
`npx tsx --env-file=.env -e "import{neon}from'@neondatabase/serverless';const s=neon(process.env.DATABASE_URL);s\`select count(*) from public.crm_customers\`.then(r=>console.log('crm_customers ok',r)).then(()=>s\`select count(*) from public.crm_notes\`).then(r=>console.log('crm_notes ok',r))"`
Expected: `crm_customers ok` and `crm_notes ok` both print (0 rows).

- [ ] **Step 5: Commit.**

```bash
git add db/migrations/055_crm.sql
git commit -m "feat(crm): migration 055 — crm_customers + crm_notes read-model tables"
```

---

### Task 2: Registry — ModuleManifest + ProductManifest

**Files:**
- Modify: `src/modules/registry/types.ts` (add `'crm'` to the `ModuleKey` union if it is a hardcoded union)
- Create: `src/modules/registry/manifests/crm.ts`
- Modify: `src/modules/registry/modules.ts`
- Create: `src/modules/registry/products-list/crm.ts`
- Modify: `src/modules/registry/products.ts`
- Test: `src/modules/registry/__tests__/crm-registry.test.ts`

**Interfaces:**
- Produces: `crmManifest` (key `'crm'`, buckets `['customers']`), `crmProduct` (key `'crm'`, module `crm` side `vendor`); `getModule('crm')`, `getProduct('crm')`, and `isValidPermissionKey('crm.customers.view', ['crm'])` all resolve truthy.

- [ ] **Step 1: Write the failing test.** Create `src/modules/registry/__tests__/crm-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getModule } from '../modules';
import { getProduct } from '../products';
import { isValidPermissionKey } from '../../../../netlify/functions/_shared/permission-keys';

describe('crm registry', () => {
  it('registers the crm module', () => {
    const m = getModule('crm');
    expect(m?.data_buckets).toContain('customers');
    expect(m?.verbs).toEqual(expect.arrayContaining(['view', 'create', 'edit', 'delete']));
    expect(m?.vendor_side).toBe(true);
  });
  it('registers the crm product referencing the module', () => {
    const p = getProduct('crm');
    expect(p?.modules.map((r) => r.module)).toContain('crm');
  });
  it('validates crm bucket×verb keys when the crm product is enabled', () => {
    expect(isValidPermissionKey('crm.customers.view', ['crm'])).toBe(true);
    expect(isValidPermissionKey('crm.customers.delete', ['crm'])).toBe(true);
    expect(isValidPermissionKey('crm.customers.view', [])).toBe(false);
    expect(isValidPermissionKey('crm.products.view', ['crm'])).toBe(false); // crm has no 'products' bucket
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run src/modules/registry/__tests__/crm-registry.test.ts`
Expected: FAIL (`getModule('crm')` returns undefined / type error on `'crm'`).

- [ ] **Step 3: Add `'crm'` to `ModuleKey`.** Open `src/modules/registry/types.ts`. If `ModuleKey` is a hardcoded union (e.g. `export type ModuleKey = 'booking' | 'payments' | 'products' | 'pos' | 'analytics';`), add `| 'crm'`. If `ModuleKey` is derived from the registry via `keyof typeof moduleRegistry`, no edit is needed here.

- [ ] **Step 4: Create the manifest.** `src/modules/registry/manifests/crm.ts`:

```ts
import type { ModuleManifest } from '../types';

export const crmManifest: ModuleManifest = {
  key: 'crm',
  label: 'CRM',
  data_buckets: ['customers'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
};
```

- [ ] **Step 5: Register the module.** In `src/modules/registry/modules.ts`, add `import { crmManifest } from './manifests/crm';` beside the other manifest imports, and add `crm: crmManifest,` inside the `moduleRegistry` object.

- [ ] **Step 6: Create the product.** `src/modules/registry/products-list/crm.ts`:

```ts
import type { ProductManifest } from '../types';

export const crmProduct: ProductManifest = {
  key: 'crm',
  label: 'Customer Relationship Management',
  modules: [{ module: 'crm', side: 'vendor' }],
};
```

- [ ] **Step 7: Register the product.** In `src/modules/registry/products.ts`, add `import { crmProduct } from './products-list/crm';` and add `'crm': crmProduct,` inside `productRegistry`.

- [ ] **Step 8: Run to verify it passes.** Run: `npx vitest run src/modules/registry/__tests__/crm-registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Typecheck + commit.**

```bash
npm run typecheck
git add src/modules/registry
git commit -m "feat(crm): register crm ModuleManifest + ProductManifest"
```

---

### Task 3: Pure merge/dedupe library

**Files:**
- Create: `src/modules/crm/lib/merge.ts`
- Test: `src/modules/crm/lib/__tests__/merge.test.ts`

**Interfaces:**
- Consumes: `normalizePhone`, `dedupeKey` from `src/modules/booking/lib/dedupe.ts`.
- Produces: `mergeCustomers(rows: RawCustomerRow[]): MergedCustomer[]`, plus exported types `RawCustomerRow` and `MergedCustomer`.

- [ ] **Step 1: Confirm the `normalizePhone` signature.** Run: `sed -n '1,40p' src/modules/booking/lib/dedupe.ts`. Confirm `normalizePhone(raw: string, country?: string): string | null` (bare 10-digit → `+91…`, invalid → null). This is the ONLY dedupe.ts function `merge.ts` reuses — the CRM key is phone-canonical (see Step 4), so `dedupeKey` is not used.

- [ ] **Step 2: Write the failing test.** Create `src/modules/crm/lib/__tests__/merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeCustomers, type RawCustomerRow } from '../merge';

const row = (o: Partial<RawCustomerRow>): RawCustomerRow => ({
  display_name: 'X', phone: null, email: null, source: 'pos',
  first_seen: '2026-01-01T00:00:00.000Z', last_seen: '2026-01-01T00:00:00.000Z', ...o,
});

describe('mergeCustomers', () => {
  it('dedupes the same person seen via POS and booking into one row', () => {
    const out = mergeCustomers([
      row({ display_name: 'Aisha', phone: '9876543210', email: 'a@x.com', source: 'pos', first_seen: '2026-02-01T00:00:00.000Z', last_seen: '2026-02-01T00:00:00.000Z' }),
      row({ display_name: 'Aisha Khan', phone: '+919876543210', email: 'A@X.com', source: 'booking', first_seen: '2026-01-15T00:00:00.000Z', last_seen: '2026-03-01T00:00:00.000Z' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].first_seen).toBe('2026-01-15T00:00:00.000Z'); // earliest
    expect(out[0].last_seen).toBe('2026-03-01T00:00:00.000Z');  // latest
    expect(out[0].source).toBe('booking');                       // source of the earliest sighting
  });

  it('keeps distinct people separate', () => {
    const out = mergeCustomers([
      row({ phone: '9876543210', email: 'a@x.com' }),
      row({ phone: '9999999999', email: 'b@x.com' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('skips rows with neither phone nor email', () => {
    const out = mergeCustomers([row({ phone: null, email: null, display_name: 'Ghost' })]);
    expect(out).toHaveLength(0);
  });

  it('prefers a non-empty display name and back-fills missing contact fields', () => {
    const out = mergeCustomers([
      row({ display_name: '', phone: '9876543210', email: null, source: 'pos' }),
      row({ display_name: 'Real Name', phone: '9876543210', email: 'r@x.com', source: 'booking', last_seen: '2026-05-01T00:00:00.000Z' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].display_name).toBe('Real Name');
    expect(out[0].email).toBe('r@x.com');
  });

  it('emits a stable, order-independent dedupe_key for the same phone (DB upsert relies on this)', () => {
    const a = row({ phone: '9876543210', email: 'a@x.com', first_seen: '2026-02-01T00:00:00.000Z', last_seen: '2026-02-01T00:00:00.000Z' });
    const b = row({ phone: '+919876543210', email: 'b@x.com', first_seen: '2026-01-01T00:00:00.000Z', last_seen: '2026-03-01T00:00:00.000Z' });
    const forward = mergeCustomers([a, b]);
    const reverse = mergeCustomers([b, a]);
    expect(forward).toHaveLength(1);
    expect(reverse).toHaveLength(1);
    expect(forward[0].dedupe_key).toBe(reverse[0].dedupe_key); // key does not depend on row order or email
  });

  it('falls back to email as the key when there is no phone, and merges two email-only rows', () => {
    const out = mergeCustomers([
      row({ phone: null, email: 'only@x.com', display_name: 'A' }),
      row({ phone: null, email: 'ONLY@x.com', display_name: 'B', last_seen: '2026-06-01T00:00:00.000Z' }),
    ]);
    expect(out).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `npx vitest run src/modules/crm/lib/__tests__/merge.test.ts`
Expected: FAIL (`../merge` not found).

- [ ] **Step 4: Implement `merge.ts`.** Create `src/modules/crm/lib/merge.ts`. Key each person by a SINGLE canonical identity — **phone when present (primary), else email (tiebreaker)** — NOT a composite `phone|email`. A composite key is unstable: the emitted `dedupe_key` would depend on which row (which email) is seen first, and since the refresh reads rows in Postgres's unordered `GROUP BY` order, the same person could get different keys across refreshes → the `UNIQUE(client_id, dedupe_key)` upsert would insert a duplicate customer and orphan their notes. A phone-canonical key is deterministic per person (everyone has a phone: `sales.customer_phone` is NOT NULL, booking collects phone), so it's stable across refreshes AND merges same-phone-different-email into one row. Reuse `normalizePhone` (so phone canonicalization matches Booking exactly); do NOT use `dedupeKey` for the emitted key.

```ts
import { normalizePhone } from '../../booking/lib/dedupe';

export type CrmSource = 'pos' | 'storefront' | 'booking';

export interface RawCustomerRow {
  display_name: string | null;
  phone: string | null;
  email: string | null;
  source: CrmSource;
  first_seen: string; // ISO timestamp
  last_seen: string;
}

export interface MergedCustomer {
  display_name: string;
  phone: string | null;
  email: string | null;
  dedupe_key: string;
  source: CrmSource;
  first_seen: string;
  last_seen: string;
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * Canonical identity key: phone when present (primary person-key), else email
 * (tiebreaker). Deterministic per person → the emitted dedupe_key is stable
 * across refreshes, which the DB upsert (ON CONFLICT client_id, dedupe_key)
 * relies on for stable crm_customers ids and note FKs.
 */
function identityKey(phone: string | null, email: string | null): string | null {
  if (phone) return `phone:${phone}`;
  if (email) return `email:${email}`;
  return null;
}

export function mergeCustomers(rows: RawCustomerRow[]): MergedCustomer[] {
  const byKey = new Map<string, MergedCustomer>();
  for (const r of rows) {
    const phone = normalizePhone(r.phone ?? '');
    const email = r.email ? r.email.trim().toLowerCase() : null;
    const key = identityKey(phone, email);
    if (!key) continue; // no usable identity (no phone AND no email)
    const name = (r.display_name ?? '').trim();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        display_name: name || 'Unknown',
        phone: phone ?? null,
        email,
        dedupe_key: key,
        source: r.source,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
      });
      continue;
    }
    if (ms(r.first_seen) < ms(existing.first_seen)) {
      existing.first_seen = r.first_seen;
      existing.source = r.source; // origin follows the earliest sighting
    }
    if (ms(r.last_seen) > ms(existing.last_seen)) existing.last_seen = r.last_seen;
    if ((!existing.display_name || existing.display_name === 'Unknown') && name) existing.display_name = name;
    if (!existing.phone && phone) existing.phone = phone;
    if (!existing.email && email) existing.email = email;
  }
  return [...byKey.values()];
}
```

- [ ] **Step 5: Run to verify it passes.** Run: `npx vitest run src/modules/crm/lib/__tests__/merge.test.ts`
Expected: PASS (4 tests). If the source/first_seen assertion fails, check that `dedupeKey('|')` empty-detection matches your dedupe.ts output.

- [ ] **Step 6: Commit.**

```bash
git add src/modules/crm/lib
git commit -m "feat(crm): pure mergeCustomers dedupe library (reuses booking dedupe.ts)"
```

---

### Task 4: CRM test helpers + `_crm-authz.ts` + `crm-refresh.ts`

**Files:**
- Create: `tests/crm/_helpers.ts`
- Create: `netlify/functions/_crm-authz.ts`
- Create: `src/modules/crm/lib/refresh.ts`
- Create: `netlify/functions/crm-refresh.ts`
- Test: `tests/crm/refresh.test.ts`

**Interfaces:**
- Consumes: `mergeCustomers` (Task 3); `requireBucketUser`, `UnauthorizedError` from `_shared/permissions`; `db` from `_shared/db`; `jsonError` from `_shared/http`; `getProduct` from registry.
- Produces: `requireCrm(req, required): Promise<{ok:true;ctx:CrmAuthCtx}|{ok:false;res:Response}>` with `CrmAuthCtx = { userNodeId; clientId; perms }`; `refreshCustomers(sql, clientId): Promise<number>` (shared by the endpoint AND the seed script — Task 12); endpoint `POST /api/crm/refresh` → `{ synced: number }`. Test helpers: `seedClientWithCrm()`, `enableCrm(clientId)`, `grantCrmPerms(clientId, level, keys)`, `seedCustomerRole(clientId)`, `seedCustomerNode(...)`, `crmRequest(ctx, method, path, body?)`, `demoteToL2(ctx)`, `sqlClient()`.

- [ ] **Step 1: Create the test helpers.** Create `tests/crm/_helpers.ts` (mirrors `tests/booking/_helpers.ts`; only the enable-product key and perm strings differ):

```ts
import { neon } from '@neondatabase/serverless';
import { mintBucketUserSession } from '../../netlify/functions/_shared/session';
import { hashPassword } from '../../netlify/functions/_shared/argon';

const sql = neon(process.env.DATABASE_URL!);
export function sqlClient() { return sql; }

let cachedAdminId: string | null = null;
async function ensureBootstrapAdmin(): Promise<string> {
  if (cachedAdminId) return cachedAdminId;
  const found = (await sql`SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1`) as Array<{ id: string }>;
  if (found[0]) { cachedAdminId = found[0].id; return cachedAdminId; }
  const hash = await hashPassword('crm-test-admin-pw');
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES ('crm-test-admin@exsol.test', ${hash}, 'CRM Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash} RETURNING id
  `) as Array<{ id: string }>;
  cachedAdminId = rows[0]!.id;
  return cachedAdminId;
}

export interface CrmTestCtx { clientId: string; ownerNodeId: string; adminId: string; slug: string; cookie: string; }

export async function seedClientWithCrm(): Promise<CrmTestCtx> {
  const adminId = await ensureBootstrapAdmin();
  const slug = `crm-test-${Math.random().toString(36).slice(2, 10)}`;
  const c = (await sql`INSERT INTO public.clients (slug, name, created_by) VALUES (${slug}, 'CRM Test', ${adminId}) RETURNING id`) as Array<{ id: string }>;
  const clientId = c[0]!.id;
  const role = (await sql`INSERT INTO public.client_roles (client_id, key, label, color) VALUES (${clientId}, 'owner', 'Owner', '#3b82f6') RETURNING id`) as Array<{ id: string }>;
  await sql`INSERT INTO public.client_levels (client_id, level_number, label, permissions) VALUES (${clientId}, 1, 'Primary', '{}'::jsonb)`;
  const email = `crm-owner-${slug}@exsol.test`;
  const node = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientId}, NULL, 1, ${role[0]!.id}, 'CRM Test Owner', ${email}, ${adminId}) RETURNING id`) as Array<{ id: string }>;
  const ownerNodeId = node[0]!.id;
  const hash = await hashPassword('crm-owner-pw');
  await sql`INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
            VALUES (${clientId}, ${ownerNodeId}, ${email}, ${hash}, false, ${adminId})`;
  const token = await mintBucketUserSession({ sub: ownerNodeId, email, client_id: clientId });
  return { clientId, ownerNodeId, adminId, slug, cookie: `bu_session=${token}` };
}

export async function enableCrm(clientId: string): Promise<void> {
  const adminId = await ensureBootstrapAdmin();
  await sql`INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
            VALUES (${clientId}, 'crm', ${adminId}) ON CONFLICT (client_id, product_key) DO NOTHING`;
}

export async function grantCrmPerms(clientId: string, levelNumber: number, keys: readonly string[]): Promise<void> {
  const perms: Record<string, true> = Object.fromEntries(keys.map((k) => [k, true]));
  await sql`UPDATE public.client_levels SET permissions = ${JSON.stringify(perms)}::jsonb WHERE client_id = ${clientId} AND level_number = ${levelNumber}`;
}

export async function seedCustomerRole(clientId: string): Promise<string> {
  const r = (await sql`INSERT INTO public.client_roles (client_id, key, label, color, bucket_family)
    VALUES (${clientId}, 'customer', 'Customer', '#10b981', 'customers') RETURNING id`) as Array<{ id: string }>;
  return r[0]!.id;
}

/** Insert a customer user_node directly (simulates a booking-created customer). */
export async function seedCustomerNode(clientId: string, roleId: string, name: string, phone: string | null, email: string | null): Promise<string> {
  const r = (await sql`INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, phone)
    VALUES (${clientId}, NULL, NULL, ${roleId}, ${name}, ${email}, ${phone}) RETURNING id`) as Array<{ id: string }>;
  return r[0]!.id;
}

export function crmRequest(ctx: CrmTestCtx, method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method, headers: { cookie: ctx.cookie, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function demoteToL2(ctx: CrmTestCtx): Promise<CrmTestCtx> {
  await sql`INSERT INTO public.client_levels (client_id, level_number, label, permissions)
            VALUES (${ctx.clientId}::uuid, 2, 'L2', '{}'::jsonb) ON CONFLICT DO NOTHING`;
  const role = (await sql`SELECT id FROM public.client_roles WHERE client_id = ${ctx.clientId} LIMIT 1`) as Array<{ id: string }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `crm-l2-${suffix}@exsol.test`;
  const node = (await sql`INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${ctx.clientId}, ${ctx.ownerNodeId}, 2, ${role[0]!.id}, 'L2 Sub', ${email}, ${ctx.adminId}) RETURNING id`) as Array<{ id: string }>;
  const subNodeId = node[0]!.id;
  const hash = await hashPassword('crm-l2-pw');
  await sql`INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
            VALUES (${ctx.clientId}, ${subNodeId}, ${email}, ${hash}, false, ${ctx.adminId})`;
  const token = await mintBucketUserSession({ sub: subNodeId, email, client_id: ctx.clientId });
  return { ...ctx, ownerNodeId: subNodeId, cookie: `bu_session=${token}` };
}
```

- [ ] **Step 2: Create `_crm-authz.ts`.** Clone `netlify/functions/_booking-authz.ts` exactly, swapping module/error/perm identifiers. Create `netlify/functions/_crm-authz.ts`:

```ts
import { jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { db } from './_shared/db';
import { getProduct } from '../../src/modules/registry/products';

export interface CrmAuthCtx {
  userNodeId: string;
  clientId: string;
  perms: ReadonlySet<string>;
}

const ALL_CRM_PERMS = [
  'crm.customers.view', 'crm.customers.create', 'crm.customers.edit', 'crm.customers.delete',
] as const;

export async function requireCrm(
  req: Request,
  required: readonly string[],
): Promise<{ ok: true; ctx: CrmAuthCtx } | { ok: false; res: Response }> {
  const sql = db();
  let credential: { user_node_id: string };
  let claims: { client_id: string };
  try {
    const r = await requireBucketUser(req);
    credential = r.credential;
    claims = r.claims;
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, res: jsonError(401, 'unauthorized') };
    throw e;
  }

  const permRows = (await sql`
    SELECT cl.level_number, cl.permissions
    FROM public.user_nodes un
    LEFT JOIN public.client_levels cl ON cl.client_id = un.client_id AND cl.level_number = un.level_number
    WHERE un.id = ${credential.user_node_id}::uuid
  `) as Array<{ level_number: number | null; permissions: Record<string, boolean> | null }>;
  const levelNumber = permRows[0]?.level_number ?? 1;
  const perms = new Set<string>();
  for (const [k, v] of Object.entries(permRows[0]?.permissions ?? {})) if (v) perms.add(k);

  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products WHERE client_id = ${claims.client_id}::uuid
  `) as Array<{ product_key: string }>;
  const modules = new Set<string>();
  for (const e of enabled) {
    const product = getProduct(e.product_key);
    if (product) for (const ref of product.modules) modules.add(ref.module);
  }
  if (!modules.has('crm')) return { ok: false, res: jsonError(412, 'crm_module_not_enabled') };

  if (levelNumber === 1) {
    return { ok: true, ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms: new Set(ALL_CRM_PERMS) } };
  }
  for (const r of required) {
    if (!perms.has(r)) return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
  }
  return { ok: true, ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms } };
}
```

Note: verify the level/permission resolution query against `_booking-authz.ts:44-58` and copy its exact JOIN/columns if they differ (the shape above matches the explorer's report). Confirm `jsonError` signature `(status, code, details?)`.

- [ ] **Step 3: Write the failing test.** Create `tests/crm/refresh.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/crm-refresh';
import { seedClientWithCrm, enableCrm, seedCustomerRole, seedCustomerNode, crmRequest, demoteToL2, grantCrmPerms, sqlClient } from './_helpers';

const sql = sqlClient();
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('POST /api/crm/refresh', () => {
  it('401 when unauthenticated', async () => {
    const res = await handler(new Request('http://localhost/api/crm/refresh', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('412 when the crm module is not enabled', async () => {
    const ctx = await seedClientWithCrm();
    const res = await handler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
    expect(res.status).toBe(412);
  });

  it('403 for an L2 without crm.customers.view', async () => {
    const owner = await seedClientWithCrm();
    await enableCrm(owner.clientId);
    const l2 = await demoteToL2(owner);
    const res = await handler(crmRequest(l2, 'POST', '/api/crm/refresh'));
    expect(res.status).toBe(403);
  });

  it('L1 owner bypass: materializes + dedupes POS sale and booking-customer into one row', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const roleId = await seedCustomerRole(ctx.clientId);
    const phone = `98${uniq().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`;
    const email = `dup-${uniq()}@x.com`;
    // Booking-created customer node:
    await seedCustomerNode(ctx.clientId, roleId, 'Aisha Khan', phone, email);
    // A paid POS sale for the SAME identity:
    await sql`INSERT INTO public.sales (bucket_id, order_no, status, channel, source, customer_name, customer_phone, customer_email, subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node)
              VALUES (${ctx.clientId}, ${Math.floor(Math.random()*1e9)}, 'paid', 'instore', 'pos', 'Aisha', ${phone}, ${email}, 1000, 0, 0, 1000, ${ctx.ownerNodeId})`;

    const res = await handler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
    expect(res.status).toBe(200);
    const rows = (await sql`SELECT * FROM public.crm_customers WHERE client_id = ${ctx.clientId}`) as any[];
    expect(rows).toHaveLength(1); // deduped

    // Idempotent: a second refresh does not duplicate.
    await handler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
    const again = (await sql`SELECT * FROM public.crm_customers WHERE client_id = ${ctx.clientId}`) as any[];
    expect(again).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run to verify it fails.** Run: `npx vitest run tests/crm/refresh.test.ts`
Expected: FAIL (`crm-refresh` module not found).

- [ ] **Step 5a: Implement the shared refresh helper.** Create `src/modules/crm/lib/refresh.ts` (imported by BOTH the endpoint and the Task 12 seed script — do not inline this SQL in either):

```ts
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { mergeCustomers, type RawCustomerRow } from './merge';

type Sql = NeonQueryFunction<false, false>;

/**
 * Materialize crm_customers for one client from user_nodes(customers) + paid sales,
 * deduped by mergeCustomers. Idempotent (ON CONFLICT upsert). Returns rows upserted.
 * Accepts any Neon sql client (db() in functions, neon(url) in scripts).
 */
export async function refreshCustomers(sql: Sql, clientId: string): Promise<number> {
  const bookingRows = (await sql`
    SELECT un.display_name AS display_name, un.phone AS phone, un.email::text AS email,
           'booking'::text AS source,
           COALESCE(min(b.created_at), un.created_at) AS first_seen,
           COALESCE(max(b.created_at), un.created_at) AS last_seen
    FROM public.user_nodes un
    JOIN public.client_roles cr ON cr.id = un.role_id AND cr.bucket_family = 'customers'
    LEFT JOIN public.bookings b ON b.user_node_id = un.id
    WHERE un.client_id = ${clientId}::uuid
    GROUP BY un.id, un.display_name, un.phone, un.email, un.created_at
  `) as RawCustomerRow[];

  const saleRows = (await sql`
    SELECT s.customer_name AS display_name, s.customer_phone AS phone, s.customer_email AS email,
           CASE WHEN s.source = 'storefront' THEN 'storefront' ELSE 'pos' END AS source,
           min(s.created_at) AS first_seen, max(s.created_at) AS last_seen
    FROM public.sales s
    WHERE s.bucket_id = ${clientId}::uuid AND s.status IN ('paid', 'fulfilled')
    GROUP BY s.customer_name, s.customer_phone, s.customer_email,
             (CASE WHEN s.source = 'storefront' THEN 'storefront' ELSE 'pos' END)
  `) as RawCustomerRow[];

  const merged = mergeCustomers([...bookingRows, ...saleRows]);
  for (const c of merged) {
    await sql`
      INSERT INTO public.crm_customers
        (client_id, display_name, phone, email, dedupe_key, source, first_seen, last_seen)
      VALUES (${clientId}::uuid, ${c.display_name}, ${c.phone}, ${c.email}, ${c.dedupe_key}, ${c.source}, ${c.first_seen}, ${c.last_seen})
      ON CONFLICT (client_id, dedupe_key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        last_seen = GREATEST(public.crm_customers.last_seen, EXCLUDED.last_seen),
        first_seen = LEAST(public.crm_customers.first_seen, EXCLUDED.first_seen),
        updated_at = now()
    `;
  }
  return merged.length;
}
```

- [ ] **Step 5b: Implement the thin endpoint.** Create `netlify/functions/crm-refresh.ts`:

```ts
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { refreshCustomers } from '../../src/modules/crm/lib/refresh';

export const config = { path: '/api/crm/refresh', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireCrm(req, ['crm.customers.view']);
  if (!a.ok) return a.res;
  const synced = await refreshCustomers(db(), a.ctx.clientId);
  return new Response(JSON.stringify({ synced }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 6: Run to verify it passes.** Run: `npx vitest run tests/crm/refresh.test.ts`
Expected: PASS (4 tests). If the dedupe assertion is 2 not 1, confirm `normalizePhone` maps the bare and `+91` phones to the same value.

- [ ] **Step 7: Typecheck + commit.**

```bash
npm run typecheck
git add tests/crm/_helpers.ts netlify/functions/_crm-authz.ts src/modules/crm/lib/refresh.ts netlify/functions/crm-refresh.ts tests/crm/refresh.test.ts
git commit -m "feat(crm): _crm-authz + refreshCustomers helper + crm-refresh endpoint"
```

---

### Task 5: `crm-customers-list.ts` (list + search)

**Files:**
- Create: `netlify/functions/crm-customers-list.ts`
- Test: `tests/crm/customers-list.test.ts`

**Interfaces:**
- Consumes: `requireCrm`, `db`.
- Produces: `GET /api/crm/customers?q=` → `{ customers: Array<{ id; display_name; phone; email; source; first_seen; last_seen }> }`, ordered `last_seen DESC`.

- [ ] **Step 1: Write the failing test.** Create `tests/crm/customers-list.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import listHandler from '../../netlify/functions/crm-customers-list';
import refreshHandler from '../../netlify/functions/crm-refresh';
import { seedClientWithCrm, enableCrm, seedCustomerRole, seedCustomerNode, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();
const uniq = () => Math.random().toString(36).slice(2, 8);

async function seedTwoCustomers() {
  const ctx = await seedClientWithCrm();
  await enableCrm(ctx.clientId);
  const roleId = await seedCustomerRole(ctx.clientId);
  await seedCustomerNode(ctx.clientId, roleId, 'Aisha Khan', `98${uniq().padEnd(8,'0').slice(0,8)}`, `aisha-${uniq()}@x.com`);
  await seedCustomerNode(ctx.clientId, roleId, 'Bob Ray', `97${uniq().padEnd(8,'0').slice(0,8)}`, `bob-${uniq()}@x.com`);
  await refreshHandler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
  return ctx;
}

describe('GET /api/crm/customers', () => {
  it('lists refreshed customers', async () => {
    const ctx = await seedTwoCustomers();
    const res = await listHandler(crmRequest(ctx, 'GET', '/api/crm/customers'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customers.length).toBe(2);
  });

  it('filters by ?q= on name/phone/email', async () => {
    const ctx = await seedTwoCustomers();
    const res = await listHandler(crmRequest(ctx, 'GET', '/api/crm/customers?q=aisha'));
    const body = await res.json();
    expect(body.customers.length).toBe(1);
    expect(body.customers[0].display_name).toContain('Aisha');
  });

  it('401 unauthenticated', async () => {
    const res = await listHandler(new Request('http://localhost/api/crm/customers'));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run tests/crm/customers-list.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `crm-customers-list.ts`:**

```ts
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';

export const config = { path: '/api/crm/customers', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireCrm(req, ['crm.customers.view']);
  if (!a.ok) return a.res;
  const sql = db();
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  const like = `%${q}%`;
  const rows = q
    ? await sql`SELECT id, display_name, phone, email, source, first_seen, last_seen
                FROM public.crm_customers WHERE client_id = ${a.ctx.clientId}::uuid
                AND (display_name ILIKE ${like} OR phone ILIKE ${like} OR email ILIKE ${like})
                ORDER BY last_seen DESC LIMIT 500`
    : await sql`SELECT id, display_name, phone, email, source, first_seen, last_seen
                FROM public.crm_customers WHERE client_id = ${a.ctx.clientId}::uuid
                ORDER BY last_seen DESC LIMIT 500`;
  return new Response(JSON.stringify({ customers: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `npx vitest run tests/crm/customers-list.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit.**

```bash
npm run typecheck
git add netlify/functions/crm-customers-list.ts tests/crm/customers-list.test.ts
git commit -m "feat(crm): crm-customers-list endpoint with search"
```

---

### Task 6: `crm-customer-detail.ts` (customer + notes + live timeline)

**Files:**
- Create: `netlify/functions/crm-customer-detail.ts`
- Test: `tests/crm/customer-detail.test.ts`

**Interfaces:**
- Consumes: `requireCrm`, `db`.
- Produces: `GET /api/crm/customers/:id` → `{ customer, notes: CrmNote[], timeline: TimelineEvent[] }` where `TimelineEvent = { kind: 'sale' | 'booking'; id; when; label; amount_cents; status }`, sorted `when DESC`.

- [ ] **Step 1: Write the failing test.** Create `tests/crm/customer-detail.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import detailHandler from '../../netlify/functions/crm-customer-detail';
import refreshHandler from '../../netlify/functions/crm-refresh';
import { seedClientWithCrm, enableCrm, seedCustomerRole, seedCustomerNode, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('GET /api/crm/customers/:id', () => {
  it('returns the customer with a live timeline of their paid sale', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const roleId = await seedCustomerRole(ctx.clientId);
    // Digits-only phone and NO email, so the timeline must match via the normalized-vs-raw
    // phone bridge (last-10-digits) — directly exercising that logic, not an email fallback.
    const phone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
    await seedCustomerNode(ctx.clientId, roleId, 'Timeline Person', phone, null);
    await sql`INSERT INTO public.sales (bucket_id, order_no, status, channel, source, customer_name, customer_phone, customer_email, subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node)
              VALUES (${ctx.clientId}, ${Math.floor(Math.random()*1e9)}, 'paid', 'instore', 'pos', 'Timeline Person', ${phone}, ${null}, 2500, 0, 0, 2500, ${ctx.ownerNodeId})`;
    await refreshHandler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
    const cust = (await sql`SELECT id FROM public.crm_customers WHERE client_id = ${ctx.clientId} LIMIT 1`) as Array<{ id: string }>;
    const id = cust[0]!.id;

    const res = await detailHandler(crmRequest(ctx, 'GET', `/api/crm/customers/${id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customer.id).toBe(id);
    expect(Array.isArray(body.notes)).toBe(true);
    expect(body.timeline.some((e: any) => e.kind === 'sale' && e.amount_cents === 2500)).toBe(true);
  });

  it('404 for an unknown id', async () => {
    const ctx = await seedClientWithCrm();
    await enableCrm(ctx.clientId);
    const res = await detailHandler(crmRequest(ctx, 'GET', `/api/crm/customers/00000000-0000-0000-0000-000000000000`));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run tests/crm/customer-detail.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `crm-customer-detail.ts`:**

```ts
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { jsonError } from './_shared/http';

export const config = { path: '/api/crm/customers/:id', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireCrm(req, ['crm.customers.view']);
  if (!a.ok) return a.res;
  const sql = db();
  const id = new URL(req.url).pathname.split('/').pop()!;
  const clientId = a.ctx.clientId;

  const rows = (await sql`SELECT * FROM public.crm_customers WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid`) as any[];
  const customer = rows[0];
  if (!customer) return jsonError(404, 'not_found');

  const notes = (await sql`SELECT id, body, created_by_user_node, created_at, updated_at
                           FROM public.crm_notes WHERE customer_id = ${id}::uuid AND client_id = ${clientId}::uuid
                           ORDER BY created_at DESC`) as any[];

  const email = customer.email; // stored lowercased
  // crm_customers.phone is NORMALIZED (+91…) but sales/bookings store the RAW entered
  // phone — so match on the last 10 digits (strip non-digits) to bridge the two, else the
  // timeline would miss any activity whose phone wasn't entered in +91 form.
  const phoneDigits = customer.phone ? String(customer.phone).replace(/\D/g, '').slice(-10) : null;
  // Live timeline: their paid sales + their bookings, matched by identity (phone-digits OR email).
  const sales = (await sql`SELECT id, created_at AS when, order_no, total_cents, status
                           FROM public.sales
                           WHERE bucket_id = ${clientId}::uuid AND status IN ('paid','fulfilled')
                           AND ((${phoneDigits}::text IS NOT NULL AND right(regexp_replace(coalesce(customer_phone,''), '[^0-9]', '', 'g'), 10) = ${phoneDigits})
                                OR (${email}::text IS NOT NULL AND lower(customer_email) = ${email}))`) as any[];
  const bookings = (await sql`SELECT b.id, lower(b.time_range)::text AS when, b.price_cents, b.status, s.name AS service_name
                              FROM public.bookings b
                              LEFT JOIN public.booking_services s ON s.id = b.service_id
                              WHERE b.bucket_id = ${clientId}::uuid
                              AND ((${phoneDigits}::text IS NOT NULL AND right(regexp_replace(coalesce(b.customer_phone,''), '[^0-9]', '', 'g'), 10) = ${phoneDigits})
                                   OR (${email}::text IS NOT NULL AND lower(b.customer_email) = ${email}))`) as any[];

  const timeline = [
    ...sales.map((s) => ({ kind: 'sale' as const, id: s.id, when: s.when, label: `Order #${s.order_no}`, amount_cents: Number(s.total_cents), status: s.status })),
    ...bookings.map((b) => ({ kind: 'booking' as const, id: b.id, when: b.when, label: b.service_name ?? 'Booking', amount_cents: Number(b.price_cents), status: b.status })),
  ].sort((x, y) => new Date(y.when).getTime() - new Date(x.when).getTime());

  return new Response(JSON.stringify({ customer, notes, timeline }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

Note: `lower(b.time_range)` extracts the range's start instant (tstzrange lower bound). Confirm `time_range` is the booking start column per `db/migrations/048_bookings.sql`.

- [ ] **Step 4: Run to verify it passes.** Run: `npx vitest run tests/crm/customer-detail.test.ts` → PASS (2 tests).

- [ ] **Step 5: Typecheck + commit.**

```bash
npm run typecheck
git add netlify/functions/crm-customer-detail.ts tests/crm/customer-detail.test.ts
git commit -m "feat(crm): crm-customer-detail endpoint with live sales+bookings timeline"
```

---

### Task 7: Notes CRUD — `crm-notes.ts` + `crm-note-detail.ts`

**Files:**
- Create: `netlify/functions/crm-notes.ts`
- Create: `netlify/functions/crm-note-detail.ts`
- Test: `tests/crm/notes.test.ts`

**Interfaces:**
- Consumes: `requireCrm`, `db`, `jsonError`.
- Produces: `POST /api/crm/notes` `{customer_id, body}` → `{ note }` (perm `crm.customers.create`); `PATCH /api/crm/notes/:id` `{body}` → `{ note }` (perm `crm.customers.edit`); `DELETE /api/crm/notes/:id` → 204 (perm `crm.customers.delete`).

- [ ] **Step 1: Write the failing test.** Create `tests/crm/notes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import notesHandler from '../../netlify/functions/crm-notes';
import noteDetailHandler from '../../netlify/functions/crm-note-detail';
import refreshHandler from '../../netlify/functions/crm-refresh';
import { seedClientWithCrm, enableCrm, seedCustomerRole, seedCustomerNode, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();
const uniq = () => Math.random().toString(36).slice(2, 8);

async function seedOneCustomer() {
  const ctx = await seedClientWithCrm();
  await enableCrm(ctx.clientId);
  const roleId = await seedCustomerRole(ctx.clientId);
  await seedCustomerNode(ctx.clientId, roleId, 'Note Target', `98${uniq().padEnd(8,'0').slice(0,8)}`, `n-${uniq()}@x.com`);
  await refreshHandler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
  const c = (await sql`SELECT id FROM public.crm_customers WHERE client_id = ${ctx.clientId} LIMIT 1`) as Array<{ id: string }>;
  return { ctx, customerId: c[0]!.id };
}

describe('CRM notes CRUD', () => {
  it('creates, edits, and deletes a note', async () => {
    const { ctx, customerId } = await seedOneCustomer();

    const created = await notesHandler(crmRequest(ctx, 'POST', '/api/crm/notes', { customer_id: customerId, body: 'Prefers Sarah' }));
    expect(created.status).toBe(200);
    const noteId = (await created.json()).note.id;

    const edited = await noteDetailHandler(crmRequest(ctx, 'PATCH', `/api/crm/notes/${noteId}`, { body: 'Prefers Sarah, mornings' }));
    expect(edited.status).toBe(200);
    expect((await edited.json()).note.body).toBe('Prefers Sarah, mornings');

    const del = await noteDetailHandler(crmRequest(ctx, 'DELETE', `/api/crm/notes/${noteId}`));
    expect(del.status).toBe(204);
    const rows = (await sql`SELECT id FROM public.crm_notes WHERE id = ${noteId}::uuid`) as any[];
    expect(rows).toHaveLength(0);
  });

  it('401 unauthenticated on create', async () => {
    const res = await notesHandler(new Request('http://localhost/api/crm/notes', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run tests/crm/notes.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `crm-notes.ts`:**

```ts
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { jsonError } from './_shared/http';

export const config = { path: '/api/crm/notes', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireCrm(req, ['crm.customers.create']);
  if (!a.ok) return a.res;
  const sql = db();
  const body = (await req.json().catch(() => ({}))) as { customer_id?: string; body?: string };
  if (!body.customer_id || !body.body?.trim()) return jsonError(400, 'invalid_input');

  const owned = (await sql`SELECT id FROM public.crm_customers WHERE id = ${body.customer_id}::uuid AND client_id = ${a.ctx.clientId}::uuid`) as any[];
  if (!owned[0]) return jsonError(404, 'not_found');

  const rows = (await sql`
    INSERT INTO public.crm_notes (client_id, customer_id, body, created_by_user_node)
    VALUES (${a.ctx.clientId}::uuid, ${body.customer_id}::uuid, ${body.body.trim()}, ${a.ctx.userNodeId}::uuid)
    RETURNING id, body, created_by_user_node, created_at, updated_at
  `) as any[];
  return new Response(JSON.stringify({ note: rows[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Implement `crm-note-detail.ts`:**

```ts
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { jsonError } from './_shared/http';

export const config = { path: '/api/crm/notes/:id', method: ['PATCH', 'DELETE'] };

export default async function handler(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split('/').pop()!;
  const isDelete = req.method === 'DELETE';
  const a = await requireCrm(req, [isDelete ? 'crm.customers.delete' : 'crm.customers.edit']);
  if (!a.ok) return a.res;
  const sql = db();

  if (isDelete) {
    const rows = (await sql`DELETE FROM public.crm_notes WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid RETURNING id`) as any[];
    if (!rows[0]) return jsonError(404, 'not_found');
    return new Response(null, { status: 204 });
  }

  const body = (await req.json().catch(() => ({}))) as { body?: string };
  if (!body.body?.trim()) return jsonError(400, 'invalid_input');
  const rows = (await sql`
    UPDATE public.crm_notes SET body = ${body.body.trim()}, updated_at = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id, body, created_by_user_node, created_at, updated_at
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  return new Response(JSON.stringify({ note: rows[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 5: Run to verify it passes.** Run: `npx vitest run tests/crm/notes.test.ts` → PASS (2 tests).

- [ ] **Step 6: Typecheck + commit.**

```bash
npm run typecheck
git add netlify/functions/crm-notes.ts netlify/functions/crm-note-detail.ts tests/crm/notes.test.ts
git commit -m "feat(crm): notes CRUD endpoints (create/edit/delete)"
```

---

### Task 8: Frontend foundation — api, format, permissions, route mounts

**Files:**
- Create: `src/modules/crm/api.ts`
- Create: `src/modules/crm/format.ts`
- Create: `src/modules/crm/shared/permissions.ts`
- Create: `src/modules/crm/CrmRouteMounts.tsx`

**Interfaces:**
- Produces: `crmApi` (refresh/listCustomers/getCustomer/addNote/editNote/deleteNote) + types `CrmCustomer`, `CrmNote`, `TimelineEvent`, `CustomerDetail`; `CrmListMount`, `CrmDetailMount`.

- [ ] **Step 1: Create `src/modules/crm/api.ts`** (copy the throw-on-error shape from `src/modules/booking/api.ts:5-26`):

```ts
export class CrmApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly details?: unknown) {
    super(code); this.name = 'CrmApiError';
  }
}
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    let code = 'unknown'; let details: unknown;
    try { const b = await res.json(); code = b?.error?.code ?? code; details = b?.error?.details; } catch { /* noop */ }
    throw new CrmApiError(res.status, code, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface CrmCustomer {
  id: string; display_name: string; phone: string | null; email: string | null;
  source: 'pos' | 'storefront' | 'booking'; first_seen: string; last_seen: string;
}
export interface CrmNote { id: string; body: string; created_by_user_node: string | null; created_at: string; updated_at: string; }
export interface TimelineEvent { kind: 'sale' | 'booking'; id: string; when: string; label: string; amount_cents: number; status: string; }
export interface CustomerDetail { customer: CrmCustomer; notes: CrmNote[]; timeline: TimelineEvent[]; }

export const crmApi = {
  refresh: () => call<{ synced: number }>('/api/crm/refresh', { method: 'POST' }),
  listCustomers: (q = '') => call<{ customers: CrmCustomer[] }>(`/api/crm/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getCustomer: (id: string) => call<CustomerDetail>(`/api/crm/customers/${id}`),
  addNote: (customer_id: string, body: string) => call<{ note: CrmNote }>('/api/crm/notes', json('POST', { customer_id, body })),
  editNote: (id: string, body: string) => call<{ note: CrmNote }>(`/api/crm/notes/${id}`, json('PATCH', { body })),
  deleteNote: (id: string) => call<void>(`/api/crm/notes/${id}`, { method: 'DELETE' }),
};
```

- [ ] **Step 2: Create `src/modules/crm/format.ts`** (copy money/date helpers from `src/modules/booking/format.ts`; adapt names as needed):

```ts
export const money = (cents: number) => `₹${(cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const dateOnly = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
```

- [ ] **Step 3: Create `src/modules/crm/shared/permissions.ts`** (copy the shape of `src/modules/products/shared/permissions.ts`):

```ts
export function isOwnerLevel(levelNumber: number | null | undefined): boolean {
  return levelNumber == null || levelNumber === 1;
}
export function canViewCrm(perms: Record<string, boolean>, levelNumber: number | null | undefined): boolean {
  return isOwnerLevel(levelNumber) || perms['crm.customers.view'] === true;
}
```

- [ ] **Step 4: Create `src/modules/crm/CrmRouteMounts.tsx`** (copy `src/modules/booking/BookingRouteMounts.tsx`; confirm the exact `useUserAuth` import path and returned field names against that file):

```tsx
import { Navigate, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useUserAuth } from '../user-portal/user-auth-context';
import { CustomersListPage } from './vendor/CustomersListPage';
import { CustomerDetailPage } from './vendor/CustomerDetailPage';

const ALL_CRM_PERMS = ['crm.customers.view', 'crm.customers.create', 'crm.customers.edit', 'crm.customers.delete'] as const;

function useAuthBits() {
  const { user, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams();
  const isOwner = !!user && (user.level_number == null || user.level_number === 1);
  const perms: ReadonlySet<string> = isOwner
    ? new Set(ALL_CRM_PERMS)
    : new Set(Object.entries(permissions ?? {}).filter(([, v]) => v === true).map(([k]) => k));
  const crmEnabled = (enabledModules ?? []).some((m: { key: string }) => m.key === 'crm');
  return { user, loading, slug: slug ?? '', isOwner, perms, crmEnabled };
}

function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => ReactNode) {
  return function Mount() {
    const { user, loading, slug, perms, crmEnabled } = useAuthBits();
    if (loading) return null;
    if (!user) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!crmEnabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return <>{render(slug, perms)}</>;
  };
}

export const CrmListMount = gate('crm.customers.view', (slug, perms) => <CustomersListPage slug={slug} perms={perms} />);
export const CrmDetailMount = gate('crm.customers.view', (slug, perms) => <CustomerDetailPage slug={slug} perms={perms} />);
```

- [ ] **Step 5: Typecheck.** Run: `npm run typecheck`
Expected: PASS. (The pages don't exist yet — create empty stubs if the import fails, to be filled in Tasks 10–11, OR implement this task after 10–11. Recommended: create minimal stub files now:
`src/modules/crm/vendor/CustomersListPage.tsx` and `CustomerDetailPage.tsx` each exporting `export function CustomersListPage(_: { slug: string; perms: ReadonlySet<string> }) { return null; }` — real bodies land in Tasks 10–11.)

- [ ] **Step 6: Commit.**

```bash
git add src/modules/crm/api.ts src/modules/crm/format.ts src/modules/crm/shared src/modules/crm/CrmRouteMounts.tsx src/modules/crm/vendor
git commit -m "feat(crm): FE foundation — api layer, format, permissions, route mounts"
```

---

### Task 9: Frontend wiring — router, sidebar nav, CSS

**Files:**
- Modify: `src/lib/router.tsx`
- Modify: `src/modules/user-portal/nav/useNavItems.ts`
- Modify: `src/modules/user-portal/layout/Sidebar.tsx`
- Modify: `src/lib/components.css`

**Interfaces:**
- Consumes: `CrmListMount`, `CrmDetailMount` (Task 8).
- Produces: routes `/c/:slug/crm` and `/c/:slug/crm/:id`; a gated "CRM" sidebar link; `.crm-*` styles.

- [ ] **Step 1: Add routes.** In `src/lib/router.tsx`, add near the booking mount imports: `import { CrmListMount, CrmDetailMount } from '../modules/crm/CrmRouteMounts';`. In the `/c/:slug` authed children array (beside the `booking` entries), add:
```tsx
{ path: 'crm', element: <CrmListMount /> },
{ path: 'crm/:id', element: <CrmDetailMount /> },
```

- [ ] **Step 2: Register dedicated nav.** In `src/modules/user-portal/nav/useNavItems.ts`, add `'crm'` to the `MODULES_WITH_DEDICATED_NAV` set (line ~24): `new Set<string>(['products', 'pos', 'booking', 'analytics', 'crm'])`.

- [ ] **Step 3: Add the sidebar link.** In `src/modules/user-portal/layout/Sidebar.tsx`, mirror the booking gate. Near the other `*Enabled`/`show*` consts add:
```tsx
const crmEnabled = enabledModules.some((m) => m.key === 'crm');
const showCrm = crmEnabled && (isOwner || permissions['crm.customers.view'] === true);
```
Add `showCrm` to the "Modules" group-visibility guard (the `||` chain around line ~72). In the Modules group JSX (beside the booking `NavLink`, ~line 81) add:
```tsx
{showCrm && (<NavLink to={`/c/${slug}/crm`} className="sidebar-link">CRM</NavLink>)}
```
(Match the exact `className` / `NavLink` props used by the sibling booking link in this file.)

- [ ] **Step 4: Add CSS.** Append a `.crm-*` block to `src/lib/components.css` (reuse existing tokens; keep it minimal):
```css
/* CRM module */
.crm-timeline { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.crm-timeline li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; }
.crm-note { padding: 10px 12px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; margin-bottom: 8px; }
.crm-note-form { display: flex; gap: 8px; margin: 12px 0; }
.crm-source-pill { font-size: 11px; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: var(--muted-bg, #f3f4f6); }
```

- [ ] **Step 5: Typecheck + build.** Run: `npm run typecheck && npm run build`
Expected: both PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/router.tsx src/modules/user-portal/nav/useNavItems.ts src/modules/user-portal/layout/Sidebar.tsx src/lib/components.css
git commit -m "feat(crm): wire routes, sidebar nav, and CSS"
```

---

### Task 10: `CustomersListPage` (refresh-on-mount, search, table, states)

**Files:**
- Modify (replace stub): `src/modules/crm/vendor/CustomersListPage.tsx`

**Interfaces:**
- Consumes: `crmApi`, `CrmCustomer`, `dateOnly` (format).
- Produces: `CustomersListPage({ slug, perms })`.

- [ ] **Step 1: Implement the page.** Replace `src/modules/crm/vendor/CustomersListPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { crmApi, type CrmCustomer } from '../api';
import { dateOnly } from '../format';

export function CustomersListPage({ slug, perms: _perms }: { slug: string; perms: ReadonlySet<string> }) {
  const [customers, setCustomers] = useState<CrmCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load(query = '') {
    try { setError(null); const r = await crmApi.listCustomers(query); setCustomers(r.customers); }
    catch (e) { setError('Could not load customers.'); setCustomers([]); }
  }
  async function refreshThenLoad() {
    setRefreshing(true);
    try { await crmApi.refresh(); } catch { /* best-effort */ }
    await load(q);
    setRefreshing(false);
  }
  useEffect(() => { refreshThenLoad(); /* on mount */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <div className="page-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Customers</h1>
        <button className="btn" onClick={refreshThenLoad} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <form className="pm-search" onSubmit={(e) => { e.preventDefault(); load(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, or email…" />
        <button className="btn" type="submit">Search</button>
      </form>

      {error && <div className="error-banner">{error}</div>}
      {customers === null && <div className="muted">Loading…</div>}
      {customers !== null && customers.length === 0 && !error && (
        <div className="pm-empty">No customers yet. They appear here after a sale or booking.</div>
      )}
      {customers !== null && customers.length > 0 && (
        <table className="pm-table">
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Source</th><th>Last seen</th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/c/${slug}/crm/${c.id}`}>{c.display_name}</Link></td>
                <td>{c.phone ?? '—'}</td>
                <td>{c.email ?? '—'}</td>
                <td><span className="crm-source-pill">{c.source}</span></td>
                <td>{dateOnly(c.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build.** Run: `npm run typecheck && npm run build` → PASS. (If `.error-banner`/`.page-title-row` classes don't exist, use existing ones like `.muted` — grep `src/lib/components.css`.)

- [ ] **Step 3: Commit.**

```bash
git add src/modules/crm/vendor/CustomersListPage.tsx
git commit -m "feat(crm): customers list page — refresh-on-mount, search, empty/loading/error states"
```

---

### Task 11: `CustomerDetailPage` (timeline + notes CRUD)

**Files:**
- Modify (replace stub): `src/modules/crm/vendor/CustomerDetailPage.tsx`

**Interfaces:**
- Consumes: `crmApi`, `CustomerDetail`, `CrmNote`, `money`, `dateTime`; `useParams`.
- Produces: `CustomerDetailPage({ slug, perms })`.

- [ ] **Step 1: Implement the page.** Replace `src/modules/crm/vendor/CustomerDetailPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { crmApi, type CustomerDetail, type CrmNote } from '../api';
import { money, dateTime } from '../format';

export function CustomerDetailPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const { id = '' } = useParams();
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const canCreate = perms.has('crm.customers.create');
  const canEdit = perms.has('crm.customers.edit');
  const canDelete = perms.has('crm.customers.delete');

  async function load() {
    try { setError(null); setData(await crmApi.getCustomer(id)); }
    catch { setError('Could not load this customer.'); }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addNote() {
    if (!noteBody.trim()) return;
    setBusy(true);
    try { await crmApi.addNote(id, noteBody.trim()); setNoteBody(''); await load(); } finally { setBusy(false); }
  }
  async function editNote(n: CrmNote) {
    const next = window.prompt('Edit note', n.body);
    if (next == null || !next.trim()) return;
    await crmApi.editNote(n.id, next.trim()); await load();
  }
  async function deleteNote(n: CrmNote) {
    await crmApi.deleteNote(n.id); await load();
  }

  if (error) return <div className="page"><Link to={`/c/${slug}/crm`}>← Customers</Link><div className="error-banner">{error}</div></div>;
  if (!data) return <div className="page"><div className="muted">Loading…</div></div>;
  const { customer, notes, timeline } = data;

  return (
    <div className="page">
      <Link to={`/c/${slug}/crm`}>← Customers</Link>
      <h1 className="page-title">{customer.display_name}</h1>
      <p className="muted">
        {customer.phone ?? '—'} · {customer.email ?? '—'} · <span className="crm-source-pill">{customer.source}</span>
        {' · '}first seen {dateTime(customer.first_seen)} · last seen {dateTime(customer.last_seen)}
      </p>

      <h2>Activity</h2>
      {timeline.length === 0 ? <div className="pm-empty">No activity yet.</div> : (
        <ul className="crm-timeline">
          {timeline.map((e) => (
            <li key={`${e.kind}-${e.id}`}>
              <span>{e.kind === 'sale' ? '🧾' : '📅'} {e.label} · {e.status}</span>
              <span>{money(e.amount_cents)} · {dateTime(e.when)}</span>
            </li>
          ))}
        </ul>
      )}

      <h2>Notes</h2>
      {canCreate && (
        <div className="crm-note-form">
          <input value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Add a note…" />
          <button className="btn" onClick={addNote} disabled={busy || !noteBody.trim()}>Add</button>
        </div>
      )}
      {notes.length === 0 ? <div className="pm-empty">No notes yet.</div> : notes.map((n) => (
        <div className="crm-note" key={n.id}>
          <div>{n.body}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {dateTime(n.created_at)}
            {canEdit && <button className="btn-link" onClick={() => editNote(n)}> · Edit</button>}
            {canDelete && <button className="btn-link" onClick={() => deleteNote(n)}> · Delete</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build.** Run: `npm run typecheck && npm run build` → PASS. (Swap any missing utility class names for ones present in `src/lib/components.css`.)

- [ ] **Step 3: Commit.**

```bash
git add src/modules/crm/vendor/CustomerDetailPage.tsx
git commit -m "feat(crm): customer detail page — activity timeline + notes CRUD"
```

---

### Task 12: Seed script for `papa-s-saloon`

**Files:**
- Create: `scripts/seed-crm.ts`
- Modify: `package.json` (add `"seed:crm"`)

**Interfaces:**
- Produces: `npm run seed:crm` — enables the `crm` product for `papa-s-saloon` and populates `crm_customers` by running the same refresh logic.

- [ ] **Step 1: Create `scripts/seed-crm.ts`** (direct `neon`, mirrors `scripts/bootstrap-admin.ts`; reuses the shared `refreshCustomers` — do NOT re-inline the refresh SQL):

```ts
#!/usr/bin/env tsx
import { neon } from '@neondatabase/serverless';
import { refreshCustomers } from '../src/modules/crm/lib/refresh';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  const c = (await sql`SELECT id FROM public.clients WHERE slug = 'papa-s-saloon' LIMIT 1`) as Array<{ id: string }>;
  if (!c[0]) throw new Error('demo tenant papa-s-saloon not found — seed POS/Booking first');
  const clientId = c[0].id;

  // Enable the crm product for the demo tenant (idempotent).
  const admin = (await sql`SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1`) as Array<{ id: string }>;
  await sql`INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
            VALUES (${clientId}, 'crm', ${admin[0]?.id ?? null}) ON CONFLICT (client_id, product_key) DO NOTHING`;

  const n = await refreshCustomers(sql, clientId);
  console.log(`✓ CRM enabled + seeded ${n} customers for papa-s-saloon (${clientId})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script.** In `package.json` `"scripts"`, add: `"seed:crm": "tsx --env-file=.env scripts/seed-crm.ts"`.

- [ ] **Step 3: Run it.** Run: `npm run seed:crm`
Expected: `✓ CRM enabled + seeded N customers for papa-s-saloon`. (If `papa-s-saloon` has no POS/Booking demo data, N may be 0 — that's fine; the list page's empty state covers it. Optionally seed a couple of demo sales first.)

- [ ] **Step 4: Commit.**

```bash
git add scripts/seed-crm.ts package.json
git commit -m "feat(crm): seed-crm script — enable product + backfill customers for papa-s-saloon"
```

---

### Task 13: Full verification + golden-flow smoke

**Files:** none (verification only).

- [ ] **Step 1: Typecheck.** Run: `npm run typecheck` → PASS.

- [ ] **Step 2: Full test suite.** Run: `npx vitest run`
Expected: ALL tests green (existing suite + the new `src/modules/crm/lib/__tests__/merge.test.ts`, `src/modules/registry/__tests__/crm-registry.test.ts`, and `tests/crm/*`). Fix any regressions before proceeding.

- [ ] **Step 3: Build.** Run: `npm run build` → PASS.

- [ ] **Step 4: Golden-flow smoke.** Start dev: `npx netlify dev --port 5182 --target-port 8892` (unique ports per worktree). Then, as the `papa-s-saloon` Owner:
  1. Make a guest booking via the public storefront (creates a `user_nodes` customer).
  2. Open `/c/papa-s-saloon/crm` → the list refreshes on mount → the new customer appears.
  3. Open the customer → the booking shows in the activity timeline.
  4. Add a note → it persists on reload; edit and delete it.
  Verify no 500s, and the empty/loading/error states render (e.g. load `/crm` on a tenant with no customers).

- [ ] **Step 5: Update the handoff.** Append a CRM section to `docs/superpowers/handoffs/2026-06-29-booking-module.md` (or a new `docs/superpowers/handoffs/2026-07-03-crm-module.md`): branch `feat/crm-iso`, HEAD SHA, migration 055, new function names + routes, the `client_enabled_products` enable requirement for prod, and gotchas.

- [ ] **Step 6: Final commit.**

```bash
git add docs/superpowers/handoffs
git commit -m "docs(crm): handoff — CRM v1 complete, migration 055, feat/crm-iso"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- §4 tables → Task 1. §3/§5 refresh + merge → Tasks 3, 4. §6 endpoints → Tasks 4–7. §7 registry + authz → Tasks 2, 4. §8 FE → Tasks 8–11. §9 seed/tests/verify → Tasks 3–7, 12, 13. §10 checklist → enforced across tasks. §11 open items → item 1 resolved (migrate runner applies files individually); items 2–3 covered by Task 4 helpers + Task 12 enable-row.
- Golden flow → Task 13 Step 4.

**Placeholder scan:** No "TBD"/"handle edge cases". The few "confirm against the sibling file" notes are concrete verification steps with exact file:line targets and a fallback, not deferred work.

**Type consistency:** `mergeCustomers`/`RawCustomerRow`/`MergedCustomer` (Task 3) are consumed identically in Tasks 4 and 12. `requireCrm`/`CrmAuthCtx` (Task 4) used verbatim in Tasks 5–7. `crmApi`/`CrmCustomer`/`CustomerDetail`/`TimelineEvent` (Task 8) consumed in Tasks 10–11. `TimelineEvent` shape (`kind/id/when/label/amount_cents/status`) matches the detail endpoint's emitted object (Task 6). Permission keys are the same four `crm.customers.*` strings in authz, mounts, sidebar, and endpoints.

**Known confirm-at-execution points (flagged inline, not placeholders):** UUID default (`gen_random_uuid()`), `ModuleKey` union vs derived, `dedupeKey` argument shape, `jsonError` signature, `useUserAuth` field names, `sales`/`bookings` column names for the timeline, and exact sidebar `className`. Each has a grep/sed step and a fallback.
