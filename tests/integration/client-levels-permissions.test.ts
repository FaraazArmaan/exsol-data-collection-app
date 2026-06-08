vi.mock('../../netlify/functions/_shared/google-verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import clientRolesHandler from '../../netlify/functions/client-roles';
import adminClientProductsHandler from '../../netlify/functions/admin-client-products';
import clientLevelsPermissionsHandler from '../../netlify/functions/client-levels-permissions';
import { assertLastAudit } from '../helpers/audit';

const ADMIN_EMAIL = 'clp-test@example.com';
const ADMIN_PASSWORD = 'clp-test-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let clientId: string;
let l2Id: string;
const created: string[] = [];

async function setupClientWithLevel2(): Promise<{ clientId: string; l2Id: string }> {
  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `CLP Test ${Date.now()}` }),
    }), CTX,
  );
  const cid = ((await cr.json()) as { client: { id: string } }).client.id;
  const rr = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${cid}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'staff', label: 'Staff', color: '#888888' }),
    }), CTX,
  );
  const roleId = ((await rr.json()) as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${cid}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ level_number: 1 }),
  }), CTX);
  const l2r = await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${cid}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ level_number: 2 }),
  }), CTX);
  const l2 = ((await l2r.json()) as { level: { id: string } }).level.id;
  return { clientId: cid, l2Id: l2 };
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'CLP Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
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
  const setup = await setupClientWithLevel2();
  clientId = setup.clientId;
  l2Id = setup.l2Id;
  created.push(clientId);
});

afterAll(async () => {
  for (const id of created) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('client-levels-permissions', () => {
  it('GET on a fresh L2 returns empty matrix + only platform rows when no Products are enabled', async () => {
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, { headers: { cookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      permissions: Record<string, true>;
      module_rows: Array<{ module_key: string; bucket: string; verbs: string[] }>;
      platform_rows: Array<{ surface: string; verbs: string[] }>;
    };
    expect(body.permissions).toEqual({});
    expect(body.module_rows).toEqual([]);
    expect(body.platform_rows.map((r) => r.surface).sort()).toEqual(['files', 'settings', 'structure', 'users']);
  });

  it('GET after enabling saloon-booking returns booking + payments rows', async () => {
    await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['saloon-booking'] }),
      }), CTX,
    );
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, { headers: { cookie } }),
      CTX,
    );
    const body = await r.json() as { module_rows: Array<{ module_key: string; bucket: string }> };
    const keys = body.module_rows.map((r) => `${r.module_key}.${r.bucket}`).sort();
    expect(keys).toEqual(['booking.customers', 'booking.employees', 'payments.customers', 'payments.products']);
  });

  it('PUT replaces the matrix (full replace, not merge)', async () => {
    await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['saloon-booking'] }),
      }), CTX,
    );
    await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { 'booking.customers.view': true, '_platform.users.view': true } }),
      }), CTX,
    );
    await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { '_platform.structure.view': true } }),
      }), CTX,
    );
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, { headers: { cookie } }),
      CTX,
    );
    const body = await r.json() as { permissions: Record<string, true> };
    expect(body.permissions).toEqual({ '_platform.structure.view': true });
    await assertLastAudit(sql, {
      op: 'permissions.updated',
      targetType: 'level',
      targetId: l2Id,
      clientId,
    });
  });

  it('PUT rejects keys that reference Modules not enabled by current Products', async () => {
    // No Products enabled — booking.* should be rejected.
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { 'booking.customers.view': true } }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string; details: { key: string } } };
    expect(body.error.code).toBe('invalid_permission_key');
    expect(body.error.details.key).toBe('booking.customers.view');
  });

  it('PUT rejects platform keys with unknown surface', async () => {
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { '_platform.bogus.view': true } }),
      }), CTX,
    );
    expect(r.status).toBe(400);
  });

  it('PUT on L1 (Primary) returns 409 — Primary is implicit all-on', async () => {
    const lr = (await sql`SELECT id FROM public.client_levels WHERE client_id = ${clientId} AND level_number = 1`) as { id: string }[];
    const r = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${lr[0]!.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { '_platform.users.view': true } }),
      }), CTX,
    );
    expect(r.status).toBe(409);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('primary_level_immutable');
  });
});
