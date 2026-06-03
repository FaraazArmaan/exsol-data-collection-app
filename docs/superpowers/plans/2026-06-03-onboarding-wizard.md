# Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `AddClientModal` with a 6-step linear stepper wizard that collects all client-setup data and submits to a single transactional server endpoint, eliminating the 9-step manual onboarding flow.

**Architecture:** New `POST /api/onboard-client` endpoint accepts a single body with all 6 sections and executes every insert in one Postgres transaction (`sql.transaction([...])`). Roles/levels/cardinality reference each other by `key` / `level_number` (not UUIDs, which don't exist until the txn creates rows). Client side: `OnboardClientWizard` shell + 6 step components + `Stepper` progress bar + a typed reducer in `state.ts`. Auto-seed fills in `owner` role + `Primary` level when admin skips those steps, preserving a 2-click "just give me a working client" path.

**Tech Stack:** TypeScript everywhere. React 18 + react-router-dom. Netlify Functions + Neon (Postgres). Zod for body validation. Vitest for tests. Argon2 for password hashing (existing). Builds on [2026-06-03-onboarding-wizard-design.md](../specs/2026-06-03-onboarding-wizard-design.md).

---

## File map

**New files:**
- `netlify/functions/onboard-client.ts` — transactional endpoint.
- `src/modules/ams/components/onboarding/OnboardClientWizard.tsx` — wizard modal shell.
- `src/modules/ams/components/onboarding/Stepper.tsx` — top progress bar.
- `src/modules/ams/components/onboarding/state.ts` — reducer + state types + per-step validators + auto-seed + Owner-role resolver.
- `src/modules/ams/components/onboarding/steps/NameStep.tsx`
- `src/modules/ams/components/onboarding/steps/ProductsStep.tsx`
- `src/modules/ams/components/onboarding/steps/RolesStep.tsx`
- `src/modules/ams/components/onboarding/steps/LevelsStep.tsx`
- `src/modules/ams/components/onboarding/steps/CardinalityStep.tsx`
- `src/modules/ams/components/onboarding/steps/OwnerStep.tsx`
- `src/modules/ams/components/onboarding/steps/SuccessStep.tsx`
- `tests/integration/onboard-client.test.ts` — endpoint integration tests.
- `tests/unit/onboard-wizard-state.test.ts` — reducer + validators + auto-seed.

**Modified files:**
- `src/modules/ams/api.ts` — add `onboardClient(body)` wrapper.
- `src/modules/ams/pages/AdminDashboard.tsx` — swap `AddClientModal` → `OnboardClientWizard`.

**Deleted files (only if grep shows zero remaining consumers):**
- `src/modules/ams/components/AddClientModal.tsx`

**No DB migration. No new dependencies.**

---

## Pre-flight (every task)

```bash
npm run typecheck && npm test
```

Both green before commit. Saved feedback `feedback_implementer_verify_typecheck` is binding.

---

# Task 1: Server endpoint `/api/onboard-client` + integration tests

The transactional endpoint. This is the biggest task — write tests first, implement, verify.

**Files:**
- Create: `netlify/functions/onboard-client.ts`
- Create: `tests/integration/onboard-client.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/onboard-client.test.ts`. Model the setup on `tests/integration/clients-lifecycle.test.ts` (the admin login + cookie pattern). Tests:

```typescript
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import onboardClientHandler from '../../netlify/functions/onboard-client';

const ADMIN_EMAIL = 'onboard-test@example.com';
const ADMIN_PASSWORD = 'onboard-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
const createdClients: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Onboard Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, display_name = 'Onboard Test Admin'
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
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

function fullBody(name: string) {
  const uniqEmail = `owner-${Date.now()}-${Math.floor(Math.random()*1e6)}@example.com`;
  return {
    name,
    enabled_products: ['saloon-booking'],
    roles: [
      { key: 'owner', label: 'Owner', color: '#3b82f6' },
      { key: 'staff', label: 'Staff', color: '#22c55e' },
    ],
    levels: [
      { level_number: 1, label: 'Primary', allowed_role_keys: ['owner'] },
      { level_number: 2, label: 'Secondary', allowed_role_keys: ['staff'] },
    ],
    cardinality_rules: [
      { parent_role_key: null, child_role_key: 'owner', max_children: 1 },
      { parent_role_key: 'owner', child_role_key: 'staff', max_children: 10 },
    ],
    owner: {
      display_name: 'Owner User',
      email: uniqEmail,
      temp_password: 'onboard-temp-pw-1',
    },
  };
}

async function call(body: unknown) {
  return onboardClientHandler(
    new Request('http://localhost/api/onboard-client', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(body),
    }), CTX,
  );
}

describe('onboard-client', () => {
  test('happy path creates client + products + roles + levels + cardinality + owner + credential', async () => {
    const body = fullBody(`Onboard Happy ${Date.now()}`);
    const r = await call(body);
    expect(r.status).toBe(201);
    const out = await r.json() as { client: { id: string; slug: string; name: string } };
    createdClients.push(out.client.id);
    expect(out.client.name).toBe(body.name);
    expect(out.client.slug).toMatch(/^onboard-happy-/);

    // Verify all FKs landed.
    const c = (await sql`SELECT id FROM public.clients WHERE id = ${out.client.id}::uuid`) as unknown[];
    expect(c.length).toBe(1);
    const enabled = (await sql`SELECT product_key FROM public.client_enabled_products WHERE client_id = ${out.client.id}::uuid`) as { product_key: string }[];
    expect(enabled.map((p) => p.product_key)).toEqual(['saloon-booking']);
    const roles = (await sql`SELECT key, label FROM public.client_roles WHERE client_id = ${out.client.id}::uuid ORDER BY key`) as { key: string; label: string }[];
    expect(roles.length).toBe(2);
    expect(roles.find((r) => r.key === 'owner')?.label).toBe('Owner');
    const levels = (await sql`SELECT level_number FROM public.client_levels WHERE client_id = ${out.client.id}::uuid ORDER BY level_number`) as { level_number: number }[];
    expect(levels.map((l) => l.level_number)).toEqual([1, 2]);
    const card = (await sql`SELECT max_children FROM public.client_cardinality_rules WHERE client_id = ${out.client.id}::uuid ORDER BY max_children`) as { max_children: number }[];
    expect(card.length).toBe(2);
    const nodes = (await sql`SELECT display_name, email, level_number FROM public.user_nodes WHERE client_id = ${out.client.id}::uuid`) as { display_name: string; email: string; level_number: number }[];
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.display_name).toBe(body.owner.display_name);
    expect(nodes[0]!.level_number).toBe(1);
    const cred = (await sql`SELECT must_change_password, temp_password_plain FROM public.user_node_credentials WHERE client_id = ${out.client.id}::uuid`) as { must_change_password: boolean; temp_password_plain: string }[];
    expect(cred[0]!.must_change_password).toBe(true);
    expect(cred[0]!.temp_password_plain).toBe(body.owner.temp_password);
  });

  test('minimum body (auto-seed roles + levels) creates working client', async () => {
    const uniqEmail = `min-${Date.now()}@example.com`;
    const r = await call({
      name: `Onboard Min ${Date.now()}`,
      enabled_products: [],
      roles: [],
      levels: [],
      cardinality_rules: [],
      owner: { display_name: 'Min Owner', email: uniqEmail, temp_password: 'min-pw-1234' },
    });
    expect(r.status).toBe(201);
    const out = await r.json() as { client: { id: string } };
    createdClients.push(out.client.id);
    const roles = (await sql`SELECT key FROM public.client_roles WHERE client_id = ${out.client.id}::uuid`) as { key: string }[];
    expect(roles.map((r) => r.key)).toEqual(['owner']);
    const levels = (await sql`SELECT level_number FROM public.client_levels WHERE client_id = ${out.client.id}::uuid`) as { level_number: number }[];
    expect(levels.map((l) => l.level_number)).toEqual([1]);
    const nodes = (await sql`SELECT level_number FROM public.user_nodes WHERE client_id = ${out.client.id}::uuid`) as { level_number: number }[];
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.level_number).toBe(1);
  });

  test('invalid_reference rolls back — level allowed_role_keys references nonexistent role', async () => {
    const before = (await sql`SELECT count(*)::int AS c FROM public.clients`) as { c: number }[];
    const r = await call({
      name: `Onboard Bad Ref ${Date.now()}`,
      enabled_products: [],
      roles: [{ key: 'owner', label: 'Owner', color: '#3b82f6' }],
      levels: [{ level_number: 1, allowed_role_keys: ['nonexistent'] }],
      cardinality_rules: [],
      owner: { display_name: 'X', email: `bad-${Date.now()}@example.com`, temp_password: 'bad-pw-1234' },
    });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string; details: { section: string } } };
    expect(body.error.code).toBe('invalid_reference');
    expect(body.error.details.section).toBe('levels');
    const after = (await sql`SELECT count(*)::int AS c FROM public.clients`) as { c: number }[];
    expect(after[0]!.c).toBe(before[0]!.c); // no client row leaked
  });

  test('cardinality_violation rolls back — rule + owner conflict', async () => {
    const before = (await sql`SELECT count(*)::int AS c FROM public.clients`) as { c: number }[];
    const r = await call({
      name: `Onboard Card Viol ${Date.now()}`,
      enabled_products: [],
      roles: [{ key: 'owner', label: 'Owner', color: '#3b82f6' }],
      levels: [{ level_number: 1, allowed_role_keys: ['owner'] }],
      // Cap = 0 owners at top, then try to seed one.
      cardinality_rules: [{ parent_role_key: null, child_role_key: 'owner', max_children: 0 }],
      owner: { display_name: 'X', email: `cv-${Date.now()}@example.com`, temp_password: 'cv-pw-1234' },
    });
    expect(r.status).toBe(409);
    const body = await r.json() as { error: { code: string; details: { section: string } } };
    expect(body.error.code).toBe('cardinality_violation');
    expect(body.error.details.section).toBe('owner');
    const after = (await sql`SELECT count(*)::int AS c FROM public.clients`) as { c: number }[];
    expect(after[0]!.c).toBe(before[0]!.c);
  });

  test('admin attribution: created_by_admin set on client + user_node + credential', async () => {
    const r = await call(fullBody(`Onboard Attrib ${Date.now()}`));
    expect(r.status).toBe(201);
    const out = await r.json() as { client: { id: string } };
    createdClients.push(out.client.id);
    const node = (await sql`SELECT created_by_admin FROM public.user_nodes WHERE client_id = ${out.client.id}::uuid`) as { created_by_admin: string | null }[];
    const cred = (await sql`SELECT created_by_admin FROM public.user_node_credentials WHERE client_id = ${out.client.id}::uuid`) as { created_by_admin: string | null }[];
    expect(node[0]!.created_by_admin).not.toBeNull();
    expect(cred[0]!.created_by_admin).not.toBeNull();
  });

  test('non-admin (no cookie) → 401 unauthorized', async () => {
    const r = await onboardClientHandler(
      new Request('http://localhost/api/onboard-client', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullBody('No Auth')),
      }), CTX,
    );
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests, verify all fail**

```bash
npm test -- tests/integration/onboard-client.test.ts
```

Expected: FAIL — `onboard-client` handler module doesn't exist yet.

- [ ] **Step 3: Implement the handler**

Create `netlify/functions/onboard-client.ts`:

```typescript
// netlify/functions/onboard-client.ts
//
// POST /api/onboard-client — admin-only.
// Single-transaction onboarding: creates client + enabled products + roles
// + levels + cardinality + L1 Owner node + Owner credential, all-or-nothing.
//
// Roles/levels/cardinality reference each other by key/level_number; UUIDs
// don't exist until the transaction creates the rows.
//
// On any failure (validation, FK, cardinality), the Postgres transaction
// rolls back and the response body identifies the failing section.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { deriveSlug } from './_shared/identifier';
import { hashPassword } from './_shared/argon';

const RoleSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(50),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bucket_family: z.enum(['business', 'employees', 'customers', 'products']).nullable().optional(),
});

