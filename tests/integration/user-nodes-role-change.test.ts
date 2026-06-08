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
});
