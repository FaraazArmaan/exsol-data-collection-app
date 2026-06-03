vi.mock('../../netlify/functions/_shared/google-verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import type { Context } from '@netlify/functions';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import userNodesHandler from '../../netlify/functions/user-nodes';
import { subtreeOf } from '../../netlify/functions/_shared/subtree';
import {
  requirePermission, ForbiddenError, UnauthorizedError,
} from '../../netlify/functions/_shared/permissions';
import userNodesHandler2 from '../../netlify/functions/user-nodes';
import uLoginHandler from '../../netlify/functions/u-login';

const ADMIN_EMAIL = 'pmw-test@example.com';
const ADMIN_PASSWORD = 'pmw-test-pw';
const CTX = {} as Context;

let sql: NeonQueryFunction<false, false>;
let cookie: string;
let testClientId: string;
let roleId: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'PMW Admin', false)
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
  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `PMW Test ${Date.now()}` }),
    }), CTX,
  );
  testClientId = ((await cr.json()) as { client: { id: string } }).client.id;
  created.push(testClientId);
  const rr = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'staff', label: 'Staff', color: '#888888' }),
    }), CTX,
  );
  roleId = ((await rr.json()) as { role: { id: string } }).role.id;
  for (const lvl of [1, 2, 3]) {
    await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: lvl, allowed_role_ids: [roleId] }),
    }), CTX);
  }
});

afterAll(async () => {
  for (const id of created) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

async function createNode(displayName: string, levelNumber: number, parentId: string | null): Promise<string> {
  const r = await userNodesHandler(
    new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        role_id: roleId, level_number: levelNumber, parent_id: parentId,
        display_name: displayName,
      }),
    }), CTX,
  );
  return ((await r.json()) as { node: { id: string } }).node.id;
}

describe('subtreeOf', () => {
  it('returns just the root for a leaf node', async () => {
    const l1 = await createNode('A', 1, null);
    const ids = await subtreeOf(sql, l1);
    expect(ids).toEqual([l1]);
  });

  it('returns root + all descendants for a multi-level tree', async () => {
    const l1 = await createNode('A', 1, null);
    const l2a = await createNode('A.1', 2, l1);
    const l2b = await createNode('A.2', 2, l1);
    const l3 = await createNode('A.1.1', 3, l2a);
    const ids = (await subtreeOf(sql, l1)).sort();
    expect(ids).toEqual([l1, l2a, l2b, l3].sort());
  });

  it('does not cross siblings', async () => {
    const l1a = await createNode('A', 1, null);
    const l1b = await createNode('B', 1, null);
    const l2b = await createNode('B.1', 2, l1b);
    const ids = await subtreeOf(sql, l1a);
    expect(ids).not.toContain(l1b);
    expect(ids).not.toContain(l2b);
  });
});

async function createUserWithLogin(displayName: string, levelNumber: number, parentId: string | null, email: string, password: string): Promise<{ nodeId: string }> {
  const r = await userNodesHandler2(
    new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        role_id: roleId, level_number: levelNumber, parent_id: parentId,
        display_name: displayName, email,
        create_login: true, temp_password: password,
      }),
    }), CTX,
  );
  return { nodeId: ((await r.json()) as { node: { id: string } }).node.id };
}

async function buCookieFor(email: string, password: string): Promise<string> {
  const rows = (await sql`SELECT slug FROM public.clients WHERE id = ${testClientId}`) as { slug: string }[];
  const slug = rows[0]!.slug;
  const r = await uLoginHandler(
    new Request(`http://localhost/api/u-login?client=${slug}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }), CTX,
  );
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

async function setL2Permissions(perms: Record<string, true>) {
  const l2 = (await sql`SELECT id FROM public.client_levels WHERE client_id = ${testClientId} AND level_number = 2`) as { id: string }[];
  await sql`UPDATE public.client_levels SET permissions = ${JSON.stringify(perms)}::jsonb WHERE id = ${l2[0]!.id}`;
}

describe('requirePermission', () => {
  it('allows the call when the matrix has the key', async () => {
    const { nodeId: parentId } = await createUserWithLogin('SecondaryA', 1, null, `sec-a-${Date.now()}@example.com`, 'secret-1234');
    const email = `sec-b-${Date.now()}@example.com`;
    await createUserWithLogin('SecondaryB', 2, parentId, email, 'secret-1234');
    const buCookie = await buCookieFor(email, 'secret-1234');
    await setL2Permissions({ '_platform.users.view': true });
    const req = new Request('http://localhost/test', { headers: { cookie: buCookie } });
    const session = await requirePermission(req, '_platform.users.view');
    expect(session.kind).toBe('bucket_user');
  });

  it('throws ForbiddenError when the matrix does NOT have the key', async () => {
    const { nodeId: parentId } = await createUserWithLogin('SecondaryC-parent', 1, null, `sec-c-parent-${Date.now()}@example.com`, 'secret-1234');
    const email = `sec-c-${Date.now()}@example.com`;
    await createUserWithLogin('SecondaryC', 2, parentId, email, 'secret-1234');
    const buCookie = await buCookieFor(email, 'secret-1234');
    await setL2Permissions({}); // empty matrix
    const req = new Request('http://localhost/test', { headers: { cookie: buCookie } });
    await expect(requirePermission(req, '_platform.users.view')).rejects.toThrow(ForbiddenError);
  });

  it('Primary (L1) bypasses the matrix check', async () => {
    const email = `pri-${Date.now()}@example.com`;
    await createUserWithLogin('Primary1', 1, null, email, 'secret-1234');
    const buCookie = await buCookieFor(email, 'secret-1234');
    const req = new Request('http://localhost/test', { headers: { cookie: buCookie } });
    const session = await requirePermission(req, '_platform.structure.delete');
    expect(session.kind).toBe('bucket_user');
  });

  it('admin session bypasses the matrix check', async () => {
    const req = new Request('http://localhost/test', { headers: { cookie } });
    const session = await requirePermission(req, '_platform.users.delete');
    expect(session.kind).toBe('admin');
  });

  it('no session → UnauthorizedError', async () => {
    const req = new Request('http://localhost/test');
    await expect(requirePermission(req, '_platform.users.view')).rejects.toThrow(UnauthorizedError);
  });
});
