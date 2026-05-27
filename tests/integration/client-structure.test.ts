// tests/integration/client-structure.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientStructureHandler from '../../netlify/functions/client-structure';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientRolesDetailHandler from '../../netlify/functions/client-roles-detail';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import clientLevelsDetailHandler from '../../netlify/functions/client-levels-detail';
import clientCardinalityHandler from '../../netlify/functions/client-cardinality';

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
});
