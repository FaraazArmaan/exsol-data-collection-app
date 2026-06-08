// tests/integration/user-nodes-role-change.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import clientCardinalityHandler from '../../netlify/functions/client-cardinality';
import userNodesHandler from '../../netlify/functions/user-nodes';
import roleChangeHandler from '../../netlify/functions/user-nodes-role-change';
import uLoginHandler from '../../netlify/functions/u-login';
import { assertLastAudit } from '../helpers/audit';

const ADMIN_EMAIL = `role-change-test-${Date.now()}@example.com`;
const ADMIN_PASSWORD = 'role-change-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let clientId: string;
let roleShop: string, roleA: string, roleB: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Role Change Test', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
  `;
});

async function setupClient() {
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
      body: JSON.stringify({ name: `Role Change Test ${Date.now()}-${Math.random()}` }),
    }), CTX,
  );
  clientId = (await cr.json() as { client: { id: string } }).client.id;
  created.push(clientId);
  const r1 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'shop', label: 'Shop', color: '#ef4444' }),
    }), CTX,
  );
  roleShop = (await r1.json() as { role: { id: string } }).role.id;
  const r2 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'mgr', label: 'Manager', color: '#3b82f6' }),
    }), CTX,
  );
  roleA = (await r2.json() as { role: { id: string } }).role.id;
  const r3 = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'sr_mgr', label: 'Senior Manager', color: '#10b981' }),
    }), CTX,
  );
  roleB = (await r3.json() as { role: { id: string } }).role.id;
  await clientLevelsHandler(
    new Request(`http://localhost/api/client-levels?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 1, label: 'Top', allowed_role_ids: [roleShop] }),
    }), CTX,
  );
  await clientLevelsHandler(
    new Request(`http://localhost/api/client-levels?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 2, allowed_role_ids: [roleA, roleB] }),
    }), CTX,
  );
  await clientCardinalityHandler(
    new Request(`http://localhost/api/client-cardinality?client=${clientId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ rules: [
        { parent_role_id: null, child_role_id: roleShop, max_children: 1 },
        { parent_role_id: roleShop, child_role_id: roleA, max_children: 2 },
        { parent_role_id: roleShop, child_role_id: roleB, max_children: 2 },
      ] }),
    }), CTX,
  );
}
beforeEach(async () => { await setupClient(); });
afterAll(async () => {
  for (const id of created) { try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ } }
});

async function createNode(opts: { role_id: string; level_number: number | null; parent_id: string | null; display_name: string }): Promise<string> {
  const r = await userNodesHandler(
    new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(opts),
    }), CTX,
  );
  return (await r.json() as { node: { id: string } }).node.id;
}

