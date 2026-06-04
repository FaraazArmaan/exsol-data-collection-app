// tests/integration/user-nodes-bulk-role-change.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import clientCardinalityHandler from '../../netlify/functions/client-cardinality';
import userNodesHandler from '../../netlify/functions/user-nodes';
import bulkRoleHandler from '../../netlify/functions/user-nodes-bulk-role-change';
import { assertLastAudit } from '../helpers/audit';

const ADMIN_EMAIL = `bulk-role-test-${Date.now()}@example.com`;
const ADMIN_PASSWORD = 'bulk-role-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let clientId: string;
let roleA: string, roleB: string, roleShop: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Bulk Role Test', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
  `;
});

async function setupClient() {
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
      body: JSON.stringify({ name: `Bulk Role Test ${Date.now()}-${Math.random()}` }),
    }),
    CTX,
  );
  clientId = (await cr.json() as { client: { id: string } }).client.id;
  created.push(clientId);
  const r1 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'shop', label: 'Shop', color: '#ef4444' }),
    }),
    CTX,
  );
  roleShop = (await r1.json() as { role: { id: string } }).role.id;
  const r2 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
    }),
    CTX,
  );
  roleA = (await r2.json() as { role: { id: string } }).role.id;
  const r3 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'staff', label: 'Staff', color: '#10b981' }),
    }),
    CTX,
  );
  roleB = (await r3.json() as { role: { id: string } }).role.id;
  await clientLevelsHandler(
    new Request(`http://localhost/api/client-levels?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 1, label: 'Top', allowed_role_ids: [roleShop] }),
    }),
    CTX,
  );
  await clientLevelsHandler(
    new Request(`http://localhost/api/client-levels?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 2, allowed_role_ids: [roleA, roleB] }),
    }),
    CTX,
  );
  await clientCardinalityHandler(
    new Request(`http://localhost/api/client-cardinality?client=${clientId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ rules: [
        { parent_role_id: null, child_role_id: roleShop, max_children: 1 },
        { parent_role_id: roleShop, child_role_id: roleA, max_children: 2 },
        { parent_role_id: roleShop, child_role_id: roleB, max_children: 1 },
      ] }),
    }),
    CTX,
  );
}
beforeEach(async () => { await setupClient(); });
afterAll(async () => {
  for (const id of created) { try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ } }
});

describe('POST /api/user-nodes-bulk-role-change', () => {
  test('happy path: 1 node_id change role → updated, 1 audit row', async () => {
    const shopRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop H' }),
      }),
      CTX,
    );
    const shopId = (await shopRes.json() as { node: { id: string } }).node.id;
    const oRes1 = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleA, level_number: 2, parent_id: shopId, display_name: 'O1' }),
      }),
      CTX,
    );
    const id1 = (await oRes1.json() as { node: { id: string } }).node.id;

    const r = await bulkRoleHandler(
      new Request(`http://localhost/api/user-nodes-bulk-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_ids: [id1], new_role_id: roleB }),
      }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { updated: number };
    expect(body.updated).toBe(1);
    const updated = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${id1}::uuid`) as { role_id: string }[];
    expect(updated[0]!.role_id).toBe(roleB);
    await assertLastAudit(sql, {
      op: 'users.bulk_role_changed',
      targetType: 'client_role',
      targetId: roleB,
      clientId,
    });
  });

  test('pre-validation: target at level where new role is disallowed → 400, no UPDATEs', async () => {
    const shopRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop P' }),
      }),
      CTX,
    );
    const shopId = (await shopRes.json() as { node: { id: string } }).node.id;

    const r = await bulkRoleHandler(
      new Request(`http://localhost/api/user-nodes-bulk-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_ids: [shopId], new_role_id: roleB }),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('bulk_validation_failed');
    const after = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${shopId}::uuid`) as { role_id: string }[];
    expect(after[0]!.role_id).toBe(roleShop);
  });

  test('cross-client: node_id from another client → 400 cross_client', async () => {
    const cr = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: `Other ${Date.now()}-${Math.random()}` }),
      }),
      CTX,
    );
    const otherClientId = (await cr.json() as { client: { id: string } }).client.id;
    created.push(otherClientId);
    const rr = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${otherClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'foo', label: 'Foo', color: '#000000' }),
      }),
      CTX,
    );
    const otherRoleId = (await rr.json() as { role: { id: string } }).role.id;
    await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${otherClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 1, label: 'Top', allowed_role_ids: [otherRoleId] }),
      }),
      CTX,
    );
    const nr = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${otherClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: otherRoleId, level_number: 1, parent_id: null, display_name: 'Foreign' }),
      }),
      CTX,
    );
    const foreignId = (await nr.json() as { node: { id: string } }).node.id;

    const r = await bulkRoleHandler(
      new Request(`http://localhost/api/user-nodes-bulk-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_ids: [foreignId], new_role_id: roleB }),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('cross_client');
  });

  test('cardinality: change would exceed max-per-parent → 400 bulk_validation_failed', async () => {
    const shopRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop C' }),
      }),
      CTX,
    );
    const shopId = (await shopRes.json() as { node: { id: string } }).node.id;
    const o1 = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleA, level_number: 2, parent_id: shopId, display_name: 'A1' }),
      }),
      CTX,
    );
    const id1 = (await o1.json() as { node: { id: string } }).node.id;
    const s1 = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ role_id: roleB, level_number: 2, parent_id: shopId, display_name: 'S1' }),
      }),
      CTX,
    );
    expect(s1.status).toBe(201);

    const r = await bulkRoleHandler(
      new Request(`http://localhost/api/user-nodes-bulk-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_ids: [id1], new_role_id: roleB }),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('bulk_validation_failed');
  });

  test('cap enforcement: 501 node_ids → 400 too_many_rows', async () => {
    const r = await bulkRoleHandler(
      new Request(`http://localhost/api/user-nodes-bulk-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_ids: Array.from({ length: 501 }, () => crypto.randomUUID()), new_role_id: roleB }),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('too_many_rows');
  });
});
