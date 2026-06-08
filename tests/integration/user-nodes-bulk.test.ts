// tests/integration/user-nodes-bulk.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import clientCardinalityHandler from '../../netlify/functions/client-cardinality';
import bulkHandler from '../../netlify/functions/user-nodes-bulk';
import { assertLastAudit } from '../helpers/audit';

const ADMIN_EMAIL = `bulk-invite-test-${Date.now()}@example.com`;
const ADMIN_PASSWORD = 'bulk-invite-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let clientId: string;
let roleShop: string, roleOwner: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Bulk Invite Test', false)
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
      body: JSON.stringify({ name: `Bulk Test ${Date.now()}-${Math.random()}` }),
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
  roleOwner = (await r2.json() as { role: { id: string } }).role.id;
  await clientLevelsHandler(
    new Request(`http://localhost/api/client-levels?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 1, label: 'Top' }),
    }),
    CTX,
  );
  await clientLevelsHandler(
    new Request(`http://localhost/api/client-levels?client=${clientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 2 }),
    }),
    CTX,
  );
  await clientCardinalityHandler(
    new Request(`http://localhost/api/client-cardinality?client=${clientId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ rules: [
        { parent_role_id: null, child_role_id: roleShop, max_children: 1 },
        { parent_role_id: roleShop, child_role_id: roleOwner, max_children: 2 },
      ] }),
    }),
    CTX,
  );
}
beforeEach(async () => { await setupClient(); });
afterAll(async () => {
  for (const id of created) { try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ } }
});

function uniq(prefix: string, i: number): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}@example.com`;
}

describe('POST /api/user-nodes-bulk', () => {
  test('happy path: 3 rows, 1 with create_login=true', async () => {
    const e0 = uniq('a', 0);
    const e1 = uniq('a', 1);
    const e2 = uniq('a', 2);
    const r = await bulkHandler(
      new Request(`http://localhost/api/user-nodes-bulk?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ rows: [
          { display_name: 'Shop A', role_key: 'shop', level_number: 1, email: e0 },
          { display_name: 'Owner A1', role_key: 'owner', level_number: 2, parent_email: e0, email: e1,
            create_login: true, temp_password: 'pass1234' },
          { display_name: 'Owner A2', role_key: 'owner', level_number: 2, parent_email: e0, email: e2 },
        ] }),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { nodes: { id: string }[]; login_count: number };
    expect(body.nodes).toHaveLength(3);
    expect(body.login_count).toBe(1);
    const creds = (await sql`SELECT email FROM public.user_node_credentials WHERE client_id = ${clientId}::uuid`) as { email: string }[];
    expect(creds).toHaveLength(1);
    await assertLastAudit(sql, {
      op: 'users.bulk_invited',
      targetType: 'client',
      targetId: clientId,
      clientId,
    });
  });

  test('pre-validation: unknown role_key → 400, no DB writes', async () => {
    const before = (await sql`SELECT count(*)::int AS c FROM public.user_nodes WHERE client_id = ${clientId}::uuid`) as { c: number }[];
    const r = await bulkHandler(
      new Request(`http://localhost/api/user-nodes-bulk?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ rows: [
          { display_name: 'X', role_key: 'not-a-real-role', level_number: 1 },
        ] }),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string; details: { errors: { row_index: number }[] } } };
    expect(body.error.code).toBe('bulk_validation_failed');
    expect(body.error.details.errors[0]!.row_index).toBe(0);
    const after = (await sql`SELECT count(*)::int AS c FROM public.user_nodes WHERE client_id = ${clientId}::uuid`) as { c: number }[];
    expect(after[0]!.c).toBe(before[0]!.c);
  });

  test('cross-row parent: B references A via parent_email — both created', async () => {
    const eA = uniq('cr', 0);
    const eB = uniq('cr', 1);
    const r = await bulkHandler(
      new Request(`http://localhost/api/user-nodes-bulk?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ rows: [
          { display_name: 'Shop CR', role_key: 'shop', level_number: 1, email: eA },
          { display_name: 'Owner CR', role_key: 'owner', level_number: 2, parent_email: eA, email: eB },
        ] }),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const rows = (await sql`
      SELECT n.display_name, p.email AS parent_email
      FROM public.user_nodes n LEFT JOIN public.user_nodes p ON p.id = n.parent_id
      WHERE n.client_id = ${clientId}::uuid AND n.display_name IN ('Shop CR', 'Owner CR')
      ORDER BY n.level_number
    `) as { display_name: string; parent_email: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows[1]!.parent_email).toBe(eA);
  });

  test('cardinality violation: 3 owners under a shop with cap=2 → 400, no DB writes', async () => {
    const eShop = uniq('cap', 0);
    const before = (await sql`SELECT count(*)::int AS c FROM public.user_nodes WHERE client_id = ${clientId}::uuid`) as { c: number }[];
    const r = await bulkHandler(
      new Request(`http://localhost/api/user-nodes-bulk?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ rows: [
          { display_name: 'Shop X', role_key: 'shop', level_number: 1, email: eShop },
          { display_name: 'O1', role_key: 'owner', level_number: 2, parent_email: eShop, email: uniq('cap', 1) },
          { display_name: 'O2', role_key: 'owner', level_number: 2, parent_email: eShop, email: uniq('cap', 2) },
          { display_name: 'O3', role_key: 'owner', level_number: 2, parent_email: eShop, email: uniq('cap', 3) },
        ] }),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('bulk_validation_failed');
    const after = (await sql`SELECT count(*)::int AS c FROM public.user_nodes WHERE client_id = ${clientId}::uuid`) as { c: number }[];
    expect(after[0]!.c).toBe(before[0]!.c);
  });

  test('cap enforcement: 501 rows → 400 too_many_rows', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      display_name: `X${i}`, role_key: 'shop', level_number: 1,
    }));
    const r = await bulkHandler(
      new Request(`http://localhost/api/user-nodes-bulk?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ rows }),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('too_many_rows');
  });

  test('permission gate: missing cookie → 401', async () => {
    const r = await bulkHandler(
      new Request(`http://localhost/api/user-nodes-bulk?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: [{ display_name: 'X', role_key: 'shop', level_number: 1 }] }),
      }),
      CTX,
    );
    expect(r.status).toBe(401);
  });
});