describe('POST /api/user-nodes-role-change', () => {
  test('happy path: admin changes Manager → Senior Manager', async () => {
    const shopId = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    const mgrId = await createNode({ role_id: roleA, level_number: 2, parent_id: shopId, display_name: 'M1' });

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_id: mgrId, new_role_id: roleB }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: true; node: { id: string; role_id: string } };
    expect(body.node.role_id).toBe(roleB);

    const updated = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${mgrId}::uuid`) as { role_id: string }[];
    expect(updated[0]!.role_id).toBe(roleB);

    await assertLastAudit(sql, {
      op: 'users.role_changed',
      targetType: 'user_node',
      targetId: mgrId,
      clientId,
    });
  });

  test('L1 owner changes a node in their workspace', async () => {
    const ownerEmail = `owner-${Date.now()}@example.com`;
    const ownerPw = 'owner-pw-123';
    const ownerRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Owner',
          email: ownerEmail, create_login: true, temp_password: ownerPw,
        }),
      }), CTX,
    );
    expect(ownerRes.status).toBe(201);
    const ownerJson = await ownerRes.json() as { node: { id: string } };
    const ownerId = ownerJson.node.id;

    // Slug: fetch from clients table (the user-nodes POST may not return it).
    const slugRow = (await sql`SELECT slug FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1`) as { slug: string }[];
    const slug = slugRow[0]!.slug;

    const login = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, password: ownerPw }),
      }), CTX,
    );
    expect(login.status).toBe(200);
    const ownerCookie = login.headers.get('set-cookie')!.split(';')[0]!;

    const mgrId = await createNode({ role_id: roleA, level_number: 2, parent_id: ownerId, display_name: 'M-by-owner' });

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ node_id: mgrId, new_role_id: roleB }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const updated = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${mgrId}::uuid`) as { role_id: string }[];
    expect(updated[0]!.role_id).toBe(roleB);
  });

  test('L2+ bucket-user is rejected with forbidden_role_change_scope', async () => {
    const ownerEmail = `o2-${Date.now()}@example.com`;
    const ownerPw = 'o2-pw-123';
    const ownerRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Owner2',
          email: ownerEmail, create_login: true, temp_password: ownerPw,
        }),
      }), CTX,
    );
    const ownerJson = await ownerRes.json() as { node: { id: string } };
    const ownerId = ownerJson.node.id;

    const slugRow = (await sql`SELECT slug FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1`) as { slug: string }[];
    const slug = slugRow[0]!.slug;

    const mgrEmail = `m2-${Date.now()}@example.com`;
    const mgrPw = 'm2-pw-123';
    const mgrRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleA, level_number: 2, parent_id: ownerId, display_name: 'L2Mgr',
          email: mgrEmail, create_login: true, temp_password: mgrPw,
        }),
      }), CTX,
    );
    expect(mgrRes.status).toBe(201);

    // Grant _platform.users.edit to L2 so the request reaches the
    // scope check (otherwise authenticateForPermission returns plain
    // 'forbidden' before our handler runs).
    await sql`
      UPDATE public.client_levels
      SET permissions = '{"_platform.users.edit": true}'::jsonb
      WHERE client_id = ${clientId}::uuid AND level_number = 2
    `;

    const login = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mgrEmail, password: mgrPw }),
      }), CTX,
    );
    const mgrCookie = login.headers.get('set-cookie')!.split(';')[0]!;

    // The L2 manager tries to change a peer's role.
    const targetId = await createNode({ role_id: roleA, level_number: 2, parent_id: ownerId, display_name: 'Peer' });

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: mgrCookie },
        body: JSON.stringify({ node_id: targetId, new_role_id: roleB }),
      }), CTX,
    );
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('forbidden_role_change_scope');

    const after = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${targetId}::uuid`) as { role_id: string }[];
    expect(after[0]!.role_id).toBe(roleA);
  });

  test('self-target: caller hits self_role_change_forbidden', async () => {
    const ownerEmail = `o-self-${Date.now()}@example.com`;
    const ownerPw = 'o-self-pw';
    const ownerRes = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleShop, level_number: 1, parent_id: null, display_name: 'OwnerSelf',
          email: ownerEmail, create_login: true, temp_password: ownerPw,
        }),
      }), CTX,
    );
    const ownerJson = await ownerRes.json() as { node: { id: string } };
    const ownerId = ownerJson.node.id;

    const slugRow = (await sql`SELECT slug FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1`) as { slug: string }[];
    const slug = slugRow[0]!.slug;

    const login = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, password: ownerPw }),
      }), CTX,
    );
    const ownerCookie = login.headers.get('set-cookie')!.split(';')[0]!;

    // Owner targets their own user_node. Self-block fires BEFORE the level
    // or no-op checks per spec §6.3 step 6.
    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ node_id: ownerId, new_role_id: roleA }),
      }), CTX,
    );
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('self_role_change_forbidden');
  });

  test('new role not in level allowed_role_ids → level_disallows_role', async () => {
    const shopId = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    const mgrId = await createNode({ role_id: roleA, level_number: 2, parent_id: shopId, display_name: 'M' });

    // Try to assign roleShop (an L1 role) to an L2 node.
    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_id: mgrId, new_role_id: roleShop }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('level_disallows_role');
    const after = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${mgrId}::uuid`) as { role_id: string }[];
    expect(after[0]!.role_id).toBe(roleA);
  });

  test('cardinality cap exceeded → cardinality_exceeded with max', async () => {
    const shopId = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    // Fixture: cap of roleB under roleShop is 2. Create 2 roleB children + 1 roleA target.
    await createNode({ role_id: roleB, level_number: 2, parent_id: shopId, display_name: 'B1' });
    await createNode({ role_id: roleB, level_number: 2, parent_id: shopId, display_name: 'B2' });
    const mgrId = await createNode({ role_id: roleA, level_number: 2, parent_id: shopId, display_name: 'A1' });

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_id: mgrId, new_role_id: roleB }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string; details: { max: number } } };
    expect(body.error.code).toBe('cardinality_exceeded');
    expect(body.error.details.max).toBe(2);
    const after = (await sql`SELECT role_id FROM public.user_nodes WHERE id = ${mgrId}::uuid`) as { role_id: string }[];
    expect(after[0]!.role_id).toBe(roleA);
  });

  test('target has level_number IS NULL → unassigned_node', async () => {
    // Insert an unassigned node via SQL (the POST endpoint enforces level_number).
    const orphan = (await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleA}::uuid, NULL, NULL, 'orphan', '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const orphanId = orphan[0]!.id;

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_id: orphanId, new_role_id: roleB }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('unassigned_node');
  });

  test('new_role_id equals current role_id → 200 no_change, no UPDATE, no audit', async () => {
    const shopId = await createNode({ role_id: roleShop, level_number: 1, parent_id: null, display_name: 'Shop' });
    const mgrId = await createNode({ role_id: roleA, level_number: 2, parent_id: shopId, display_name: 'M' });

    const auditBefore = (await sql`
      SELECT count(*)::int AS c FROM public.audit_log WHERE target_id = ${mgrId} AND op = 'users.role_changed'
    `) as { c: number }[];

    const r = await roleChangeHandler(
      new Request(`http://localhost/api/user-nodes-role-change?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ node_id: mgrId, new_role_id: roleA }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: true; no_change: boolean };
    expect(body.no_change).toBe(true);

    const auditAfter = (await sql`
      SELECT count(*)::int AS c FROM public.audit_log WHERE target_id = ${mgrId} AND op = 'users.role_changed'
    `) as { c: number }[];
    expect(auditAfter[0]!.c).toBe(auditBefore[0]!.c);
  });
});