const LevelSchema = z.object({
  level_number: z.number().int().min(1),
  label: z.string().max(100).nullable().optional(),
  allowed_role_keys: z.array(z.string()),
});

const CardinalitySchema = z.object({
  parent_role_key: z.string().nullable(),
  child_role_key: z.string(),
  max_children: z.number().int().min(0),
});

const OwnerSchema = z.object({
  display_name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  temp_password: z.string().min(8).max(200),
});

const Body = z.object({
  name: z.string().min(1).max(200),
  enabled_products: z.array(z.string()),
  roles: z.array(RoleSchema),
  levels: z.array(LevelSchema),
  cardinality_rules: z.array(CardinalitySchema),
  owner: OwnerSchema,
});

type Section = 'name' | 'products' | 'roles' | 'levels' | 'cardinality' | 'owner';
function err(status: number, code: string, section: Section, extra?: Record<string, unknown>) {
  return jsonError(status, code, { section, ...(extra ?? {}) });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const data = parsed.data;
  const adminId = actor.admin.id;

  // ---- AUTO-SEED roles + levels if empty (spec §4.4) ----
  let roles = data.roles;
  let levels = data.levels;
  if (roles.length === 0) {
    roles = [{ key: 'owner', label: 'Owner', color: '#3b82f6' }];
  }
  if (levels.length === 0) {
    // Use the first role's key as the L1 allowed role.
    levels = [{ level_number: 1, label: 'Primary', allowed_role_keys: [roles[0]!.key] }];
  }

  // ---- VALIDATE references (pre-transaction; cheap fail-fast) ----
  const roleKeys = new Set(roles.map((r) => r.key));
  for (const lv of levels) {
    for (const k of lv.allowed_role_keys) {
      if (!roleKeys.has(k)) {
        return err(400, 'invalid_reference', 'levels', { unknown_role_key: k, level_number: lv.level_number });
      }
    }
  }
  for (const rule of data.cardinality_rules) {
    if (rule.parent_role_key !== null && !roleKeys.has(rule.parent_role_key)) {
      return err(400, 'invalid_reference', 'cardinality', { unknown_role_key: rule.parent_role_key });
    }
    if (!roleKeys.has(rule.child_role_key)) {
      return err(400, 'invalid_reference', 'cardinality', { unknown_role_key: rule.child_role_key });
    }
  }

  // ---- Determine Owner's role (spec §4.5) ----
  const level1 = levels.find((l) => l.level_number === 1);
  if (!level1 || level1.allowed_role_keys.length === 0) {
    return err(400, 'level_1_has_no_roles', 'levels');
  }
  const ownerRoleKey = roles.find((r) => level1.allowed_role_keys.includes(r.key))?.key;
  if (!ownerRoleKey) {
    return err(400, 'level_1_has_no_roles', 'levels');
  }

  // ---- Cardinality pre-check: if seeding 1 Owner would violate a top-level cap on the Owner's role, fail (spec §5) ----
  for (const rule of data.cardinality_rules) {
    if (rule.parent_role_key === null && rule.child_role_key === ownerRoleKey && rule.max_children < 1) {
      return err(409, 'cardinality_violation', 'owner', {
        rule: { parent_role_key: null, child_role_key: ownerRoleKey, max_children: rule.max_children },
      });
    }
  }

  // ---- Slug derivation with collision handling (mirrors clients.ts pattern) ----
  const sql = db();
  const baseSlug = deriveSlug(data.name);
  let slug = baseSlug;
  let suffix = 2;
  for (let i = 0; i < 25; i++) {
    const existing = (await sql`SELECT 1 FROM public.clients WHERE slug = ${slug} LIMIT 1`) as unknown[];
    if (existing.length === 0) break;
    slug = `${baseSlug}-${suffix++}`;
    if (i === 24) return err(422, 'slug_collision', 'name');
  }

  // ---- Hash the Owner password OUTSIDE the txn (argon2 is slow; don't hold the connection) ----
  const ownerPwHash = await hashPassword(data.owner.temp_password);

  // ---- THE TRANSACTION ----
  // sql.transaction takes an array of tagged-template queries and runs them
  // atomically. Order:
  //   1. clients INSERT
  //   2. client_enabled_products
  //   3. client_roles
  //   4. client_levels
  //   5. client_cardinality_rules
  //   6. user_nodes (Owner)
  //   7. user_node_credentials (Owner)
  //
  // Because tagged-template results are needed inside the txn (we need the
  // client_id from step 1 to pass to subsequent steps, and role ids to map
  // keys → ids), we use multiple sql.transaction([...]) calls — but each
  // call is its own transaction. To get true single-transaction semantics
  // with id-passing, switch to a raw sql`BEGIN; … COMMIT;` block OR pre-
  // generate UUIDs for the rows we need to reference.
  //
  // Pre-generated UUIDs approach (cleanest):
  //   - We generate clientId, ownerNodeId, and Map<roleKey, roleId> upfront
  //   - All INSERTs in one sql.transaction([...]) call use those literals
  //   - On any error, the whole txn rolls back

  const clientId = crypto.randomUUID();
  const ownerNodeId = crypto.randomUUID();
  const roleIdByKey = new Map<string, string>();
  for (const r of roles) roleIdByKey.set(r.key, crypto.randomUUID());

  const queries: unknown[] = [];

  // 1. client
  queries.push(sql`
    INSERT INTO public.clients (id, name, slug, created_by)
    VALUES (${clientId}::uuid, ${data.name}, ${slug}, ${adminId}::uuid)
  `);

  // 2. enabled products
  for (const pk of data.enabled_products) {
    queries.push(sql`
      INSERT INTO public.client_enabled_products (client_id, product_key)
      VALUES (${clientId}::uuid, ${pk})
    `);
  }

  // 3. roles
  for (const r of roles) {
    queries.push(sql`
      INSERT INTO public.client_roles (id, client_id, key, label, color, bucket_family)
      VALUES (${roleIdByKey.get(r.key)!}::uuid, ${clientId}::uuid, ${r.key}, ${r.label}, ${r.color},
              ${r.bucket_family ?? null})
    `);
  }

  // 4. levels
  for (const lv of levels) {
    const allowedIds = lv.allowed_role_keys.map((k) => roleIdByKey.get(k)!);
    queries.push(sql`
      INSERT INTO public.client_levels (client_id, level_number, label, allowed_role_ids)
      VALUES (${clientId}::uuid, ${lv.level_number}, ${lv.label ?? null},
              ${allowedIds}::uuid[])
    `);
  }

  // 5. cardinality
  for (const rule of data.cardinality_rules) {
    const parentId = rule.parent_role_key === null ? null : roleIdByKey.get(rule.parent_role_key)!;
    const childId = roleIdByKey.get(rule.child_role_key)!;
    queries.push(sql`
      INSERT INTO public.client_cardinality_rules (client_id, parent_role_id, child_role_id, max_children)
      VALUES (${clientId}::uuid, ${parentId}::uuid, ${childId}::uuid, ${rule.max_children})
    `);
  }

  // 6. Owner user_node
  const ownerRoleId = roleIdByKey.get(ownerRoleKey)!;
  queries.push(sql`
    INSERT INTO public.user_nodes (
      id, client_id, parent_id, level_number, role_id,
      display_name, email, phone, notes, fields, created_by_admin
    )
    VALUES (
      ${ownerNodeId}::uuid, ${clientId}::uuid, NULL, 1, ${ownerRoleId}::uuid,
      ${data.owner.display_name},
      ${data.owner.email},
      ${data.owner.phone ?? null},
      ${data.owner.notes ?? null},
      '{}'::jsonb,
      ${adminId}::uuid
    )
  `);

  // 7. Owner credential
  queries.push(sql`
    INSERT INTO public.user_node_credentials (
      client_id, user_node_id, email, password_hash, must_change_password,
      temp_password_plain, temp_password_views_left, created_by_admin
    )
    VALUES (
      ${clientId}::uuid, ${ownerNodeId}::uuid, ${data.owner.email},
      ${ownerPwHash}, true, ${data.owner.temp_password}, 3, ${adminId}::uuid
    )
  `);

  // Execute the transaction.
  try {
    await sql.transaction(queries as never);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    const msg = (e as Error)?.message ?? '';
    // Postgres SQLSTATE codes:
    //   23505 — unique_violation (slug or email collision)
    //   23503 — foreign_key_violation (shouldn't happen post-validation)
    //   23514 — check_violation (e.g., level/parent consistency check)
    if (code === '23505') {
      if (msg.includes('user_node_credentials')) {
        return err(409, 'email_already_has_login_in_this_workspace', 'owner');
      }
      if (msg.includes('clients_slug_key') || msg.includes('clients_slug')) {
        return err(422, 'slug_collision', 'name');
      }
      return err(409, 'duplicate_row', 'roles', { sqlstate: code });
    }
    if (code === '23503') {
      return err(400, 'foreign_key_violation', 'levels', { sqlstate: code });
    }
    if (code === '23514') {
      return err(400, 'check_violation', 'levels', { sqlstate: code });
    }
    throw e; // unknown — let it 500
  }

  return jsonOk({
    client: { id: clientId, name: data.name, slug },
  }, { status: 201 });
};
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
npm run typecheck
npm test -- tests/integration/onboard-client.test.ts
```

Expected: typecheck clean; all 6 onboard tests PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: 194 + 6 = 200 passing.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/onboard-client.ts tests/integration/onboard-client.test.ts
git commit -m "$(cat <<'EOF'
feat(onboard-client): single-transaction endpoint for the onboarding wizard

POST /api/onboard-client takes one body with all 6 wizard sections
(name, products, roles, levels, cardinality, owner) and inserts every
row in one Postgres transaction. Pre-generated UUIDs let us reference
across the txn without round-trips; roles/levels/cardinality reference
each other by key (not UUID) in the body. Auto-seeds 'owner' role +
'Primary' L1 level when admin skips those steps. Structured errors
identify the failing section so the wizard can jump back. Migration-free.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 2: Wizard reducer + state + validators + unit tests

Pure module — no React, no DOM. Just the reducer, state shape, per-step validators, auto-seed, and the Owner-role resolver. Easily testable in isolation.

**Files:**
- Create: `src/modules/ams/components/onboarding/state.ts`
- Create: `tests/unit/onboard-wizard-state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/onboard-wizard-state.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import {
  initialState, reducer, validators, resolveOwnerRoleKey, applyAutoSeed,
  type WizardState,
} from '../../src/modules/ams/components/onboarding/state';

