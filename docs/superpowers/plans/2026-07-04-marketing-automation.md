# Marketing Automation v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Marketing Automation v1 — compose an email campaign over CRM customers, preview its audience count, send now through the mailer, and see a per-recipient send log.

**Architecture:** A thin orchestration module. It reads `crm_customers` (audience) and calls the low-level `deliver()` transport (never re-implements sending). Two tables (migration 060: `marketing_campaigns`, `campaign_sends`), five flat Netlify functions, FE mirrors the CRM/Booking module.

**Tech Stack:** React 18 + Vite SPA, Netlify Functions v2 (flat `.ts`), Neon Postgres (HTTP driver), vitest, tsx migrations.

**Spec:** `docs/superpowers/specs/2026-07-04-marketing-automation-design.md`.

## Global Constraints

- Worktree `../ExSol-Marketing-WT`, branch `feat/marketing-iso` (off `main`). **Local commits only — never push/merge.** `git branch --show-current` before the first commit must say `feat/marketing-iso`. `npm install` already run.
- Migration number is **060** exactly. One SQL statement per line; comments on their own line, never after a `;`. No `$$`. Lowercase idempotent DDL (mirror `db/migrations/055_crm.sql`).
- Permission keys bucket×verb only: `marketing.customers.{view,create,edit,delete}`.
- Authz `_marketing-authz.ts`: enable-gate THEN `level_number === 1` Owner bypass THEN required loop. Same bypass in `Sidebar.tsx` AND `MarketingRouteMounts.tsx`.
- Netlify functions flat top-level. `list` + `create` share `/api/marketing/campaigns` → both MUST set `config.method`. `send` is a flat `/api/marketing/send` (no literal sub-path under a `:param`).
- Send uses the low-level transport: `import { deliver } from './_shared/resend'`. `deliver({to,from,subject,html})` → `{ ok, delivered, providerId?, error? }`; returns `{ok:true,delivered:false}` when `RESEND_API_KEY` absent (→ status `logged`). Never throws.
- Audience is **emailable only** (`email IS NOT NULL`); `recent_30d` adds `last_seen >= now() - interval '30 days'`.
- Tests share one persistent dev DB (no teardown): randomize unique-constrained literals. No Blobs → no `getStore()` mock. `RESEND_API_KEY` is absent in `.env` → send tests record `logged` (no network).
- **Done = `npm run typecheck` AND the full vitest suite green** (`CLAUDE.md`).
- Reuse `audienceRecipients`/`audienceCount` — do NOT inline the audience SQL in endpoints.

---

### Task 1: Migration 060 — `marketing_campaigns` + `campaign_sends`

**Files:**
- Create: `db/migrations/060_marketing.sql`

**Interfaces:**
- Produces: tables `public.marketing_campaigns`, `public.campaign_sends` (FK → `crm_customers`).

- [ ] **Step 1: Confirm UUID default convention.** Run: `grep -n "gen_random_uuid" db/migrations/055_crm.sql | head`. Use `default gen_random_uuid()` as 055 does.

- [ ] **Step 2: Write the migration.** Create `db/migrations/060_marketing.sql`:

```sql
-- Migration 060: Marketing Automation (campaigns + per-recipient send log)
-- Spec: docs/superpowers/specs/2026-07-04-marketing-automation-design.md
-- Reserved number 060 (free on main; gap before 061). Depends on 055 (crm_customers).
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  subject text not null,
  body_html text not null,
  audience text not null default 'all' check (audience in ('all', 'recent_30d')),
  status text not null default 'draft' check (status in ('draft', 'sent')),
  sent_at timestamptz,
  created_by_user_node uuid references public.user_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_campaigns_client_created_idx on public.marketing_campaigns (client_id, created_at desc);
create table if not exists public.campaign_sends (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  customer_id uuid references public.crm_customers(id) on delete set null,
  recipient_email text not null,
  status text not null check (status in ('sent', 'logged', 'failed')),
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists campaign_sends_campaign_idx on public.campaign_sends (campaign_id);
create index if not exists campaign_sends_client_created_idx on public.campaign_sends (client_id, created_at desc);
```

- [ ] **Step 3: Apply to dev.** Run: `npm run migrate`
Expected: `→ applying 060_marketing (N statements)` then `✓ 060_marketing`.

- [ ] **Step 4: Verify schema.** Run:
`npx tsx --env-file=.env -e "import{neon}from'@neondatabase/serverless';const s=neon(process.env.DATABASE_URL);s\`select count(*) from public.marketing_campaigns\`.then(r=>console.log('campaigns ok',r)).then(()=>s\`select count(*) from public.campaign_sends\`).then(r=>console.log('sends ok',r))"`
Expected: `campaigns ok` and `sends ok` both print.

- [ ] **Step 5: Commit.**
```bash
git add db/migrations/060_marketing.sql
git commit -m "feat(marketing): migration 060 — marketing_campaigns + campaign_sends"
```

---

### Task 2: Registry — ModuleManifest + ProductManifest

**Files:**
- Create: `src/modules/registry/manifests/marketing.ts`
- Modify: `src/modules/registry/modules.ts`
- Create: `src/modules/registry/products-list/marketing.ts`
- Modify: `src/modules/registry/products.ts`
- Test: `src/modules/registry/__tests__/marketing-registry.test.ts`

**Interfaces:**
- Produces: `getModule('marketing')`, `getProduct('marketing')`, and `isValidPermissionKey('marketing.customers.view', ['marketing'])` all truthy.

- [ ] **Step 1: Write the failing test.** Create `src/modules/registry/__tests__/marketing-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getModule } from '../modules';
import { getProduct } from '../products';
import { isValidPermissionKey } from '../../../../netlify/functions/_shared/permission-keys';

describe('marketing registry', () => {
  it('registers the marketing module', () => {
    const m = getModule('marketing');
    expect(m?.data_buckets).toContain('customers');
    expect(m?.verbs).toEqual(expect.arrayContaining(['view', 'create', 'edit']));
    expect(m?.vendor_side).toBe(true);
  });
  it('registers the marketing product referencing the module', () => {
    expect(getProduct('marketing')?.modules.map((r) => r.module)).toContain('marketing');
  });
  it('validates marketing bucket×verb keys when enabled', () => {
    expect(isValidPermissionKey('marketing.customers.view', ['marketing'])).toBe(true);
    expect(isValidPermissionKey('marketing.customers.edit', ['marketing'])).toBe(true);
    expect(isValidPermissionKey('marketing.customers.view', [])).toBe(false);
    expect(isValidPermissionKey('marketing.products.view', ['marketing'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run src/modules/registry/__tests__/marketing-registry.test.ts` → FAIL (`getModule('marketing')` undefined).

