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
import uLoginHandler from '../../netlify/functions/u-login';
import { assertLastAudit } from '../helpers/audit';

const ADMIN_EMAIL = 'user-nodes-move-test@example.com';
const ADMIN_PASSWORD = 'user-nodes-move-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let testClientId: string;
let testClientSlug: string;
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
  const created = (await cr.json() as { client: { id: string; slug: string } }).client;
  testClientId = created.id;
  testClientSlug = created.slug;
  createdClients.push(testClientId);

  // Three roles, three levels, no cardinality caps.
  roleShop  = (await (await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${testClientId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ key: 'shop',  label: 'Shop',  color: '#ef4444' }) }), CTX)).json() as { role: { id: string } }).role.id;
  roleOwner = (await (await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${testClientId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }) }), CTX)).json() as { role: { id: string } }).role.id;
  roleEmp   = (await (await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${testClientId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ key: 'emp',   label: 'Emp',   color: '#22c55e' }) }), CTX)).json() as { role: { id: string } }).role.id;

  for (const n of [1, 2, 3]) {
    await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: n }),
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
    await assertLastAudit(sql, {
      op: 'user_node.moved',
      targetType: 'user_node',
      targetId: emp,
      clientId: testClientId,
    });
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

  test('L1 Owner (bucket-user) can move a node within their workspace', async () => {
    // Create an L1 Shop that doubles as our Owner login.
    const ownerEmail = `move-owner-${Date.now()}@example.com`;
    const ownerPw = 'move-owner-pw-1';
    const ownerCreate = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShop, level_number: 1, parent_id: null,
          display_name: 'Owner Shop', email: ownerEmail,
          create_login: true, temp_password: ownerPw,
        }),
      }), CTX,
    );
    expect(ownerCreate.status).toBe(201);
    const shopId = (await ownerCreate.json() as { node: { id: string } }).node.id;
    const login = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, password: ownerPw }),
      }), CTX,
    );
    expect(login.status).toBe(200);
    const ownerCookie = login.headers.get('set-cookie')!.split(';')[0]!;

    // Two L2 owners + an L3 emp under ownerA. Owner moves emp from ownerA → ownerB.
    const ownerA = await createNode({ role_id: roleOwner, level_number: 2, parent_id: shopId, display_name: 'OA' });
    const ownerB = await createNode({ role_id: roleOwner, level_number: 2, parent_id: shopId, display_name: 'OB' });
    const emp = await createNode({ role_id: roleEmp, level_number: 3, parent_id: ownerA, display_name: 'E' });

    const r = await userNodesMoveHandler(
      new Request(`http://localhost/api/user-nodes-move?id=${emp}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ parent_id: ownerB, level_number: 3 }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { node: { parent_id: string } };
    expect(body.node.parent_id).toBe(ownerB);
  });

  test('L1 Owner cannot move a node in another workspace → 403', async () => {
    // Owner-A in testClient.
    const ownerEmail = `move-owner-cross-${Date.now()}@example.com`;
    const ownerPw = 'move-owner-cross-pw-1';
    const ownerCreate = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShop, level_number: 1, parent_id: null,
          display_name: 'Owner Shop X', email: ownerEmail,
          create_login: true, temp_password: ownerPw,
        }),
      }), CTX,
    );
    expect(ownerCreate.status).toBe(201);
    const login = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, password: ownerPw }),
      }), CTX,
    );
    expect(login.status).toBe(200);
    const ownerCookie = login.headers.get('set-cookie')!.split(';')[0]!;

    // Build client B + a node in B.
    const cr2 = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: `Move Other ${Date.now()}` }),
      }), CTX,
    );
    const clientB = (await cr2.json() as { client: { id: string } }).client;
    createdClients.push(clientB.id);
    const rrB = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${clientB.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'shop', label: 'Shop', color: '#ef4444' }),
      }), CTX,
    );
    const roleShopB = (await rrB.json() as { role: { id: string } }).role.id;
    await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${clientB.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 1 }),
      }), CTX,
    );
    const nodeBResp = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientB.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShopB, level_number: 1, parent_id: null, display_name: 'B shop',
        }),
      }), CTX,
    );
    const nodeBId = (await nodeBResp.json() as { node: { id: string } }).node.id;

    const r = await userNodesMoveHandler(
      new Request(`http://localhost/api/user-nodes-move?id=${nodeBId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ parent_id: null, level_number: null }),
      }), CTX,
    );
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('forbidden_cross_client');
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
    await createNode({ role_id: roleEmp, level_number: 3, parent_id: ownerB, display_name: 'B1' });

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