describe('initialState', () => {
  test('starts at name step with empty fields', () => {
    expect(initialState.step).toBe('name');
    expect(initialState.name).toBe('');
    expect(initialState.roles).toEqual([]);
    expect(initialState.levels).toEqual([]);
    expect(initialState.cardinality_rules).toEqual([]);
    expect(initialState.enabled_products).toEqual([]);
    expect(initialState.owner.display_name).toBe('');
  });
});

describe('reducer', () => {
  test('setName updates the name', () => {
    const next = reducer(initialState, { type: 'setName', value: 'Acme Inc' });
    expect(next.name).toBe('Acme Inc');
  });

  test('goToStep navigates', () => {
    const s2 = reducer(initialState, { type: 'goToStep', step: 'products' });
    expect(s2.step).toBe('products');
  });

  test('addRole appends to roles', () => {
    const s2 = reducer(initialState, { type: 'addRole', role: { key: 'staff', label: 'Staff', color: '#22c55e' } });
    expect(s2.roles.length).toBe(1);
    expect(s2.roles[0]!.key).toBe('staff');
  });

  test('removeRole removes by index', () => {
    const s1 = reducer(initialState, { type: 'addRole', role: { key: 'a', label: 'A', color: '#000000' } });
    const s2 = reducer(s1, { type: 'addRole', role: { key: 'b', label: 'B', color: '#111111' } });
    const s3 = reducer(s2, { type: 'removeRole', index: 0 });
    expect(s3.roles.length).toBe(1);
    expect(s3.roles[0]!.key).toBe('b');
  });
});