- [ ] **Step 3: Create the manifest.** `src/modules/registry/manifests/marketing.ts`:

```ts
import type { ModuleManifest } from '../types';

export const marketingManifest: ModuleManifest = {
  key: 'marketing',
  label: 'Marketing',
  data_buckets: ['customers'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
};
```

- [ ] **Step 4: Register the module.** In `src/modules/registry/modules.ts`, add `import { marketingManifest } from './manifests/marketing';` beside the other manifest imports and add `marketing: marketingManifest,` inside `moduleRegistry`. (`ModuleKey` is `string` — no `types.ts` edit needed; confirm by reading `types.ts`.)

- [ ] **Step 5: Create the product.** `src/modules/registry/products-list/marketing.ts`:

```ts
import type { ProductManifest } from '../types';

export const marketingProduct: ProductManifest = {
  key: 'marketing',
  label: 'Marketing Automation',
  modules: [{ module: 'marketing', side: 'vendor' }],
};
```

- [ ] **Step 6: Register the product.** In `src/modules/registry/products.ts`, add `import { marketingProduct } from './products-list/marketing';` and `'marketing': marketingProduct,` inside `productRegistry`.

- [ ] **Step 7: Run to verify it passes.** Run: `npx vitest run src/modules/registry/__tests__/marketing-registry.test.ts` → PASS (3 tests).

- [ ] **Step 8: Typecheck + commit.**
```bash
npm run typecheck
git add src/modules/registry
git commit -m "feat(marketing): register marketing ModuleManifest + ProductManifest"
```

---

### Task 3: Audience library (shared, DB-backed)

**Files:**
- Create: `src/modules/marketing/lib/audience.ts`
- Test: `tests/marketing/audience.test.ts`
- Create: `tests/marketing/_helpers.ts`

**Interfaces:**
- Produces: `audienceRecipients(sql, clientId, audience): Promise<{id,email}[]>`, `audienceCount(sql, clientId, audience): Promise<number>`, type `Audience = 'all'|'recent_30d'`. Test helpers: `seedClientWithMarketing()`, `enableMarketing(clientId)`, `grantMarketingPerms(...)`, `seedCrmCustomer(clientId, opts)`, `marketingRequest(...)`, `demoteToL2(...)`, `sqlClient()`.

- [ ] **Step 1: Create the test helpers.** Create `tests/marketing/_helpers.ts` (mirrors `tests/crm/_helpers.ts`; adds `enableMarketing` + `seedCrmCustomer`):

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
  const hash = await hashPassword('mkt-test-admin-pw');
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES ('mkt-test-admin@exsol.test', ${hash}, 'Mkt Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash} RETURNING id
  `) as Array<{ id: string }>;
  cachedAdminId = rows[0]!.id;
  return cachedAdminId;
}

export interface MktTestCtx { clientId: string; ownerNodeId: string; adminId: string; slug: string; cookie: string; }

export async function seedClientWithMarketing(): Promise<MktTestCtx> {
  const adminId = await ensureBootstrapAdmin();
  const slug = `mkt-test-${Math.random().toString(36).slice(2, 10)}`;
  const c = (await sql`INSERT INTO public.clients (slug, name, created_by) VALUES (${slug}, 'Mkt Test', ${adminId}) RETURNING id`) as Array<{ id: string }>;
  const clientId = c[0]!.id;
  const role = (await sql`INSERT INTO public.client_roles (client_id, key, label, color) VALUES (${clientId}, 'owner', 'Owner', '#3b82f6') RETURNING id`) as Array<{ id: string }>;
  await sql`INSERT INTO public.client_levels (client_id, level_number, label, permissions) VALUES (${clientId}, 1, 'Primary', '{}'::jsonb)`;
  const email = `mkt-owner-${slug}@exsol.test`;
  const node = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientId}, NULL, 1, ${role[0]!.id}, 'Mkt Owner', ${email}, ${adminId}) RETURNING id`) as Array<{ id: string }>;
  const ownerNodeId = node[0]!.id;
  const hash = await hashPassword('mkt-owner-pw');
  await sql`INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
            VALUES (${clientId}, ${ownerNodeId}, ${email}, ${hash}, false, ${adminId})`;
  const token = await mintBucketUserSession({ sub: ownerNodeId, email, client_id: clientId });
  return { clientId, ownerNodeId, adminId, slug, cookie: `bu_session=${token}` };
}

export async function enableMarketing(clientId: string): Promise<void> {
  const adminId = await ensureBootstrapAdmin();
  await sql`INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
            VALUES (${clientId}, 'marketing', ${adminId}) ON CONFLICT (client_id, product_key) DO NOTHING`;
}

export async function grantMarketingPerms(clientId: string, levelNumber: number, keys: readonly string[]): Promise<void> {
  const perms: Record<string, true> = Object.fromEntries(keys.map((k) => [k, true]));
  await sql`UPDATE public.client_levels SET permissions = ${JSON.stringify(perms)}::jsonb WHERE client_id = ${clientId} AND level_number = ${levelNumber}`;
}

/** Seed a crm_customers row directly (audience source). last_seen controls recent_30d membership. */
export async function seedCrmCustomer(
  clientId: string, opts: { email?: string | null; lastSeen?: string; name?: string } = {},
): Promise<string> {
  const digits = `${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  const key = `phone:+91${digits}`;
  const r = (await sql`
    INSERT INTO public.crm_customers (client_id, display_name, phone, email, dedupe_key, source, first_seen, last_seen)
    VALUES (${clientId}, ${opts.name ?? 'Cust'}, ${`+91${digits}`}, ${opts.email ?? null}, ${key}, 'pos', now(), ${opts.lastSeen ?? new Date().toISOString()})
    RETURNING id`) as Array<{ id: string }>;
  return r[0]!.id;
}

export function marketingRequest(ctx: MktTestCtx, method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method, headers: { cookie: ctx.cookie, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function demoteToL2(ctx: MktTestCtx): Promise<MktTestCtx> {
  await sql`INSERT INTO public.client_levels (client_id, level_number, label, permissions)
            VALUES (${ctx.clientId}::uuid, 2, 'L2', '{}'::jsonb) ON CONFLICT DO NOTHING`;
  const role = (await sql`SELECT id FROM public.client_roles WHERE client_id = ${ctx.clientId} LIMIT 1`) as Array<{ id: string }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `mkt-l2-${suffix}@exsol.test`;
  const node = (await sql`INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${ctx.clientId}, ${ctx.ownerNodeId}, 2, ${role[0]!.id}, 'L2 Sub', ${email}, ${ctx.adminId}) RETURNING id`) as Array<{ id: string }>;
  const subNodeId = node[0]!.id;
  const hash = await hashPassword('mkt-l2-pw');
  await sql`INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
            VALUES (${ctx.clientId}, ${subNodeId}, ${email}, ${hash}, false, ${ctx.adminId})`;
  const token = await mintBucketUserSession({ sub: subNodeId, email, client_id: ctx.clientId });
  return { ...ctx, ownerNodeId: subNodeId, cookie: `bu_session=${token}` };
}
```

