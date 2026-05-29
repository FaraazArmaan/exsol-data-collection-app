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
    const results = await Promise.allSettled(reqs);
    const statuses = results.map((r) => r.status === 'fulfilled' ? r.value.status : 0).sort();
    expect(statuses).toEqual([201, 409]);
  });

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

  test('PATCH email propagates to user_node_credentials so login email stays in sync', async () => {
    // Create a top-level node with create_login (typo in email).
    const typoEmail = `typo-${Date.now()}@example.com`;
    const correctedEmail = typoEmail.replace('typo-', 'correct-');
    const r = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShop, level_number: 1, parent_id: null,
          display_name: 'Tim Typo', email: typoEmail,
          create_login: true, temp_password: 'temp-test-1234',
        }),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const nodeId = (await r.json() as { node: { id: string } }).node.id;

    // Confirm both rows have the typo email.
    const before = (await sql`
      SELECT n.email AS node_email, c.email AS cred_email
      FROM public.user_nodes n
      LEFT JOIN public.user_node_credentials c ON c.user_node_id = n.id
      WHERE n.id = ${nodeId}::uuid
    `) as { node_email: string; cred_email: string }[];
    expect(before[0]!.node_email).toBe(typoEmail);
    expect(before[0]!.cred_email).toBe(typoEmail);

    // PATCH the node to the corrected email.
    const p = await userNodesDetailHandler(
      new Request(`http://localhost/api/user-nodes-detail?id=${nodeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ email: correctedEmail }),
      }),
      CTX,
    );
    expect(p.status).toBe(200);

    // BOTH rows should now have the corrected email.
    const after = (await sql`
      SELECT n.email AS node_email, c.email AS cred_email
      FROM public.user_nodes n
      LEFT JOIN public.user_node_credentials c ON c.user_node_id = n.id
      WHERE n.id = ${nodeId}::uuid
    `) as { node_email: string; cred_email: string }[];
    expect(after[0]!.node_email).toBe(correctedEmail);
    expect(after[0]!.cred_email).toBe(correctedEmail);
  });
});