describe('validators', () => {
  test('name: non-empty required', () => {
    expect(validators.name({ ...initialState, name: '' })).toEqual({ ok: false, reason: 'Name is required' });
    expect(validators.name({ ...initialState, name: 'Acme' })).toEqual({ ok: true });
  });

  test('products: always ok (skippable)', () => {
    expect(validators.products(initialState)).toEqual({ ok: true });
  });

  test('roles: always ok (auto-seed handles empty)', () => {
    expect(validators.roles(initialState)).toEqual({ ok: true });
  });

  test('levels: always ok (auto-seed handles empty)', () => {
    expect(validators.levels(initialState)).toEqual({ ok: true });
  });

  test('cardinality: always ok (skippable)', () => {
    expect(validators.cardinality(initialState)).toEqual({ ok: true });
  });

  test('owner: display_name + email + temp_password >= 8 chars all required', () => {
    const blank = validators.owner(initialState);
    expect(blank.ok).toBe(false);
    const partial = validators.owner({ ...initialState, owner: { display_name: 'X', email: '', temp_password: 'shortpw' } });
    expect(partial.ok).toBe(false);
    const good = validators.owner({ ...initialState, owner: { display_name: 'X', email: 'x@y.com', temp_password: 'long-enough' } });
    expect(good).toEqual({ ok: true });
  });
});

describe('applyAutoSeed', () => {
  test('empty roles → auto-seed owner role', () => {
    const seeded = applyAutoSeed({ ...initialState });
    expect(seeded.roles.length).toBe(1);
    expect(seeded.roles[0]).toMatchObject({ key: 'owner', label: 'Owner', color: '#3b82f6' });
  });

  test('empty levels → auto-seed Primary L1 referencing first role', () => {
    const withRole = reducer(initialState, { type: 'addRole', role: { key: 'manager', label: 'Manager', color: '#000' } });
    const seeded = applyAutoSeed(withRole);
    expect(seeded.levels.length).toBe(1);
    expect(seeded.levels[0]).toMatchObject({ level_number: 1, label: 'Primary', allowed_role_keys: ['manager'] });
  });

  test('non-empty roles + levels are preserved unchanged', () => {
    const s1 = reducer(initialState, { type: 'addRole', role: { key: 'owner', label: 'O', color: '#000' } });
    const s2 = reducer(s1, { type: 'addLevel', level: { level_number: 1, allowed_role_keys: ['owner'] } });
    const seeded = applyAutoSeed(s2);
    expect(seeded.roles).toEqual(s2.roles);
    expect(seeded.levels).toEqual(s2.levels);
  });
});