- [ ] **Step 2: Write the failing test.** Create `tests/marketing/audience.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { audienceRecipients, audienceCount } from '../../src/modules/marketing/lib/audience';
import { seedClientWithMarketing, seedCrmCustomer, sqlClient } from './_helpers';

const sql = sqlClient();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

describe('marketing audience', () => {
  it('counts only emailable customers for "all"', async () => {
    const ctx = await seedClientWithMarketing();
    await seedCrmCustomer(ctx.clientId, { email: `a-${Math.random().toString(36).slice(2)}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: `b-${Math.random().toString(36).slice(2)}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: null }); // phone-only, excluded
    expect(await audienceCount(sql, ctx.clientId, 'all')).toBe(2);
  });

  it('recent_30d excludes customers last seen > 30 days ago', async () => {
    const ctx = await seedClientWithMarketing();
    await seedCrmCustomer(ctx.clientId, { email: `r-${Math.random().toString(36).slice(2)}@x.com`, lastSeen: daysAgo(5) });
    await seedCrmCustomer(ctx.clientId, { email: `o-${Math.random().toString(36).slice(2)}@x.com`, lastSeen: daysAgo(60) });
    expect(await audienceCount(sql, ctx.clientId, 'all')).toBe(2);
    expect(await audienceCount(sql, ctx.clientId, 'recent_30d')).toBe(1);
  });

  it('audienceRecipients returns id+email for emailable rows only', async () => {
    const ctx = await seedClientWithMarketing();
    const em = `c-${Math.random().toString(36).slice(2)}@x.com`;
    await seedCrmCustomer(ctx.clientId, { email: em });
    await seedCrmCustomer(ctx.clientId, { email: null });
    const rows = await audienceRecipients(sql, ctx.clientId, 'all');
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(em);
  });
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `npx vitest run tests/marketing/audience.test.ts` → FAIL (`../audience` not found).

- [ ] **Step 4: Implement `audience.ts`.** Create `src/modules/marketing/lib/audience.ts`:

```ts
import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;
export type Audience = 'all' | 'recent_30d';

export async function audienceRecipients(sql: Sql, clientId: string, audience: Audience): Promise<{ id: string; email: string }[]> {
  const rows = audience === 'recent_30d'
    ? await sql`SELECT id, email FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND email IS NOT NULL AND last_seen >= now() - interval '30 days'`
    : await sql`SELECT id, email FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND email IS NOT NULL`;
  return rows as { id: string; email: string }[];
}

export async function audienceCount(sql: Sql, clientId: string, audience: Audience): Promise<number> {
  const rows = audience === 'recent_30d'
    ? await sql`SELECT count(*)::int AS n FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND email IS NOT NULL AND last_seen >= now() - interval '30 days'`
    : await sql`SELECT count(*)::int AS n FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND email IS NOT NULL`;
  return (rows as { n: number }[])[0]?.n ?? 0;
}
```
(`count(*)::int` returns a JS number; a bare `count(*)` BIGINT comes back as a string.)

- [ ] **Step 5: Run to verify it passes.** Run: `npx vitest run tests/marketing/audience.test.ts` → PASS (3 tests).

- [ ] **Step 6: Typecheck + commit.**
```bash
npm run typecheck
git add src/modules/marketing/lib/audience.ts tests/marketing/audience.test.ts tests/marketing/_helpers.ts
git commit -m "feat(marketing): audience library (emailable + recent_30d) over crm_customers"
```

---

### Task 4: `_marketing-authz.ts` + `marketing-audience-count.ts`

**Files:**
- Create: `netlify/functions/_marketing-authz.ts`
- Create: `netlify/functions/marketing-audience-count.ts`
- Test: `tests/marketing/audience-count.test.ts`

**Interfaces:**
- Consumes: `audienceCount` (Task 3); `requireBucketUser`/`UnauthorizedError` from `_shared/permissions`; `db` from `_shared/db`; `jsonError` from `_shared/http`; `getProduct` from registry.
- Produces: `requireMarketing(req, required)` → `{ok:true,ctx:{userNodeId,clientId,perms}}|{ok:false,res}`; endpoint `GET /api/marketing/audience-count?audience=` → `{ audience, count }`.

- [ ] **Step 1: Create `_marketing-authz.ts`.** Clone `netlify/functions/_crm-authz.ts` exactly, swapping identifiers. Read the real `_crm-authz.ts` first and mirror its structure (level/perm query, error codes). Create `netlify/functions/_marketing-authz.ts`:

```ts
import { jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { db } from './_shared/db';
import { getProduct } from '../../src/modules/registry/products';

export interface MarketingAuthCtx {
  userNodeId: string;
  clientId: string;
  perms: ReadonlySet<string>;
}

const ALL_MARKETING_PERMS = [
  'marketing.customers.view', 'marketing.customers.create',
  'marketing.customers.edit', 'marketing.customers.delete',
] as const;

export async function requireMarketing(
  req: Request,
  required: readonly string[],
): Promise<{ ok: true; ctx: MarketingAuthCtx } | { ok: false; res: Response }> {
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
  if (!modules.has('marketing')) return { ok: false, res: jsonError(412, 'marketing_module_not_enabled') };

  if (levelNumber === 1) {
    return { ok: true, ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms: new Set(ALL_MARKETING_PERMS) } };
  }
  for (const r of required) {
    if (!perms.has(r)) return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
  }
  return { ok: true, ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms } };
}
```
Verify the `permRows` query and `jsonError` signature against the real `_crm-authz.ts`; copy its exact form if it differs.

- [ ] **Step 2: Write the failing test.** Create `tests/marketing/audience-count.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/marketing-audience-count';
import { seedClientWithMarketing, enableMarketing, seedCrmCustomer, marketingRequest, demoteToL2 } from './_helpers';

