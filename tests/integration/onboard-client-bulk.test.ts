// tests/integration/onboard-client-bulk.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import onboardBulkHandler from '../../netlify/functions/onboard-client-bulk';
import { assertLastAudit } from '../helpers/audit';

const ADMIN_EMAIL = `onboard-bulk-test-${Date.now()}@example.com`;
const ADMIN_PASSWORD = 'onboard-bulk-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Onboard Bulk Test', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }),
    CTX,
  );
  cookie = lr.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  for (const id of created) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

function uniq(prefix: string, i: number): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}@example.com`;
}

describe('POST /api/onboard-client-bulk', () => {
  test('happy path: 3 roles + 5 team members', async () => {
    const eOwner = uniq('h', 0);
    const eMgr1 = uniq('h', 1);
    const eMgr2 = uniq('h', 2);
    const eStl1 = uniq('h', 3);
    const eStl2 = uniq('h', 4);
    const body = {
      workspace: { name: `Onboard Bulk Happy ${Date.now()}-${Math.random()}`, enabled_products: ['saloon-booking'] },
      roles: [
        { label: 'Owner', max_per_parent: 1 },
        { label: 'Manager', max_per_parent: 3 },
        { label: 'Stylist', max_per_parent: null },
      ],
      team: [
        { display_name: 'O', role_label: 'Owner', parent_email: null, email: eOwner, phone: null, notes: null, temp_password: null },
        { display_name: 'M1', role_label: 'Manager', parent_email: eOwner, email: eMgr1, phone: null, notes: null, temp_password: null },
        { display_name: 'M2', role_label: 'Manager', parent_email: eOwner, email: eMgr2, phone: null, notes: null, temp_password: null },
        { display_name: 'S1', role_label: 'Stylist', parent_email: eMgr1, email: eStl1, phone: null, notes: null, temp_password: null },
        { display_name: 'S2', role_label: 'Stylist', parent_email: eMgr1, email: eStl2, phone: null, notes: null, temp_password: null },
      ],
    };
    const r = await onboardBulkHandler(
      new Request('http://localhost/api/onboard-client-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const res = await r.json() as {
      client: { id: string; slug: string };
      owner_node_id: string;
      team_member_count: number;
      credentials: { display_name: string; email: string; temp_password: string }[];
    };
    created.push(res.client.id);
    expect(res.team_member_count).toBe(5);
    expect(res.credentials).toHaveLength(5);
    for (const c of res.credentials) {
      expect(c.temp_password.length).toBeGreaterThanOrEqual(12);
    }
    const rolesRows = (await sql`SELECT count(*)::int AS c FROM public.client_roles WHERE client_id = ${res.client.id}::uuid`) as { c: number }[];
    expect(rolesRows[0]!.c).toBe(3);
    const levelsRows = (await sql`SELECT count(*)::int AS c FROM public.client_levels WHERE client_id = ${res.client.id}::uuid`) as { c: number }[];
    expect(levelsRows[0]!.c).toBe(3);
    const cardRows = (await sql`SELECT count(*)::int AS c FROM public.client_cardinality_rules WHERE client_id = ${res.client.id}::uuid`) as { c: number }[];
    expect(cardRows[0]!.c).toBe(2);    // only Owner + Manager have non-null max_per_parent
    const nodeRows = (await sql`SELECT count(*)::int AS c FROM public.user_nodes WHERE client_id = ${res.client.id}::uuid`) as { c: number }[];
    expect(nodeRows[0]!.c).toBe(5);
    const credRows = (await sql`SELECT count(*)::int AS c FROM public.user_node_credentials WHERE client_id = ${res.client.id}::uuid`) as { c: number }[];
    expect(credRows[0]!.c).toBe(5);
    await assertLastAudit(sql, {
      op: 'client.onboarded_bulk', targetType: 'client', targetId: res.client.id, clientId: res.client.id,
    });
  });

  test('auto-gen passwords when temp_password is null', async () => {
    const body = {
      workspace: { name: `Onboard Bulk Autogen ${Date.now()}-${Math.random()}`, enabled_products: [] },
      roles: [{ label: 'Owner', max_per_parent: 1 }],
      team: [{ display_name: 'O', role_label: 'Owner', parent_email: null, email: uniq('ag', 0), phone: null, notes: null, temp_password: null }],
    };
    const r = await onboardBulkHandler(
      new Request('http://localhost/api/onboard-client-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const res = await r.json() as { client: { id: string }; credentials: { temp_password: string }[] };
    created.push(res.client.id);
    expect(res.credentials[0]!.temp_password.length).toBeGreaterThanOrEqual(12);
  });

  test('pre-validation: unknown role label → 400, no DB writes', async () => {
    const wsName = `Onboard Bulk Unknown ${Date.now()}-${Math.random()}`;
    const body = {
      workspace: { name: wsName, enabled_products: [] },
      roles: [{ label: 'Owner', max_per_parent: 1 }],
      team: [{ display_name: 'O', role_label: 'NotARole', parent_email: null, email: uniq('u', 0), phone: null, notes: null, temp_password: null }],
    };
    const r = await onboardBulkHandler(
      new Request('http://localhost/api/onboard-client-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
    const body2 = await r.json() as { error: { code: string; details: { errors: { section: string }[] } } };
    expect(body2.error.code).toBe('bulk_validation_failed');
    expect(body2.error.details.errors[0]!.section).toBe('team');
    // Scope the "no DB write" check to this test's unique workspace name so
    // concurrent test files don't poison the count.
    const matches = (await sql`SELECT count(*)::int AS c FROM public.clients WHERE name = ${wsName}`) as { c: number }[];
    expect(matches[0]!.c).toBe(0);
  });

  test('cross-row parent_email resolves to in-batch row', async () => {
    const eOwner = uniq('cr', 0);
    const eMgr = uniq('cr', 1);
    const body = {
      workspace: { name: `Onboard Bulk Cross ${Date.now()}-${Math.random()}`, enabled_products: [] },
      roles: [
        { label: 'Owner', max_per_parent: 1 },
        { label: 'Manager', max_per_parent: 2 },
      ],
      team: [
        { display_name: 'O', role_label: 'Owner', parent_email: null, email: eOwner, phone: null, notes: null, temp_password: null },
        { display_name: 'M', role_label: 'Manager', parent_email: eOwner, email: eMgr, phone: null, notes: null, temp_password: null },
      ],
    };
    const r = await onboardBulkHandler(
      new Request('http://localhost/api/onboard-client-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const res = await r.json() as { client: { id: string } };
    created.push(res.client.id);
    const rows = (await sql`
      SELECT n.display_name, p.email AS parent_email
      FROM public.user_nodes n LEFT JOIN public.user_nodes p ON p.id = n.parent_id
      WHERE n.client_id = ${res.client.id}::uuid AND n.display_name = 'M'
    `) as { display_name: string; parent_email: string | null }[];
    expect(rows[0]!.parent_email).toBe(eOwner);
  });

  test('no L1 owner → 400 no_l1_owner', async () => {
    const body = {
      workspace: { name: `Onboard Bulk NoOwner ${Date.now()}-${Math.random()}`, enabled_products: [] },
      roles: [
        { label: 'Owner', max_per_parent: 1 },
        { label: 'Manager', max_per_parent: 3 },
      ],
      team: [
        { display_name: 'M', role_label: 'Manager', parent_email: null, email: uniq('nl', 0), phone: null, notes: null, temp_password: null },
      ],
    };
    const r = await onboardBulkHandler(
      new Request('http://localhost/api/onboard-client-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
    const body2 = await r.json() as { error: { code: string } };
    expect(body2.error.code).toBe('no_l1_owner');
  });

  test('cap enforcement: team length 501 → 400 too_many_rows', async () => {
    const team = Array.from({ length: 501 }, (_, i) => ({
      display_name: `T${i}`, role_label: 'Owner', parent_email: null, email: uniq('cap', i),
      phone: null, notes: null, temp_password: null,
    }));
    const body = {
      workspace: { name: `Onboard Bulk Cap ${Date.now()}-${Math.random()}`, enabled_products: [] },
      roles: [{ label: 'Owner', max_per_parent: 1 }],
      team,
    };
    const r = await onboardBulkHandler(
      new Request('http://localhost/api/onboard-client-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
    const body2 = await r.json() as { error: { code: string } };
    expect(body2.error.code).toBe('too_many_rows');
  });

  test('permission gate: missing admin cookie → 401', async () => {
    const r = await onboardBulkHandler(
      new Request('http://localhost/api/onboard-client-bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: { name: 'x', enabled_products: [] },
          roles: [{ label: 'Owner', max_per_parent: 1 }],
          team: [{ display_name: 'O', role_label: 'Owner', parent_email: null, email: uniq('p', 0), phone: null, notes: null, temp_password: null }],
        }),
      }),
      CTX,
    );
    expect(r.status).toBe(401);
  });
});