describe('resolveOwnerRoleKey', () => {
  test('picks the first role whose key is in L1 allowed_role_keys', () => {
    const state: WizardState = {
      ...initialState,
      roles: [
        { key: 'staff', label: 'Staff', color: '#000' },
        { key: 'owner', label: 'Owner', color: '#111' },
      ],
      levels: [{ level_number: 1, allowed_role_keys: ['owner'] }],
    };
    expect(resolveOwnerRoleKey(state)).toBe('owner');
  });

  test('returns null if L1 has no allowed roles', () => {
    const state: WizardState = { ...initialState, roles: [{ key: 'x', label: 'X', color: '#000' }], levels: [{ level_number: 1, allowed_role_keys: [] }] };
    expect(resolveOwnerRoleKey(state)).toBeNull();
  });

  test('returns null if L1 doesn\'t exist', () => {
    expect(resolveOwnerRoleKey(initialState)).toBeNull();
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
npm test -- tests/unit/onboard-wizard-state.test.ts
```

Expected: cannot find module `./state`.

- [ ] **Step 3: Implement `state.ts`**

Create `src/modules/ams/components/onboarding/state.ts`:

```typescript
// Wizard state shape + reducer + validators + auto-seed.
// Pure module: no React, no DOM.

export type WizardStep = 'name' | 'products' | 'roles' | 'levels' | 'cardinality' | 'owner' | 'success';

export interface RoleDraft {
  key: string;
  label: string;
  color: string;
  bucket_family?: 'business' | 'employees' | 'customers' | 'products' | null;
}

export interface LevelDraft {
  level_number: number;
  label?: string | null;
  allowed_role_keys: string[];
}

export interface CardinalityDraft {
  parent_role_key: string | null;
  child_role_key: string;
  max_children: number;
}

export interface OwnerDraft {
  display_name: string;
  email: string;
  phone?: string | null;
  notes?: string | null;
  temp_password: string;
}

export interface WizardState {
  step: WizardStep;
  name: string;
  enabled_products: string[];
  roles: RoleDraft[];
  levels: LevelDraft[];
  cardinality_rules: CardinalityDraft[];
  owner: OwnerDraft;
  submitting: boolean;
  submitError: { code: string; section: WizardStep | null; details?: Record<string, unknown> } | null;
}

export const initialState: WizardState = {
  step: 'name',
  name: '',
  enabled_products: [],
  roles: [],
  levels: [],
  cardinality_rules: [],
  owner: { display_name: '', email: '', phone: null, notes: null, temp_password: '' },
  submitting: false,
  submitError: null,
};

export type WizardAction =
  | { type: 'goToStep'; step: WizardStep }
  | { type: 'setName'; value: string }
  | { type: 'toggleProduct'; productKey: string }
  | { type: 'addRole'; role: RoleDraft }
  | { type: 'removeRole'; index: number }
  | { type: 'addLevel'; level: LevelDraft }
  | { type: 'removeLevel'; index: number }
  | { type: 'addCardinality'; rule: CardinalityDraft }
  | { type: 'removeCardinality'; index: number }
  | { type: 'setOwner'; patch: Partial<OwnerDraft> }
  | { type: 'submitStart' }
  | { type: 'submitError'; error: { code: string; section: WizardStep | null; details?: Record<string, unknown> } }
  | { type: 'submitSuccess' };

export function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'goToStep': return { ...state, step: action.step, submitError: null };
    case 'setName': return { ...state, name: action.value };
    case 'toggleProduct': {
      const has = state.enabled_products.includes(action.productKey);
      return { ...state, enabled_products: has
        ? state.enabled_products.filter((k) => k !== action.productKey)
        : [...state.enabled_products, action.productKey] };
    }
    case 'addRole': return { ...state, roles: [...state.roles, action.role] };
    case 'removeRole': return { ...state, roles: state.roles.filter((_, i) => i !== action.index) };
    case 'addLevel': return { ...state, levels: [...state.levels, action.level] };
    case 'removeLevel': return { ...state, levels: state.levels.filter((_, i) => i !== action.index) };
    case 'addCardinality': return { ...state, cardinality_rules: [...state.cardinality_rules, action.rule] };
    case 'removeCardinality': return { ...state, cardinality_rules: state.cardinality_rules.filter((_, i) => i !== action.index) };
    case 'setOwner': return { ...state, owner: { ...state.owner, ...action.patch } };
    case 'submitStart': return { ...state, submitting: true, submitError: null };
    case 'submitError': return { ...state, submitting: false, submitError: action.error };
    case 'submitSuccess': return { ...state, submitting: false, submitError: null, step: 'success' };
  }
}

export type ValidatorResult = { ok: true } | { ok: false; reason: string };

export const validators: Record<Exclude<WizardStep, 'success'>, (s: WizardState) => ValidatorResult> = {
  name: (s) => s.name.trim().length === 0
    ? { ok: false, reason: 'Name is required' }
    : { ok: true },
  products: () => ({ ok: true }),
  roles: () => ({ ok: true }),    // empty is OK; auto-seed at submit
  levels: () => ({ ok: true }),   // empty is OK; auto-seed at submit
  cardinality: () => ({ ok: true }),
  owner: (s) => {
    if (s.owner.display_name.trim().length === 0) return { ok: false, reason: 'Display name is required' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.owner.email)) return { ok: false, reason: 'Valid email is required' };
    if (s.owner.temp_password.length < 8) return { ok: false, reason: 'Temp password must be ≥ 8 chars' };
    return { ok: true };
  },
};

// Auto-seed roles + levels for the lightweight "skip everything" path.
// Server also auto-seeds defensively, but doing it client-side too keeps
// the wizard's submitted body consistent with the resolveOwnerRoleKey result.
export function applyAutoSeed(state: WizardState): WizardState {
  let roles = state.roles;
  let levels = state.levels;
  if (roles.length === 0) {
    roles = [{ key: 'owner', label: 'Owner', color: '#3b82f6' }];
  }
  if (levels.length === 0) {
    levels = [{ level_number: 1, label: 'Primary', allowed_role_keys: [roles[0]!.key] }];
  }
  return { ...state, roles, levels };
}

// Resolve the Owner's role key per spec §4.5: first role in `roles` whose
// key appears in level 1's allowed_role_keys.
export function resolveOwnerRoleKey(state: WizardState): string | null {
  const lv1 = state.levels.find((l) => l.level_number === 1);
  if (!lv1 || lv1.allowed_role_keys.length === 0) return null;
  const match = state.roles.find((r) => lv1.allowed_role_keys.includes(r.key));
  return match?.key ?? null;
}

// The 6 ordered steps (no 'success' — that's a terminal post-submit state).
export const STEP_ORDER: Array<Exclude<WizardStep, 'success'>> =
  ['name', 'products', 'roles', 'levels', 'cardinality', 'owner'];
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npm run typecheck
npm test -- tests/unit/onboard-wizard-state.test.ts
```

Expected: all tests pass. Final count: 200 + ~13 unit tests = ~213.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ams/components/onboarding/state.ts tests/unit/onboard-wizard-state.test.ts
git commit -m "feat(onboarding): wizard reducer + validators + auto-seed + tests"
```

---

# Task 3: `onboardClient` API wrapper + Stepper component

Two tiny pieces.

**Files:**
- Modify: `src/modules/ams/api.ts` — add `onboardClient` wrapper.
- Create: `src/modules/ams/components/onboarding/Stepper.tsx` — top progress bar.

- [ ] **Step 1: Add the API wrapper**

In `src/modules/ams/api.ts`, append:

```typescript
// ---------------------------------------------------------------------------
// Onboarding wizard
// ---------------------------------------------------------------------------
export interface OnboardClientBody {
  name: string;
  enabled_products: string[];
  roles: Array<{ key: string; label: string; color: string; bucket_family?: 'business' | 'employees' | 'customers' | 'products' | null }>;
  levels: Array<{ level_number: number; label?: string | null; allowed_role_keys: string[] }>;
  cardinality_rules: Array<{ parent_role_key: string | null; child_role_key: string; max_children: number }>;
  owner: { display_name: string; email: string; phone?: string | null; notes?: string | null; temp_password: string };
}

export const onboardClient = (body: OnboardClientBody) =>
  apiFetch<{ client: { id: string; name: string; slug: string } }>('/api/onboard-client', {
    method: 'POST', body: JSON.stringify(body),
  });
```

- [ ] **Step 2: Create `Stepper.tsx`**

Create `src/modules/ams/components/onboarding/Stepper.tsx`:

```typescript
import { STEP_ORDER, type WizardStep } from './state';

const LABELS: Record<Exclude<WizardStep, 'success'>, string> = {
  name: 'Name',
  products: 'Products',
  roles: 'Roles',
  levels: 'Levels',
  cardinality: 'Cardinality',
  owner: 'Owner',
};

interface Props {
  currentStep: WizardStep;
  onJumpTo: (step: WizardStep) => void;
}

export function Stepper({ currentStep, onJumpTo }: Props) {
  if (currentStep === 'success') return null;
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      {STEP_ORDER.map((step, idx) => {
        const isCurrent = step === currentStep;
        const isCompleted = idx < currentIdx;
        const canJump = isCompleted; // can revisit completed steps; no skip-ahead
        return (
          <button
            key={step}
            type="button"
            onClick={() => canJump && onJumpTo(step)}
            disabled={!canJump && !isCurrent}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
              background: isCurrent ? 'var(--accent)' : 'transparent',
              color: isCurrent ? 'var(--text-on-accent)' : (isCompleted ? 'var(--text-primary)' : 'var(--text-muted)'),
              border: '1px solid', borderColor: isCurrent ? 'var(--accent)' : 'var(--border-subtle)',
              borderRadius: 'var(--radius-sm)', cursor: canJump ? 'pointer' : 'default',
              font: 'inherit', fontSize: 12,
            }}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span style={{ width: 18, height: 18, borderRadius: '50%',
              background: isCurrent || isCompleted ? 'currentColor' : 'transparent',
              border: '1px solid currentColor', display: 'inline-block',
              fontSize: 10, lineHeight: '16px', textAlign: 'center',
              color: isCurrent ? 'var(--accent)' : (isCompleted ? 'var(--bg-base)' : 'var(--text-muted)'),
            }}>
              {isCompleted ? '✓' : idx + 1}
            </span>
            {LABELS[step]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: green. No test count change (no new tests in this task; UI smoke covers).

- [ ] **Step 4: Commit**

```bash
git add src/modules/ams/api.ts src/modules/ams/components/onboarding/Stepper.tsx
git commit -m "feat(onboarding): onboardClient API wrapper + Stepper component"
```

---

# Task 4: NameStep, ProductsStep, OwnerStep

Three simpler step components. Each is a focused form section.

**Files:**
- Create: `src/modules/ams/components/onboarding/steps/NameStep.tsx`
- Create: `src/modules/ams/components/onboarding/steps/ProductsStep.tsx`
- Create: `src/modules/ams/components/onboarding/steps/OwnerStep.tsx`

- [ ] **Step 1: Create `NameStep.tsx`**

```typescript
// src/modules/ams/components/onboarding/steps/NameStep.tsx
import type { WizardState, WizardAction } from '../state';
// deriveSlug from the shared identifier helper (mirrors server behavior).
function deriveSlugPreview(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/g, '');
  if (s.length < 2) return '(name too short)';
  return s;
}

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function NameStep({ state, dispatch }: Props) {
  const slug = state.name.trim() ? deriveSlugPreview(state.name) : '';
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Workspace name</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        This is the client/workspace display name. We'll derive a URL slug from it automatically.
      </p>
      <label>Name *
        <input type="text" autoFocus required value={state.name}
          onChange={(e) => dispatch({ type: 'setName', value: e.target.value })}
          placeholder="e.g. Joe's Hardware" />
      </label>
      {slug && (
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          URL slug preview: <code style={{ background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>{slug}</code>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `ProductsStep.tsx`**

```typescript
// src/modules/ams/components/onboarding/steps/ProductsStep.tsx
import type { WizardState, WizardAction } from '../state';
import { allProducts } from '../../../../registry/products';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function ProductsStep({ state, dispatch }: Props) {
  const products = allProducts();
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Enable Products</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Toggle which Products this workspace has access to. Each Product brings its own set of Modules.
        You can change this later in the workspace's Products section.
      </p>
      {products.length === 0 ? (
        <p className="muted">No Products registered yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {products.map((p) => {
            const enabled = state.enabled_products.includes(p.key);
            return (
              <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={enabled}
                  onChange={() => dispatch({ type: 'toggleProduct', productKey: p.key })} />
                <span>
                  <strong>{p.label}</strong>{' '}
                  <span className="muted" style={{ fontSize: 12 }}>{p.key}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `OwnerStep.tsx`**

```typescript
// src/modules/ams/components/onboarding/steps/OwnerStep.tsx
import { useState } from 'react';
import type { WizardState, WizardAction } from '../state';
import { generateTempPassword } from '../../../../../lib/random-password';
import { resolveOwnerRoleKey, applyAutoSeed } from '../state';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function OwnerStep({ state, dispatch }: Props) {
  const [showPw, setShowPw] = useState(false);
  // Resolve role after auto-seeding so even the skip-everything path renders OK.
  const seeded = applyAutoSeed(state);
  const ownerRoleKey = resolveOwnerRoleKey(seeded);
  const ownerRoleLabel = ownerRoleKey ? seeded.roles.find((r) => r.key === ownerRoleKey)?.label ?? ownerRoleKey : null;

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Seed the L1 Owner</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Create the first user at Level 1. They'll receive the workspace as Owner.
        {ownerRoleLabel && <> Role will be <strong>{ownerRoleLabel}</strong> (the first role allowed at Level 1).</>}
      </p>

      <label>Display name *
        <input type="text" required value={state.owner.display_name}
          onChange={(e) => dispatch({ type: 'setOwner', patch: { display_name: e.target.value } })}
          placeholder="e.g. Joe Smith" />
      </label>
      <label>Email *
        <input type="email" required value={state.owner.email}
          onChange={(e) => dispatch({ type: 'setOwner', patch: { email: e.target.value } })}
          placeholder="owner@example.com" />
      </label>
      <label>Phone
        <input type="text" value={state.owner.phone ?? ''}
          onChange={(e) => dispatch({ type: 'setOwner', patch: { phone: e.target.value || null } })} />
      </label>
      <label>Notes
        <textarea value={state.owner.notes ?? ''}
          onChange={(e) => dispatch({ type: 'setOwner', patch: { notes: e.target.value || null } })}
          rows={2} />
      </label>
      <label>Temp password *
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type={showPw ? 'text' : 'password'} required value={state.owner.temp_password}
            onChange={(e) => dispatch({ type: 'setOwner', patch: { temp_password: e.target.value } })}
            style={{ flex: 1, fontFamily: 'monospace' }} />
          <button type="button" className="btn btn-ghost"
            onClick={() => dispatch({ type: 'setOwner', patch: { temp_password: generateTempPassword() } })}>Regen</button>
          <button type="button" className="btn btn-ghost"
            onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          The Owner must change this on first login.
        </span>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: clean; tests unchanged (no new test files this task).

- [ ] **Step 5: Commit**

```bash
git add src/modules/ams/components/onboarding/steps/NameStep.tsx \
        src/modules/ams/components/onboarding/steps/ProductsStep.tsx \
        src/modules/ams/components/onboarding/steps/OwnerStep.tsx
git commit -m "feat(onboarding): NameStep + ProductsStep + OwnerStep"
```

---

# Task 5: RolesStep, LevelsStep, CardinalityStep

The three structural steps. Each is an add/remove list of rows with inline editing.

**Files:**
- Create: `src/modules/ams/components/onboarding/steps/RolesStep.tsx`
- Create: `src/modules/ams/components/onboarding/steps/LevelsStep.tsx`
- Create: `src/modules/ams/components/onboarding/steps/CardinalityStep.tsx`

- [ ] **Step 1: Create `RolesStep.tsx`**

```typescript
// src/modules/ams/components/onboarding/steps/RolesStep.tsx
import { useState } from 'react';
import type { WizardState, WizardAction, RoleDraft } from '../state';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function RolesStep({ state, dispatch }: Props) {
  const [draft, setDraft] = useState<RoleDraft>({ key: '', label: '', color: '#3b82f6', bucket_family: null });
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    if (!/^[a-z][a-z0-9_-]*$/.test(draft.key)) { setError('Key must be lowercase, start with a letter, alphanumeric/_/-'); return; }
    if (draft.label.trim().length === 0) { setError('Label is required'); return; }
    if (state.roles.some((r) => r.key === draft.key)) { setError('Key must be unique within this workspace'); return; }
    dispatch({ type: 'addRole', role: { ...draft, label: draft.label.trim() } });
    setDraft({ key: '', label: '', color: '#3b82f6', bucket_family: null });
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Roles</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Define the role types in this workspace (e.g. Owner, Manager, Staff). You can skip this step;
        we'll auto-seed an "Owner" role.
      </p>

      {state.roles.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {state.roles.map((r, i) => (
            <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', background: r.color, display: 'inline-block' }} />
              <strong style={{ flex: 1 }}>{r.label}</strong>
              <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.key}</code>
              <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'removeRole', index: i })}>×</button>
            </div>
          ))}
        </div>
      )}

      <fieldset style={{ border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
        <legend style={{ fontSize: 12, padding: '0 6px' }}>Add a role</legend>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ flex: 1, minWidth: 120 }}>Key
            <input type="text" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="owner" />
          </label>
          <label style={{ flex: 2, minWidth: 160 }}>Label
            <input type="text" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Owner" />
          </label>
          <label>Color
            <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
          </label>
        </div>
        {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
        <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={add}>+ Add role</button>
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 2: Create `LevelsStep.tsx`**

```typescript
// src/modules/ams/components/onboarding/steps/LevelsStep.tsx
import { useState } from 'react';
import type { WizardState, WizardAction, LevelDraft } from '../state';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function LevelsStep({ state, dispatch }: Props) {
  const nextLevelNumber = state.levels.length === 0
    ? 1
    : Math.max(...state.levels.map((l) => l.level_number)) + 1;
  const [draft, setDraft] = useState<LevelDraft>({ level_number: nextLevelNumber, label: '', allowed_role_keys: [] });
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    if (state.levels.some((l) => l.level_number === draft.level_number)) {
      setError(`Level ${draft.level_number} already defined`); return;
    }
    if (draft.allowed_role_keys.length === 0 && state.roles.length > 0) {
      setError('Pick at least one allowed role'); return;
    }
    dispatch({ type: 'addLevel', level: { ...draft, label: draft.label?.trim() || null } });
    const next = draft.level_number + 1;
    setDraft({ level_number: next, label: '', allowed_role_keys: [] });
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Levels</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Levels define the hierarchy depth. Level 1 is the top (the Owner level). You can skip; we'll
        auto-seed a "Primary" L1 referencing the first role.
      </p>

      {state.levels.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {state.levels.sort((a, b) => a.level_number - b.level_number).map((l, i) => (
            <div key={l.level_number} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <strong style={{ flex: 1 }}>Level {l.level_number}{l.label ? ` — ${l.label}` : ''}</strong>
              <span className="muted" style={{ fontSize: 11 }}>roles: {l.allowed_role_keys.join(', ') || '(none)'}</span>
              <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'removeLevel', index: i })}>×</button>
            </div>
          ))}
        </div>
      )}

      {state.roles.length === 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>Add roles first (or skip and we'll auto-seed).</p>
      ) : (
        <fieldset style={{ border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
          <legend style={{ fontSize: 12, padding: '0 6px' }}>Add a level</legend>
          <label>Level number
            <input type="number" min={1} value={draft.level_number}
              onChange={(e) => setDraft({ ...draft, level_number: parseInt(e.target.value || '1', 10) })} />
          </label>
          <label>Label (optional)
            <input type="text" value={draft.label ?? ''} onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="e.g. Primary, Manager, Staff" />
          </label>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 4px' }}>Allowed roles at this level:</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {state.roles.map((r) => {
              const checked = draft.allowed_role_keys.includes(r.key);
              return (
                <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={checked}
                    onChange={() => setDraft({ ...draft, allowed_role_keys: checked
                      ? draft.allowed_role_keys.filter((k) => k !== r.key)
                      : [...draft.allowed_role_keys, r.key] })} />
                  {r.label}
                </label>
              );
            })}
          </div>
          {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
          <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={add}>+ Add level</button>
        </fieldset>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `CardinalityStep.tsx`**

```typescript
// src/modules/ams/components/onboarding/steps/CardinalityStep.tsx
import { useState } from 'react';
import type { WizardState, WizardAction, CardinalityDraft } from '../state';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function CardinalityStep({ state, dispatch }: Props) {
  const [draft, setDraft] = useState<CardinalityDraft>({ parent_role_key: null, child_role_key: '', max_children: 1 });
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    if (draft.child_role_key === '') { setError('Pick a child role'); return; }
    if (state.cardinality_rules.some((r) =>
      r.parent_role_key === draft.parent_role_key && r.child_role_key === draft.child_role_key)) {
      setError('Rule already defined for this parent/child combo'); return;
    }
    dispatch({ type: 'addCardinality', rule: draft });
    setDraft({ parent_role_key: null, child_role_key: '', max_children: 1 });
  }

  function labelOf(key: string | null): string {
    if (key === null) return '(top-level)';
    return state.roles.find((r) => r.key === key)?.label ?? key;
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Cardinality rules</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Optionally cap how many children of each role can exist under each parent role. Skip for no caps.
      </p>

      {state.cardinality_rules.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {state.cardinality_rules.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ flex: 1, fontSize: 13 }}>
                Under <strong>{labelOf(r.parent_role_key)}</strong>: at most <strong>{r.max_children}</strong> {labelOf(r.child_role_key)}
              </span>
              <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'removeCardinality', index: i })}>×</button>
            </div>
          ))}
        </div>
      )}

      {state.roles.length === 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>Add roles first (or skip).</p>
      ) : (
        <fieldset style={{ border: '1px solid var(--border-subtle)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
          <legend style={{ fontSize: 12, padding: '0 6px' }}>Add a cardinality rule</legend>
          <label>Parent role
            <select value={draft.parent_role_key ?? '_top'}
              onChange={(e) => setDraft({ ...draft, parent_role_key: e.target.value === '_top' ? null : e.target.value })}>
              <option value="_top">(top-level)</option>
              {state.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          <label>Child role
            <select value={draft.child_role_key}
              onChange={(e) => setDraft({ ...draft, child_role_key: e.target.value })}>
              <option value="">— pick —</option>
              {state.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          <label>Max children
            <input type="number" min={0} value={draft.max_children}
              onChange={(e) => setDraft({ ...draft, max_children: parseInt(e.target.value || '0', 10) })} />
          </label>
          {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
          <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={add}>+ Add rule</button>
        </fieldset>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: clean; tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ams/components/onboarding/steps/RolesStep.tsx \
        src/modules/ams/components/onboarding/steps/LevelsStep.tsx \
        src/modules/ams/components/onboarding/steps/CardinalityStep.tsx
git commit -m "feat(onboarding): RolesStep + LevelsStep + CardinalityStep"
```

---

# Task 6: Wizard shell + SuccessStep + AdminDashboard wire-up + smoke

The wizard modal that orchestrates everything + the post-submit success state + the swap of `AddClientModal` → `OnboardClientWizard` in `AdminDashboard`.

**Files:**
- Create: `src/modules/ams/components/onboarding/steps/SuccessStep.tsx`
- Create: `src/modules/ams/components/onboarding/OnboardClientWizard.tsx`
- Modify: `src/modules/ams/pages/AdminDashboard.tsx`
- Delete (conditional): `src/modules/ams/components/AddClientModal.tsx`

- [ ] **Step 1: Create `SuccessStep.tsx`**

```typescript
// src/modules/ams/components/onboarding/steps/SuccessStep.tsx
import { Link } from 'react-router-dom';

interface Props {
  clientId: string;
  clientName: string;
  clientSlug: string;
  ownerTempPassword: string;
  ownerEmail: string;
  onClose: () => void;
}

export function SuccessStep({ clientId, clientName, clientSlug, ownerTempPassword, ownerEmail, onClose }: Props) {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>✓ Workspace created</h3>
      <p>
        <strong>{clientName}</strong> is ready. Share the Owner login details below.
      </p>

      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Login URL</p>
        <code style={{ wordBreak: 'break-all' }}>{`${window.location.origin}/c/${clientSlug}/login`}</code>
      </div>
      <div className="card" style={{ padding: 12, marginTop: 8 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Email</p>
        <code>{ownerEmail}</code>
      </div>
      <div className="card" style={{ padding: 12, marginTop: 8 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Temp password</p>
        <code style={{ fontFamily: 'monospace', fontSize: 14 }}>{ownerTempPassword}</code>
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          The Owner must change this on first login.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        <Link to={`/clients/${clientId}`} className="btn btn-primary" onClick={onClose}>Open workspace →</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `OnboardClientWizard.tsx`**

```typescript
// src/modules/ams/components/onboarding/OnboardClientWizard.tsx
import { useReducer, useState } from 'react';
import {
  initialState, reducer, validators, applyAutoSeed, STEP_ORDER,
  type WizardStep,
} from './state';
import { Stepper } from './Stepper';
import { NameStep } from './steps/NameStep';
import { ProductsStep } from './steps/ProductsStep';
import { RolesStep } from './steps/RolesStep';
import { LevelsStep } from './steps/LevelsStep';
import { CardinalityStep } from './steps/CardinalityStep';
import { OwnerStep } from './steps/OwnerStep';
import { SuccessStep } from './steps/SuccessStep';
import { onboardClient } from '../../api';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function OnboardClientWizard({ onClose, onCreated }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [createdClient, setCreatedClient] = useState<{ id: string; name: string; slug: string; tempPassword: string; email: string } | null>(null);

  const currentIdx = STEP_ORDER.indexOf(state.step as Exclude<WizardStep, 'success'>);
  const isLastStep = state.step === 'owner';
  const isSuccess = state.step === 'success';

  function next() {
    const v = validators[state.step as keyof typeof validators](state);
    if (!v.ok) return;
    if (isLastStep) {
      void submit();
    } else {
      const nextStep = STEP_ORDER[currentIdx + 1]!;
      dispatch({ type: 'goToStep', step: nextStep });
    }
  }

  function back() {
    if (currentIdx > 0) dispatch({ type: 'goToStep', step: STEP_ORDER[currentIdx - 1]! });
  }

  function skip() {
    // Skip is allowed on every step except Name and Owner.
    if (state.step === 'name' || state.step === 'owner') return;
    const nextStep = STEP_ORDER[currentIdx + 1]!;
    dispatch({ type: 'goToStep', step: nextStep });
  }

  async function submit() {
    dispatch({ type: 'submitStart' });
    const seeded = applyAutoSeed(state);
    const r = await onboardClient({
      name: seeded.name,
      enabled_products: seeded.enabled_products,
      roles: seeded.roles,
      levels: seeded.levels,
      cardinality_rules: seeded.cardinality_rules,
      owner: seeded.owner,
    });
    if (!r.ok) {
      const code = r.error.code;
      const details = (r.error as { details?: { section?: string } }).details ?? {};
      dispatch({
        type: 'submitError',
        error: { code, section: (details.section as WizardStep | null) ?? null, details },
      });
      return;
    }
    setCreatedClient({
      id: r.data.client.id,
      name: r.data.client.name,
      slug: r.data.client.slug,
      tempPassword: seeded.owner.temp_password,
      email: seeded.owner.email,
    });
    dispatch({ type: 'submitSuccess' });
    onCreated();
  }

  function tryCancel() {
    if (isSuccess) { onClose(); return; }
    if (confirm('Discard onboarding? Nothing has been saved yet.')) onClose();
  }

  const canSkip = state.step !== 'name' && state.step !== 'owner' && !isSuccess;
  const canNext = !isSuccess && validators[state.step as keyof typeof validators]?.(state).ok !== false;

  return (
    <div onClick={tryCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(680px, 92vw)', maxHeight: '90vh', overflow: 'auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{isSuccess ? 'Workspace created' : 'New Workspace'}</h2>
          <button type="button" className="btn btn-ghost" onClick={tryCancel} aria-label="Cancel">×</button>
        </header>

        <Stepper currentStep={state.step} onJumpTo={(s) => dispatch({ type: 'goToStep', step: s })} />

        {state.step === 'name' && <NameStep state={state} dispatch={dispatch} />}
        {state.step === 'products' && <ProductsStep state={state} dispatch={dispatch} />}
        {state.step === 'roles' && <RolesStep state={state} dispatch={dispatch} />}
        {state.step === 'levels' && <LevelsStep state={state} dispatch={dispatch} />}
        {state.step === 'cardinality' && <CardinalityStep state={state} dispatch={dispatch} />}
        {state.step === 'owner' && <OwnerStep state={state} dispatch={dispatch} />}
        {isSuccess && createdClient && (
          <SuccessStep clientId={createdClient.id} clientName={createdClient.name} clientSlug={createdClient.slug}
            ownerTempPassword={createdClient.tempPassword} ownerEmail={createdClient.email} onClose={onClose} />
        )}

        {state.submitError && (
          <div className="error" style={{ marginTop: 12 }}>
            {state.submitError.code} {state.submitError.section ? `(in ${state.submitError.section})` : ''}
            {state.submitError.section && state.submitError.section !== state.step && (
              <button type="button" className="btn btn-ghost" style={{ marginLeft: 8 }}
                onClick={() => dispatch({ type: 'goToStep', step: state.submitError!.section! })}>Jump to fix →</button>
            )}
          </div>
        )}

        {!isSuccess && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-ghost" onClick={back} disabled={currentIdx === 0 || state.submitting}>← Back</button>
            <div style={{ display: 'flex', gap: 8 }}>
              {canSkip && (
                <button type="button" className="btn btn-ghost" onClick={skip} disabled={state.submitting}>Skip</button>
              )}
              <button type="button" className="btn btn-primary" onClick={next} disabled={!canNext || state.submitting}>
                {state.submitting ? 'Creating…' : (isLastStep ? 'Create workspace' : 'Next →')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `AdminDashboard.tsx`**

Edit `src/modules/ams/pages/AdminDashboard.tsx`. Replace the `AddClientModal` import + usage:

```typescript
// before
import { AddClientModal } from '../components/AddClientModal';
// ...
{showAdd && (
  <AddClientModal onClose={() => setShowAdd(false)} onCreated={refresh} />
)}

// after
import { OnboardClientWizard } from '../components/onboarding/OnboardClientWizard';
// ...
{showAdd && (
  <OnboardClientWizard onClose={() => setShowAdd(false)} onCreated={refresh} />
)}
```

- [ ] **Step 4: Verify `AddClientModal` has no other consumers, then delete**

```bash
grep -rn "AddClientModal" src/ --include="*.ts" --include="*.tsx"
```

Expected: only the file itself + the now-removed import in AdminDashboard. If grep returns no live import, delete the file:

```bash
git rm src/modules/ams/components/AddClientModal.tsx
```

If grep finds other consumers (unlikely), leave the file in place and only swap AdminDashboard.

- [ ] **Step 5: Run typecheck + full tests**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean; final test count from prior task (~213) unchanged.

- [ ] **Step 6: Manual smoke test**

Open http://localhost:8888 (start dev server if needed) and sign in as admin.

**Happy-path smoke:**
1. Click `+ Add Client` → wizard opens at Name step. Stepper shows 6 dots, first active.
2. Type "Smoke Test Wizard" → URL slug preview shows `smoke-test-wizard`. Click Next.
3. Toggle on `saloon-booking`. Click Next.
4. Add role: key `owner`, label `Owner`, color blue. Add role: key `staff`, label `Staff`, color green. Click Next.
5. Add level: number `1`, label `Primary`, allowed = `Owner`. Add level: number `2`, label `Secondary`, allowed = `Staff`. Click Next.
6. Add rule: parent `(top-level)`, child `Owner`, max `1`. Click Next.
7. Owner step: name `Smoke Owner`, email `smoke-owner-<timestamp>@example.com`, Regen temp pw → click Show to verify, then click `Create workspace`.
8. SuccessStep renders with login URL + email + temp pw + an `Open workspace →` button.
9. Click `Open workspace →` → lands on `/clients/<new-id>`. Verify: Owner chip at L1, Products section shows `saloon-booking` enabled, Configure shows 2 roles + 2 levels + 1 cardinality rule.

**Skip-path smoke:**
1. Click `+ Add Client` again. Name `Quick Skip Wizard`. Next.
2. Click Skip 4 times (Products → Roles → Levels → Cardinality).
3. Land on Owner step. Note caption mentions "Role will be **Owner**" (auto-seeded). Fill name `Quick Owner`, email, Regen pw, Create.
4. SuccessStep renders → Open workspace → verify the auto-seeded role + level + Owner exist.

**Cancel smoke:**
1. Open wizard, type a name, click ×. Confirm dialog. Confirm → wizard closes. Dashboard refresh shows no new client.

**Error smoke (optional but recommended):**
1. Use the same email twice across two consecutive wizard runs → second one should show inline `email_already_has_login_in_this_workspace (in owner)` error with a `Jump to fix →` link.

If any of those fail, fix before committing.

- [ ] **Step 7: Commit + push**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(onboarding): wizard shell + SuccessStep + AdminDashboard wire-up

OnboardClientWizard orchestrates the 6 steps via useReducer, validates
each step, supports Skip on the 4 middle steps, applies auto-seed at
submit. SuccessStep shows the Owner's temp credentials with an Open
workspace CTA. AdminDashboard swaps AddClientModal for the wizard.
AddClientModal deleted (no remaining consumers).

Closes the spec at docs/superpowers/specs/2026-06-03-onboarding-wizard-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Push happens via the controller's gate after final review (saved feedback `feedback_no_push_without_approval`).

---

## Self-review checklist

- [ ] `npm run typecheck` clean.
- [ ] `npm test` shows previous + ~6 (onboard-client integration) + ~13 (wizard state unit) = ~213 passing.
- [ ] No `AddClientModal` references remain anywhere in `src/`.
- [ ] Wizard's `onCreated` callback fires before SuccessStep renders so the AdminDashboard's client list refreshes immediately.
- [ ] Skip is disabled on Name + Owner steps; enabled on the 4 middle steps.
- [ ] Owner step caption shows the auto-seeded "Owner" role name when admin skips Roles + Levels.
- [ ] SuccessStep's `Open workspace →` link uses the new client's id (UUID), not slug, so it routes to `/clients/<uuid>` matching the existing admin AccessDashboard route.

## Out of scope (do not implement)

- Business-type presets (templates).
- Wizard state persistence across browser refresh.
- Editing the wizard's inputs after the client exists (those edits happen in ConfigureStructure).
- Bulk-onboarding (CSV of clients).
- Permission-matrix step (admin configures in AccessLevelDashboard post-wizard).
- A "second owner" or "more users" step (admin adds via AccessDashboard's `+ Add user`).