describe('GET /api/marketing/audience-count', () => {
  it('401 unauthenticated', async () => {
    const res = await handler(new Request('http://localhost/api/marketing/audience-count?audience=all'));
    expect(res.status).toBe(401);
  });
  it('412 when marketing not enabled', async () => {
    const ctx = await seedClientWithMarketing();
    const res = await handler(marketingRequest(ctx, 'GET', '/api/marketing/audience-count?audience=all'));
    expect(res.status).toBe(412);
  });
  it('403 for L2 without view perm', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const l2 = await demoteToL2(ctx);
    const res = await handler(marketingRequest(l2, 'GET', '/api/marketing/audience-count?audience=all'));
    expect(res.status).toBe(403);
  });
  it('L1 owner gets the emailable count', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    await seedCrmCustomer(ctx.clientId, { email: `x-${Math.random().toString(36).slice(2)}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: null });
    const res = await handler(marketingRequest(ctx, 'GET', '/api/marketing/audience-count?audience=all'));
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `npx vitest run tests/marketing/audience-count.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `marketing-audience-count.ts`:**

```ts
import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { audienceCount, type Audience } from '../../src/modules/marketing/lib/audience';

export const config = { path: '/api/marketing/audience-count', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.view']);
  if (!a.ok) return a.res;
  const raw = new URL(req.url).searchParams.get('audience');
  const audience: Audience = raw === 'recent_30d' ? 'recent_30d' : 'all';
  const count = await audienceCount(db(), a.ctx.clientId, audience);
  return new Response(JSON.stringify({ audience, count }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 5: Run to verify it passes.** Run: `npx vitest run tests/marketing/audience-count.test.ts` → PASS (4 tests).

- [ ] **Step 6: Typecheck + commit.**
```bash
npm run typecheck
git add netlify/functions/_marketing-authz.ts netlify/functions/marketing-audience-count.ts tests/marketing/audience-count.test.ts
git commit -m "feat(marketing): _marketing-authz + audience-count endpoint"
```

---

### Task 5: Campaign create + list (`/api/marketing/campaigns`)

**Files:**
- Create: `netlify/functions/marketing-campaign-create.ts`
- Create: `netlify/functions/marketing-campaigns-list.ts`
- Test: `tests/marketing/campaigns.test.ts`

**Interfaces:**
- Consumes: `requireMarketing`, `db`, `jsonError`.
- Produces: `POST /api/marketing/campaigns {name,subject,body_html,audience}` → `{ campaign }` (draft); `GET /api/marketing/campaigns` → `{ campaigns: [...] }` ordered `created_at DESC`. Both share the path, discriminated by `config.method`.

- [ ] **Step 1: Write the failing test.** Create `tests/marketing/campaigns.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import createHandler from '../../netlify/functions/marketing-campaign-create';
import listHandler from '../../netlify/functions/marketing-campaigns-list';
import { seedClientWithMarketing, enableMarketing, marketingRequest } from './_helpers';

const draft = () => ({ name: `Promo ${Math.random().toString(36).slice(2, 7)}`, subject: 'Hi', body_html: '<p>Deal</p>', audience: 'all' });

describe('marketing campaigns create + list', () => {
  it('creates a draft campaign then lists it', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns', draft()));
    expect(c.status).toBe(200);
    const created = (await c.json()).campaign;
    expect(created.status).toBe('draft');

    const l = await listHandler(marketingRequest(ctx, 'GET', '/api/marketing/campaigns'));
    expect(l.status).toBe(200);
    const ids = (await l.json()).campaigns.map((x: { id: string }) => x.id);
    expect(ids).toContain(created.id);
  });

  it('400 on missing fields', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const res = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns', { name: '', subject: '', body_html: '' }));
    expect(res.status).toBe(400);
  });

  it('401 unauthenticated on list', async () => {
    const res = await listHandler(new Request('http://localhost/api/marketing/campaigns'));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `npx vitest run tests/marketing/campaigns.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement `marketing-campaign-create.ts`:**

```ts
import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';

export const config = { path: '/api/marketing/campaigns', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.create']);
  if (!a.ok) return a.res;
  const b = (await req.json().catch(() => ({}))) as { name?: string; subject?: string; body_html?: string; audience?: string };
  if (!b.name?.trim() || !b.subject?.trim() || !b.body_html?.trim()) return jsonError(400, 'invalid_input');
  const audience = b.audience === 'recent_30d' ? 'recent_30d' : 'all';
  const sql = db();
  const rows = (await sql`
    INSERT INTO public.marketing_campaigns (client_id, name, subject, body_html, audience, status, created_by_user_node)
    VALUES (${a.ctx.clientId}::uuid, ${b.name.trim()}, ${b.subject.trim()}, ${b.body_html}, ${audience}, 'draft', ${a.ctx.userNodeId}::uuid)
    RETURNING id, name, subject, body_html, audience, status, sent_at, created_at
  `) as any[];
  return new Response(JSON.stringify({ campaign: rows[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Implement `marketing-campaigns-list.ts`:**

```ts
import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';

export const config = { path: '/api/marketing/campaigns', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.view']);
  if (!a.ok) return a.res;
  const rows = await db()`
    SELECT id, name, subject, audience, status, sent_at, created_at
    FROM public.marketing_campaigns WHERE client_id = ${a.ctx.clientId}::uuid
    ORDER BY created_at DESC LIMIT 500
  `;
  return new Response(JSON.stringify({ campaigns: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 5: Run to verify it passes.** Run: `npx vitest run tests/marketing/campaigns.test.ts` → PASS (3 tests).

- [ ] **Step 6: Typecheck + commit.**
```bash
npm run typecheck
git add netlify/functions/marketing-campaign-create.ts netlify/functions/marketing-campaigns-list.ts tests/marketing/campaigns.test.ts
git commit -m "feat(marketing): campaign create + list endpoints (shared path, method-discriminated)"
```

---

### Task 6: Campaign detail (`/api/marketing/campaigns/:id`)

**Files:**
- Create: `netlify/functions/marketing-campaign-detail.ts`
- Test: `tests/marketing/campaign-detail.test.ts`

**Interfaces:**
- Consumes: `requireMarketing`, `db`, `jsonError`.
- Produces: `GET /api/marketing/campaigns/:id` → `{ campaign, sends }` (sends = `campaign_sends` for it, newest first).

- [ ] **Step 1: Write the failing test.** Create `tests/marketing/campaign-detail.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import detailHandler from '../../netlify/functions/marketing-campaign-detail';
import createHandler from '../../netlify/functions/marketing-campaign-create';
import { seedClientWithMarketing, enableMarketing, marketingRequest } from './_helpers';

describe('GET /api/marketing/campaigns/:id', () => {
  it('returns the campaign with an (empty) sends array', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns',
      { name: 'N', subject: 'S', body_html: '<p>x</p>', audience: 'all' }));
    const id = (await c.json()).campaign.id;
    const res = await detailHandler(marketingRequest(ctx, 'GET', `/api/marketing/campaigns/${id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.campaign.id).toBe(id);
    expect(Array.isArray(body.sends)).toBe(true);
  });
  it('404 for unknown id', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const res = await detailHandler(marketingRequest(ctx, 'GET', '/api/marketing/campaigns/00000000-0000-0000-0000-000000000000'));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** → FAIL. Run: `npx vitest run tests/marketing/campaign-detail.test.ts`

- [ ] **Step 3: Implement `marketing-campaign-detail.ts`:**

```ts
import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';

export const config = { path: '/api/marketing/campaigns/:id', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.view']);
  if (!a.ok) return a.res;
  const id = new URL(req.url).pathname.split('/').pop()!;
  const sql = db();
  const rows = (await sql`
    SELECT id, name, subject, body_html, audience, status, sent_at, created_at
    FROM public.marketing_campaigns WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  const sends = await sql`
    SELECT id, recipient_email, status, provider_id, error, created_at
    FROM public.campaign_sends WHERE campaign_id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    ORDER BY created_at DESC LIMIT 1000
  `;
  return new Response(JSON.stringify({ campaign: rows[0], sends }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run to verify it passes.** → PASS (2 tests).

- [ ] **Step 5: Typecheck + commit.**
```bash
npm run typecheck
git add netlify/functions/marketing-campaign-detail.ts tests/marketing/campaign-detail.test.ts
git commit -m "feat(marketing): campaign detail endpoint (campaign + sends log)"
```

---

### Task 7: Send-now fan-out (`/api/marketing/send`)

**Files:**
- Create: `netlify/functions/marketing-campaign-send.ts`
- Test: `tests/marketing/send.test.ts`

**Interfaces:**
- Consumes: `requireMarketing`, `db`, `jsonError`, `audienceRecipients`, `deliver` from `_shared/resend`.
- Produces: `POST /api/marketing/send {campaign_id}` → `{ sent, byStatus }`; flips campaign to `sent`; inserts `campaign_sends`.

- [ ] **Step 1: Write the failing test.** Create `tests/marketing/send.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import sendHandler from '../../netlify/functions/marketing-campaign-send';
import createHandler from '../../netlify/functions/marketing-campaign-create';
import { seedClientWithMarketing, enableMarketing, seedCrmCustomer, marketingRequest, sqlClient } from './_helpers';

const sql = sqlClient();

describe('POST /api/marketing/send', () => {
  it('fans out to emailable audience, logs sends, flips to sent; re-send 409', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    await seedCrmCustomer(ctx.clientId, { email: `s1-${Math.random().toString(36).slice(2)}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: `s2-${Math.random().toString(36).slice(2)}@x.com` });
    await seedCrmCustomer(ctx.clientId, { email: null }); // excluded
    const c = await createHandler(marketingRequest(ctx, 'POST', '/api/marketing/campaigns',
      { name: 'Blast', subject: 'Hello', body_html: '<p>Deal</p>', audience: 'all' }));
    const id = (await c.json()).campaign.id;

    const res = await sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: id }));
    expect(res.status).toBe(200);
    expect((await res.json()).sent).toBe(2); // only emailable

    const sends = (await sql`SELECT status FROM public.campaign_sends WHERE campaign_id = ${id}`) as { status: string }[];
    expect(sends).toHaveLength(2);
    expect(sends.every((s) => s.status === 'logged')).toBe(true); // no RESEND_API_KEY in tests

    const camp = (await sql`SELECT status FROM public.marketing_campaigns WHERE id = ${id}`) as { status: string }[];
    expect(camp[0].status).toBe('sent');

    const again = await sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: id }));
    expect(again.status).toBe(409);
  });

  it('404 for unknown campaign', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const res = await sendHandler(marketingRequest(ctx, 'POST', '/api/marketing/send', { campaign_id: '00000000-0000-0000-0000-000000000000' }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** → FAIL. Run: `npx vitest run tests/marketing/send.test.ts`

- [ ] **Step 3: Implement `marketing-campaign-send.ts`:**

```ts
import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';
import { audienceRecipients, type Audience } from '../../src/modules/marketing/lib/audience';
import { deliver } from './_shared/resend';

export const config = { path: '/api/marketing/send', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.edit']);
  if (!a.ok) return a.res;
  const b = (await req.json().catch(() => ({}))) as { campaign_id?: string };
  if (!b.campaign_id) return jsonError(400, 'invalid_input');
  const sql = db();
  const rows = (await sql`
    SELECT id, subject, body_html, audience, status FROM public.marketing_campaigns
    WHERE id = ${b.campaign_id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `) as Array<{ id: string; subject: string; body_html: string; audience: Audience; status: string }>;
  const c = rows[0];
  if (!c) return jsonError(404, 'not_found');
  if (c.status !== 'draft') return jsonError(409, 'already_sent');

  const from = process.env.MAIL_FROM ?? 'notifications@example.com';
  const recipients = await audienceRecipients(sql, a.ctx.clientId, c.audience);
  const byStatus = { sent: 0, logged: 0, failed: 0 };
  for (const r of recipients) {
    const res = await deliver({ to: r.email, from, subject: c.subject, html: c.body_html });
    const status = res.delivered ? 'sent' : res.ok ? 'logged' : 'failed';
    byStatus[status as keyof typeof byStatus]++;
    await sql`
      INSERT INTO public.campaign_sends (client_id, campaign_id, customer_id, recipient_email, status, provider_id, error)
      VALUES (${a.ctx.clientId}::uuid, ${c.id}::uuid, ${r.id}::uuid, ${r.email}, ${status}, ${res.providerId ?? null}, ${res.error ?? null})
    `;
  }
  await sql`UPDATE public.marketing_campaigns SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = ${c.id}::uuid`;
  return new Response(JSON.stringify({ sent: recipients.length, byStatus }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 4: Run to verify it passes.** → PASS (2 tests). If a send status isn't `logged`, confirm `RESEND_API_KEY` is unset in `.env`.

- [ ] **Step 5: Typecheck + commit.**
```bash
npm run typecheck
git add netlify/functions/marketing-campaign-send.ts tests/marketing/send.test.ts
git commit -m "feat(marketing): send-now fan-out via deliver() + campaign_sends log"
```

---

### Task 8: Frontend foundation — api, format, permissions, route mounts

**Files:**
- Create: `src/modules/marketing/api.ts`
- Create: `src/modules/marketing/format.ts`
- Create: `src/modules/marketing/shared/permissions.ts`
- Create: `src/modules/marketing/MarketingRouteMounts.tsx`
- Create stubs: `src/modules/marketing/vendor/{CampaignsListPage,CampaignComposePage,CampaignDetailPage}.tsx`

**Interfaces:**
- Produces: `marketingApi` (`listCampaigns`, `getCampaign`, `createCampaign`, `audienceCount`, `send`) + types `Campaign`, `CampaignSend`, `CampaignDetail`, `AudienceCount`; mounts `MarketingListMount`, `MarketingComposeMount`, `MarketingDetailMount`.

- [ ] **Step 1: Create `src/modules/marketing/api.ts`** (mirror `src/modules/crm/api.ts` throw-on-error shape):

```ts
export class MarketingApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly details?: unknown) {
    super(code); this.name = 'MarketingApiError';
  }
}
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    let code = 'unknown'; let details: unknown;
    try { const b = await res.json(); code = b?.error?.code ?? code; details = b?.error?.details; } catch { /* noop */ }
    throw new MarketingApiError(res.status, code, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export type Audience = 'all' | 'recent_30d';
export interface Campaign { id: string; name: string; subject: string; body_html?: string; audience: Audience; status: 'draft' | 'sent'; sent_at: string | null; created_at: string; }
export interface CampaignSend { id: string; recipient_email: string; status: 'sent' | 'logged' | 'failed'; provider_id: string | null; error: string | null; created_at: string; }
export interface CampaignDetail { campaign: Campaign; sends: CampaignSend[]; }
export interface AudienceCount { audience: Audience; count: number; }

export const marketingApi = {
  listCampaigns: () => call<{ campaigns: Campaign[] }>('/api/marketing/campaigns'),
  getCampaign: (id: string) => call<CampaignDetail>(`/api/marketing/campaigns/${id}`),
  createCampaign: (body: { name: string; subject: string; body_html: string; audience: Audience }) =>
    call<{ campaign: Campaign }>('/api/marketing/campaigns', json('POST', body)),
  audienceCount: (audience: Audience) => call<AudienceCount>(`/api/marketing/audience-count?audience=${audience}`),
  send: (campaign_id: string) => call<{ sent: number; byStatus: Record<string, number> }>('/api/marketing/send', json('POST', { campaign_id })),
};
```

- [ ] **Step 2: Create `src/modules/marketing/format.ts`:**
```ts
export const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
```

- [ ] **Step 3: Create `src/modules/marketing/shared/permissions.ts`** (mirror `src/modules/crm/shared/permissions.ts`):
```ts
export function isOwnerLevel(levelNumber: number | null | undefined): boolean {
  return levelNumber == null || levelNumber === 1;
}
export function canViewMarketing(perms: Record<string, boolean>, levelNumber: number | null | undefined): boolean {
  return isOwnerLevel(levelNumber) || perms['marketing.customers.view'] === true;
}
```

- [ ] **Step 4: Create the three stub pages** so the mounts typecheck (real bodies land in Tasks 10–12). Each file, e.g. `src/modules/marketing/vendor/CampaignsListPage.tsx`:
```tsx
export function CampaignsListPage(_: { slug: string; perms: ReadonlySet<string> }) { return null; }
```
Do the same for `CampaignComposePage` and `CampaignDetailPage` (same signature, matching export name).

- [ ] **Step 5: Create `src/modules/marketing/MarketingRouteMounts.tsx`** (mirror `src/modules/crm/CrmRouteMounts.tsx` — read the real file and match its exact `useUserAuth` destructure incl. `client`, `useMemo`, gate order):

```tsx
import { Navigate, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { useUserAuth } from '../user-portal/user-auth-context';
import { CampaignsListPage } from './vendor/CampaignsListPage';
import { CampaignComposePage } from './vendor/CampaignComposePage';
import { CampaignDetailPage } from './vendor/CampaignDetailPage';

const ALL_MARKETING_PERMS = ['marketing.customers.view', 'marketing.customers.create', 'marketing.customers.edit', 'marketing.customers.delete'];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo<ReadonlySet<string>>(
    () => (isOwner ? new Set(ALL_MARKETING_PERMS) : new Set(Object.entries(permissions ?? {}).filter(([, v]) => v === true).map(([k]) => k))),
    [permissions, isOwner],
  );
  const enabled = enabledModules.some((m: { key: string }) => m.key === 'marketing');
  return { user, client, loading, slug: slug ?? '', perms, enabled };
}

function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => JSX.Element) {
  return function Mount() {
    const { user, client, loading, slug, perms, enabled } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!enabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render(slug, perms);
  };
}

export const MarketingListMount = gate('marketing.customers.view', (slug, perms) => <CampaignsListPage slug={slug} perms={perms} />);
export const MarketingComposeMount = gate('marketing.customers.create', (slug, perms) => <CampaignComposePage slug={slug} perms={perms} />);
export const MarketingDetailMount = gate('marketing.customers.view', (slug, perms) => <CampaignDetailPage slug={slug} perms={perms} />);
```

- [ ] **Step 6: Typecheck + commit.**
```bash
npm run typecheck
git add src/modules/marketing/api.ts src/modules/marketing/format.ts src/modules/marketing/shared src/modules/marketing/MarketingRouteMounts.tsx src/modules/marketing/vendor
git commit -m "feat(marketing): FE foundation — api, format, permissions, route mounts"
```

---

### Task 9: Frontend wiring — router, sidebar nav, CSS

**Files:**
- Modify: `src/lib/router.tsx`
- Modify: `src/modules/user-portal/nav/useNavItems.ts`
- Modify: `src/modules/user-portal/layout/Sidebar.tsx`
- Modify: `src/lib/components.css`

**Interfaces:**
- Consumes: the three mounts (Task 8). Produces routes `/c/:slug/marketing`, `/marketing/new`, `/marketing/:id`; a gated sidebar link; `.mkt-*` CSS.

- [ ] **Step 1: Add routes.** In `src/lib/router.tsx`, import `{ MarketingListMount, MarketingComposeMount, MarketingDetailMount } from '../modules/marketing/MarketingRouteMounts';` near the CRM mount import. In the `/c/:slug` authed children array beside the `crm` routes add:
```tsx
{ path: 'marketing', element: <MarketingListMount /> },
{ path: 'marketing/new', element: <MarketingComposeMount /> },
{ path: 'marketing/:id', element: <MarketingDetailMount /> },
```
(`marketing/new` before `marketing/:id` — react-router ranks the static segment higher regardless, but keep this order for clarity.)

- [ ] **Step 2: Dedicated nav.** In `src/modules/user-portal/nav/useNavItems.ts`, add `'marketing'` to the `MODULES_WITH_DEDICATED_NAV` set.

- [ ] **Step 3: Sidebar link.** In `src/modules/user-portal/layout/Sidebar.tsx`, beside the `crm` gate add:
```tsx
const marketingEnabled = enabledModules.some((m) => m.key === 'marketing');
const showMarketing = marketingEnabled && (isOwner || permissions['marketing.customers.view'] === true);
```
Add `showMarketing` to the Modules-group visibility guard, and add the NavLink beside the CRM one (match its exact props — no extra `className`):
```tsx
{showMarketing && (<NavLink to={`/c/${slug}/marketing`}>Marketing</NavLink>)}
```

- [ ] **Step 4: CSS.** Append to `src/lib/components.css`:
```css
/* Marketing module */
.mkt-compose { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.mkt-preview { border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 12px; min-height: 160px; background: #fff; }
.mkt-count { font-size: 13px; color: var(--text-muted, #6b7280); margin: 6px 0; }
.mkt-status { font-size: 11px; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: var(--muted-bg, #f3f4f6); }
```

- [ ] **Step 5: Verify.** Run: `npm run typecheck` (zero errors) then `npx vite build` (must succeed).

- [ ] **Step 6: Commit.**
```bash
git add src/lib/router.tsx src/modules/user-portal/nav/useNavItems.ts src/modules/user-portal/layout/Sidebar.tsx src/lib/components.css
git commit -m "feat(marketing): wire routes, sidebar nav, and CSS"
```

---

### Task 10: `CampaignsListPage`

**Files:**
- Modify (replace stub): `src/modules/marketing/vendor/CampaignsListPage.tsx`

**Interfaces:**
- Consumes: `marketingApi`, `Campaign`, `dateTime`.

- [ ] **Step 1: Implement the page.** Replace `src/modules/marketing/vendor/CampaignsListPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { marketingApi, type Campaign } from '../api';
import { dateTime } from '../format';

export function CampaignsListPage({ slug }: { slug: string; perms: ReadonlySet<string> }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marketingApi.listCampaigns().then((r) => setCampaigns(r.campaigns)).catch(() => { setError('Could not load campaigns.'); setCampaigns([]); });
  }, []);

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Campaigns</h1>
        <Link className="btn" to={`/c/${slug}/marketing/new`}>New campaign</Link>
      </div>
      {error && <div className="error">{error}</div>}
      {campaigns === null && <div className="muted">Loading…</div>}
      {campaigns !== null && campaigns.length === 0 && !error && (
        <div className="pm-empty">No campaigns yet. Create your first one.</div>
      )}
      {campaigns !== null && campaigns.length > 0 && (
        <table className="pm-table">
          <thead><tr><th>Name</th><th>Audience</th><th>Status</th><th>Sent</th></tr></thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/c/${slug}/marketing/${c.id}`}>{c.name}</Link></td>
                <td>{c.audience === 'recent_30d' ? 'Recent (30d)' : 'All'}</td>
                <td><span className="mkt-status">{c.status}</span></td>
                <td>{c.sent_at ? dateTime(c.sent_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify.** Run: `npm run typecheck && npx vite build` → both PASS. (Swap any missing CSS class for one present in `components.css`.)

- [ ] **Step 3: Commit.**
```bash
git add src/modules/marketing/vendor/CampaignsListPage.tsx
git commit -m "feat(marketing): campaigns list page with empty/loading/error states"
```

---

### Task 11: `CampaignComposePage` (form + live preview + live audience count)

**Files:**
- Modify (replace stub): `src/modules/marketing/vendor/CampaignComposePage.tsx`

**Interfaces:**
- Consumes: `marketingApi`, `Audience`; `useNavigate`.

- [ ] **Step 1: Implement the page.** Replace `src/modules/marketing/vendor/CampaignComposePage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { marketingApi, type Audience } from '../api';

export function CampaignComposePage({ slug }: { slug: string; perms: ReadonlySet<string> }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('<p>Hello!</p>');
  const [audience, setAudience] = useState<Audience>('all');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setCount(null);
    marketingApi.audienceCount(audience).then((r) => { if (live) setCount(r.count); }).catch(() => { if (live) setCount(null); });
    return () => { live = false; };
  }, [audience]);

  async function saveDraft() {
    if (!name.trim() || !subject.trim() || !bodyHtml.trim()) { setError('Name, subject and body are required.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await marketingApi.createCampaign({ name: name.trim(), subject: subject.trim(), body_html: bodyHtml, audience });
      nav(`/c/${slug}/marketing/${r.campaign.id}`);
    } catch { setError('Could not save the campaign.'); setBusy(false); }
  }

  return (
    <div className="page">
      <Link to={`/c/${slug}/marketing`}>← Campaigns</Link>
      <h1 className="page-title">New campaign</h1>
      {error && <div className="error">{error}</div>}
      <div className="mkt-compose">
        <div>
          <label>Name<br /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring promo" /></label>
          <p><label>Subject<br /><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="20% off this week" /></label></p>
          <p><label>Audience<br />
            <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
              <option value="all">All customers</option>
              <option value="recent_30d">Seen in last 30 days</option>
            </select></label></p>
          <div className="mkt-count">{count === null ? 'Counting audience…' : `${count} emailable customer${count === 1 ? '' : 's'} will receive this`}</div>
          <p><label>Body (HTML)<br /><textarea rows={10} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} style={{ width: '100%' }} /></label></p>
          <button className="btn" onClick={saveDraft} disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
        </div>
        <div>
          <div className="muted">Preview</div>
          <div className="mkt-preview" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify.** Run: `npm run typecheck && npx vite build` → both PASS.

- [ ] **Step 3: Commit.**
```bash
git add src/modules/marketing/vendor/CampaignComposePage.tsx
git commit -m "feat(marketing): compose page — form, live HTML preview, live audience count"
```

---

### Task 12: `CampaignDetailPage` (send + sends log)

**Files:**
- Modify (replace stub): `src/modules/marketing/vendor/CampaignDetailPage.tsx`

**Interfaces:**
- Consumes: `marketingApi`, `CampaignDetail`; `useParams`.

- [ ] **Step 1: Implement the page.** Replace `src/modules/marketing/vendor/CampaignDetailPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { marketingApi, type CampaignDetail } from '../api';
import { dateTime } from '../format';

export function CampaignDetailPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const { id = '' } = useParams();
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canSend = perms.has('marketing.customers.edit');

  async function load() {
    try { setError(null); setData(await marketingApi.getCampaign(id)); }
    catch { setError('Could not load this campaign.'); }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setBusy(true); setError(null);
    try { await marketingApi.send(id); await load(); }
    catch { setError('Send failed.'); } finally { setBusy(false); }
  }

  if (error && !data) return <div className="page"><Link to={`/c/${slug}/marketing`}>← Campaigns</Link><div className="error">{error}</div></div>;
  if (!data) return <div className="page"><div className="muted">Loading…</div></div>;
  const { campaign, sends } = data;

  return (
    <div className="page">
      <Link to={`/c/${slug}/marketing`}>← Campaigns</Link>
      <h1 className="page-title">{campaign.name}</h1>
      <p className="muted">Subject: {campaign.subject} · Audience: {campaign.audience === 'recent_30d' ? 'Recent (30d)' : 'All'} · <span className="mkt-status">{campaign.status}</span></p>
      {error && <div className="error">{error}</div>}
      <div className="mkt-preview" dangerouslySetInnerHTML={{ __html: campaign.body_html ?? '' }} />

      {campaign.status === 'draft' && canSend && (
        <p><button className="btn" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send now'}</button></p>
      )}

      <h2>Send log</h2>
      {sends.length === 0 ? <div className="pm-empty">{campaign.status === 'draft' ? 'Not sent yet.' : 'No sends recorded.'}</div> : (
        <table className="pm-table">
          <thead><tr><th>Recipient</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {sends.map((s) => (
              <tr key={s.id}><td>{s.recipient_email}</td><td><span className="mkt-status">{s.status}</span></td><td>{dateTime(s.created_at)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify.** Run: `npm run typecheck && npx vite build` → both PASS.

- [ ] **Step 3: Commit.**
```bash
git add src/modules/marketing/vendor/CampaignDetailPage.tsx
git commit -m "feat(marketing): campaign detail page — send now + sends log"
```

---

### Task 13: Seed script for `papa-s-saloon`

**Files:**
- Create: `scripts/seed-marketing.ts`
- Modify: `package.json` (add `"seed:marketing"`)

**Interfaces:**
- Produces: `npm run seed:marketing` — enables the `marketing` product for `papa-s-saloon` and seeds 1 draft + 1 sent campaign (with a few `campaign_sends`).

- [ ] **Step 1: Create `scripts/seed-marketing.ts`:**

```ts
#!/usr/bin/env tsx
import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  const c = (await sql`SELECT id FROM public.clients WHERE slug = 'papa-s-saloon' LIMIT 1`) as Array<{ id: string }>;
  if (!c[0]) throw new Error('demo tenant papa-s-saloon not found');
  const clientId = c[0].id;

  const admin = (await sql`SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1`) as Array<{ id: string }>;
  await sql`INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
            VALUES (${clientId}, 'marketing', ${admin[0]?.id ?? null}) ON CONFLICT (client_id, product_key) DO NOTHING`;

  // A draft campaign
  await sql`INSERT INTO public.marketing_campaigns (client_id, name, subject, body_html, audience, status)
            VALUES (${clientId}, 'Weekend Special', '20% off all services this weekend',
                    '<h2>Weekend Special</h2><p>Book now and save 20%.</p>', 'all', 'draft')`;

  // A sent campaign + a couple of send-log rows (from real emailable crm_customers if any)
  const sent = (await sql`INSERT INTO public.marketing_campaigns (client_id, name, subject, body_html, audience, status, sent_at)
            VALUES (${clientId}, 'New Year Greetings', 'Happy New Year from Papa''s Saloon',
                    '<p>Wishing you a great year!</p>', 'all', 'sent', now()) RETURNING id`) as Array<{ id: string }>;
  const custs = (await sql`SELECT id, email FROM public.crm_customers WHERE client_id = ${clientId} AND email IS NOT NULL LIMIT 3`) as Array<{ id: string; email: string }>;
  for (const cust of custs) {
    await sql`INSERT INTO public.campaign_sends (client_id, campaign_id, customer_id, recipient_email, status)
              VALUES (${clientId}, ${sent[0]!.id}, ${cust.id}, ${cust.email}, 'logged')`;
  }
  console.log(`✓ Marketing enabled + seeded 2 campaigns (${custs.length} send-log rows) for papa-s-saloon (${clientId})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script.** In `package.json` `"scripts"`, add `"seed:marketing": "tsx --env-file=.env scripts/seed-marketing.ts"`.

- [ ] **Step 3: Run it.** Run: `npm run seed:marketing`
Expected: `✓ Marketing enabled + seeded 2 campaigns (N send-log rows) for papa-s-saloon`.

- [ ] **Step 4: Commit.**
```bash
git add scripts/seed-marketing.ts package.json
git commit -m "feat(marketing): seed-marketing — enable product + demo campaigns for papa-s-saloon"
```

---

### Task 14: Full verification + handoff

**Files:** Create `docs/superpowers/handoffs/2026-07-04-marketing-module.md`.

- [ ] **Step 1: Typecheck.** Run: `npm run typecheck` → zero errors.
- [ ] **Step 2: Full suite.** Run: `npx vitest run` → ALL green (existing + `tests/marketing/*` + `src/modules/registry/__tests__/marketing-registry.test.ts`). Fix regressions before proceeding.
- [ ] **Step 3: Build.** Run: `npx vite build` → PASS.
- [ ] **Step 4: Golden-flow smoke.** `npx netlify dev --port 5193 --target-port 8903` (start `vite --port 8903 --strictPort` first if the target-port handshake times out — sibling worktrees occupy 5173). As the `papa-s-saloon` owner: open `/c/papa-s-saloon/marketing` → New campaign → see audience count → Save draft → Send now → the send log shows entries. Verify no 500s and empty/loading/error states. (An API smoke through `netlify dev` with a minted `bu_session` cookie is an acceptable substitute if the browser UI isn't available.)
- [ ] **Step 5: Handoff.** Write `docs/superpowers/handoffs/2026-07-04-marketing-module.md`: branch, HEAD SHA, migration 060, new function names + routes, env vars (none new; live send reuses `RESEND_API_KEY` + `MAIL_FROM`), the CRM/Email dependency + prod migration-ordering note, and gotchas.
- [ ] **Step 6: Commit.**
```bash
git add docs/superpowers/handoffs
git commit -m "docs(marketing): handoff — Marketing Automation v1 complete, migration 060"
```

---

## Self-Review

**Spec coverage:** §3 tables → Task 1. §7 registry+authz → Tasks 2, 4. §4 audience → Task 3. §5 send → Task 7. §6 endpoints → Tasks 4–7. §8 FE → Tasks 8–12. §9 seed/tests/verify → Tasks 3–7, 13, 14. §2 send-seam (`deliver`) → Task 7. §10 checklist → enforced across tasks. §11 open items → all resolved pre-plan (RESEND_API_KEY absent in `.env`; `deliver` signature confirmed; MAIL_FROM default).

**Placeholder scan:** No "TBD"/"handle errors" — every code step has real code. "Confirm against the real `_crm-authz.ts`" notes are concrete verification steps with a fallback.

**Type consistency:** `audienceRecipients`/`audienceCount`/`Audience` (Task 3) consumed identically in Tasks 4, 7. `requireMarketing`/`MarketingAuthCtx` (Task 4) used verbatim in Tasks 4–7. `marketingApi`/`Campaign`/`CampaignDetail`/`CampaignSend` (Task 8) consumed in Tasks 10–12. Perm keys are the same four `marketing.customers.*` strings in authz, mounts, sidebar, endpoints. `campaign_sends.status` values (`sent`/`logged`/`failed`) match the send handler's mapping and the migration CHECK.
