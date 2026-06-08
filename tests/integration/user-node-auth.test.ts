// vi.mock must be at top level — vitest hoists it before imports.
vi.mock('../../netlify/functions/_shared/google-verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import { verifyGoogleIdToken } from '../../netlify/functions/_shared/google-verifier';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import userNodesHandler from '../../netlify/functions/user-nodes';
import userNodesDetailHandler from '../../netlify/functions/user-nodes-detail';
import userNodeCredentialHandler from '../../netlify/functions/user-node-credential';
import uClientBySlugHandler from '../../netlify/functions/u-client-by-slug';
import uLoginHandler from '../../netlify/functions/u-login';
import uMeHandler from '../../netlify/functions/u-me';
import uChangePasswordHandler from '../../netlify/functions/u-change-password';
import authMeHandler from '../../netlify/functions/auth-me';
import loginUnifiedHandler from '../../netlify/functions/login';
import forgotPasswordHandler from '../../netlify/functions/forgot-password';
import adminClientProductsHandler from '../../netlify/functions/admin-client-products';
import { assertLastAudit } from '../helpers/audit';

const ADMIN_EMAIL = 'user-node-auth-test@example.com';
const ADMIN_PASSWORD = 'user-node-auth-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let testClientId: string;
let testClientSlug: string;
let roleId: string;
const createdClients: string[] = [];

async function adminLogin() {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const r = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

async function createNodeWithLogin(email: string, tempPassword: string): Promise<string> {
  const r = await userNodesHandler(
    new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        role_id: roleId, level_number: 1, parent_id: null,
        display_name: 'Test User', email,
        create_login: true, temp_password: tempPassword,
      }),
    }), CTX,
  );
  if (r.status !== 201) throw new Error(`create+login failed: ${r.status} ${await r.text()}`);
  return (await r.json() as { node: { id: string } }).node.id;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'UN Auth Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, display_name = 'UN Auth Admin'
  `;
});

beforeEach(async () => {
  cookie = await adminLogin();
  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `UN Auth Test ${Date.now()}` }),
    }), CTX,
  );
  const created = (await cr.json() as { client: { id: string; slug: string } }).client;
  testClientId = created.id;
  testClientSlug = created.slug;
  createdClients.push(testClientId);

  const rr = await clientRolesHandler(
    new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
    }), CTX,
  );
  roleId = (await rr.json() as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ level_number: 1 }),
  }), CTX);
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('user-node auth', () => {
  test('u-client-by-slug returns the client for a valid slug', async () => {
    const r = await uClientBySlugHandler(
      new Request(`http://localhost/api/u-client-by-slug?slug=${testClientSlug}`, { method: 'GET' }),
      CTX,
    );
    expect(r.status).toBe(200);
  });

  test('u-client-by-slug 404 for unknown slug', async () => {
    const r = await uClientBySlugHandler(
      new Request('http://localhost/api/u-client-by-slug?slug=does-not-exist-xyz', { method: 'GET' }),
      CTX,
    );
    expect(r.status).toBe(404);
  });

  test('create node with create_login adds credential row', async () => {
    const email = `un-login-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'temp-pass-1');
    const rows = (await sql`
      SELECT must_change_password, temp_password_views_left
      FROM public.user_node_credentials WHERE user_node_id = ${nodeId}
    `) as { must_change_password: boolean; temp_password_views_left: number }[];
    expect(rows[0]!.must_change_password).toBe(true);
    expect(rows[0]!.temp_password_views_left).toBe(3);
  });

  test('u-login happy path', async () => {
    const email = `un-happy-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'happy-pass-1');
    const r = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'happy-pass-1' }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain('bu_session=');
    const body = await r.json() as { user: { must_change_password: boolean } };
    expect(body.user.must_change_password).toBe(true);
  });

  test('u-login wrong password → 401', async () => {
    const email = `un-wrong-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'correct-pass-1');
    const r = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-pass' }),
      }), CTX,
    );
    expect(r.status).toBe(401);
  });

  test('u-login failure logs an attempt as "failed"', async () => {
    const email = `rate-failed-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'correct-pw-1');
    await sql`DELETE FROM public.login_attempts WHERE email = ${email}`;

    const r = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-pw' }),
      }), CTX,
    );
    expect(r.status).toBe(401);

    const rows = (await sql`
      SELECT outcome FROM public.login_attempts WHERE email = ${email} ORDER BY id DESC LIMIT 1
    `) as { outcome: string }[];
    expect(rows[0]?.outcome).toBe('failed');

    await sql`DELETE FROM public.login_attempts WHERE email = ${email}`;
  });

  test('u-login success logs an attempt as "success"', async () => {
    const email = `rate-success-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'happy-pw-1');
    await sql`DELETE FROM public.login_attempts WHERE email = ${email}`;

    const r = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'happy-pw-1' }),
      }), CTX,
    );
    expect(r.status).toBe(200);

    const rows = (await sql`
      SELECT outcome FROM public.login_attempts WHERE email = ${email} ORDER BY id DESC LIMIT 1
    `) as { outcome: string }[];
    expect(rows[0]?.outcome).toBe('success');

    await sql`DELETE FROM public.login_attempts WHERE email = ${email}`;
  });

  test('u-login returns 429 after 10 failed attempts in 5 minutes', async () => {
    const email = `rate-throttle-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'pw-throttle-1');
    await sql`DELETE FROM public.login_attempts WHERE email = ${email}`;

    // Seed 10 'failed' attempts directly so we don't pay 10× argon2 cost.
    for (let i = 0; i < 10; i++) {
      await sql`
        INSERT INTO public.login_attempts (email, outcome) VALUES (${email}, 'failed')
      `;
    }

    // Even the CORRECT password is rejected with 429 because of the throttle.
    const r = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'pw-throttle-1' }),
      }), CTX,
    );
    expect(r.status).toBe(429);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('too_many_attempts');

    await sql`DELETE FROM public.login_attempts WHERE email = ${email}`;
  });

  test('u-change-password clears must_change_password and wipes plain', async () => {
    const email = `un-change-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'change-me-1');
    const lr = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'change-me-1' }),
      }), CTX,
    );
    const buCookie = lr.headers.get('set-cookie')!.split(';')[0]!;
    const cr = await uChangePasswordHandler(
      new Request('http://localhost/api/u-change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
        body: JSON.stringify({ current_password: 'change-me-1', new_password: 'new-strong-pass' }),
      }), CTX,
    );
    expect(cr.status).toBe(200);
    const rows = (await sql`
      SELECT must_change_password, temp_password_plain FROM public.user_node_credentials
      WHERE user_node_id = ${nodeId}
    `) as { must_change_password: boolean; temp_password_plain: string | null }[];
    expect(rows[0]!.must_change_password).toBe(false);
    expect(rows[0]!.temp_password_plain).toBeNull();
  });

  test('GET credential decrements views_left; at 0 plaintext wiped', async () => {
    const email = `un-views-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'views-test-1');
    const url = `http://localhost/api/user-node-credential?node=${nodeId}`;
    for (let i = 0; i < 3; i++) {
      const r = await userNodeCredentialHandler(new Request(url, { method: 'GET', headers: { cookie } }), CTX);
      expect(r.status).toBe(200);
      const body = await r.json() as { temp_password_plain: string | null; temp_password_views_left: number | null };
      expect(body.temp_password_plain).toBe('views-test-1');
      expect(body.temp_password_views_left).toBe(2 - i);
    }
    const r4 = await userNodeCredentialHandler(new Request(url, { method: 'GET', headers: { cookie } }), CTX);
    const body4 = await r4.json() as { temp_password_plain: string | null };
    expect(body4.temp_password_plain).toBeNull();
    await assertLastAudit(sql, {
      op: 'credential.peeked',
      targetType: 'user_node',
      targetId: nodeId,
    });
  });

  test('GET credential with ?peek=1 returns status only and does NOT decrement views_left', async () => {
    const email = `un-peek-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'peek-test-1');
    const peekUrl = `http://localhost/api/user-node-credential?node=${nodeId}&peek=1`;
    const fullUrl = `http://localhost/api/user-node-credential?node=${nodeId}`;

    // Peek three times — views_left must stay at 3 the entire time, and the
    // plaintext temp password must never appear in the response.
    for (let i = 0; i < 3; i++) {
      const r = await userNodeCredentialHandler(new Request(peekUrl, { method: 'GET', headers: { cookie } }), CTX);
      expect(r.status).toBe(200);
      const body = await r.json() as {
        has_credential: boolean;
        email: string;
        has_password: boolean;
        has_google: boolean;
        must_change_password: boolean;
        last_login_at: string | null;
        temp_password_plain?: string;
        temp_password_views_left?: number;
      };
      expect(body.has_credential).toBe(true);
      expect(body.email).toBe(email);
      expect(body.has_password).toBe(true);
      expect(body.has_google).toBe(false);
      expect(body.must_change_password).toBe(true);
      expect(body.last_login_at).toBeNull();
      // Peek must not leak the plaintext or the counter.
      expect(body.temp_password_plain).toBeUndefined();
      expect(body.temp_password_views_left).toBeUndefined();
    }

    // After three peeks, views_left in the DB must still be 3.
    const rowsBefore = (await sql`
      SELECT temp_password_views_left FROM public.user_node_credentials WHERE user_node_id = ${nodeId}
    `) as { temp_password_views_left: number }[];
    expect(rowsBefore[0]!.temp_password_views_left).toBe(3);

    // A regular (non-peek) GET decrements normally — proves the counter still works.
    const fullR = await userNodeCredentialHandler(new Request(fullUrl, { method: 'GET', headers: { cookie } }), CTX);
    expect(fullR.status).toBe(200);
    const fullBody = await fullR.json() as { temp_password_plain: string | null; temp_password_views_left: number | null };
    expect(fullBody.temp_password_plain).toBe('peek-test-1');
    expect(fullBody.temp_password_views_left).toBe(2);
  });

  test('forgot-password sets password_reset_requested_at on matching credentials', async () => {
    const email = `un-forgot-set-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'forgot-test-1');

    const r = await forgotPasswordHandler(
      new Request('http://localhost/api/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }), CTX,
    );
    expect(r.status).toBe(200);

    const rows = (await sql`
      SELECT password_reset_requested_at
      FROM public.user_node_credentials WHERE user_node_id = ${nodeId}
    `) as { password_reset_requested_at: Date | null }[];
    expect(rows[0]!.password_reset_requested_at).not.toBeNull();
  });

  test('forgot-password returns 200 + same shape for unknown email (no enumeration leak)', async () => {
    const r = await forgotPasswordHandler(
      new Request('http://localhost/api/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `un-forgot-noexist-${Date.now()}@example.com` }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(typeof body.message).toBe('string');
  });

  test('admin reset of password clears password_reset_requested_at', async () => {
    const email = `un-forgot-clear-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'forgot-clear-1');

    // 1. User requests reset → flag set.
    await forgotPasswordHandler(
      new Request('http://localhost/api/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }), CTX,
    );
    const before = (await sql`
      SELECT password_reset_requested_at FROM public.user_node_credentials WHERE user_node_id = ${nodeId}
    `) as { password_reset_requested_at: Date | null }[];
    expect(before[0]!.password_reset_requested_at).not.toBeNull();

    // 2. Admin resets password via POST → flag should clear atomically.
    const reset = await userNodeCredentialHandler(
      new Request(`http://localhost/api/user-node-credential?node=${nodeId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ temp_password: 'new-temp-pwd-after-forgot' }),
      }), CTX,
    );
    expect(reset.status).toBe(200);

    const after = (await sql`
      SELECT password_reset_requested_at FROM public.user_node_credentials WHERE user_node_id = ${nodeId}
    `) as { password_reset_requested_at: Date | null }[];
    expect(after[0]!.password_reset_requested_at).toBeNull();
  });

  test('list user-nodes surfaces has_reset_request flag', async () => {
    const email = `un-forgot-list-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'list-flag-1');

    // Before forgot-password call: flag should be false.
    const before = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, { method: 'GET', headers: { cookie } }),
      CTX,
    );
    const beforeBody = await before.json() as { nodes: Array<{ id: string; has_reset_request: boolean }> };
    const targetBefore = beforeBody.nodes.find((n) => n.id === nodeId)!;
    expect(targetBefore.has_reset_request).toBe(false);

    // After forgot-password: flag true.
    await forgotPasswordHandler(
      new Request('http://localhost/api/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }), CTX,
    );
    const after = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, { method: 'GET', headers: { cookie } }),
      CTX,
    );
    const afterBody = await after.json() as { nodes: Array<{ id: string; has_reset_request: boolean }> };
    const targetAfter = afterBody.nodes.find((n) => n.id === nodeId)!;
    expect(targetAfter.has_reset_request).toBe(true);
  });

  test('?peek=1 on a node with no credential returns has_credential: false', async () => {
    // Create a node without a login (create_login: false path).
    const r = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleId, level_number: 1, parent_id: null,
          display_name: 'No-login user', email: null, create_login: false,
        }),
      }), CTX,
    );
    expect(r.status).toBe(201);
    const { node } = await r.json() as { node: { id: string } };

    const peek = await userNodeCredentialHandler(
      new Request(`http://localhost/api/user-node-credential?node=${node.id}&peek=1`, { method: 'GET', headers: { cookie } }),
      CTX,
    );
    expect(peek.status).toBe(200);
    const body = await peek.json() as { has_credential: boolean };
    expect(body.has_credential).toBe(false);
  });

  test('bu_session cookie cannot auth admin /api/auth-me', async () => {
    const email = `un-kind-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'kind-test-1');
    const lr = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'kind-test-1' }),
      }), CTX,
    );
    const buCookie = lr.headers.get('set-cookie')!.split(';')[0]!;
    const me = await authMeHandler(new Request('http://localhost/api/auth-me', { headers: { cookie: buCookie } }), CTX);
    expect(me.status).toBe(401);
  });

  test('admin cookie cannot auth /api/u-me', async () => {
    const adminToken = cookie.replace(/^session=/, '');
    const forged = `bu_session=${adminToken}`;
    const r = await uMeHandler(new Request('http://localhost/api/u-me', { headers: { cookie: forged } }), CTX);
    expect(r.status).toBe(401);
  });

  test('duplicate email-per-client returns 409', async () => {
    const email = `un-dup-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'first-pass-1');
    const r = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleId, level_number: 1, parent_id: null,
          display_name: 'Dup', email,
          create_login: true, temp_password: 'second-pass-1',
        }),
      }), CTX,
    );
    expect(r.status).toBe(409);
  });

  test('deleting a node cascades the credential', async () => {
    const email = `un-cascade-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'cascade-1');
    await userNodesDetailHandler(
      new Request(`http://localhost/api/user-nodes-detail?id=${nodeId}`, { method: 'DELETE', headers: { cookie } }),
      CTX,
    );
    const remaining = (await sql`SELECT id FROM public.user_node_credentials WHERE user_node_id = ${nodeId}`) as unknown[];
    expect(remaining).toHaveLength(0);
  });

  // ── New cases for unified /api/login ──────────────────────────────

  test('unified login: admin path returns kind:admin and sets session cookie', async () => {
    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const setCookie = r.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('session=');
    const body = await r.json() as { kind: string; admin?: { email: string } };
    expect(body.kind).toBe('admin');
    expect(body.admin?.email).toBe(ADMIN_EMAIL);
  });

  test('unified login: single bucket-user match returns kind:bucket_user and sets bu_session', async () => {
    const email = `unified-single-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'unified-pass-1');
    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'unified-pass-1' }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie') ?? '').toContain('bu_session=');
    const body = await r.json() as { kind: string; user: { must_change_password: boolean }; client: { slug: string } };
    expect(body.kind).toBe('bucket_user');
    expect(body.user.must_change_password).toBe(true);
    expect(body.client.slug).toBe(testClientSlug);
  });

  test('unified login: multiple bucket-user matches returns kind:choice', async () => {
    const sharedEmail = `unified-multi-${Date.now()}@example.com`;
    await createNodeWithLogin(sharedEmail, 'unified-pass-multi');
    const cr2 = await clientsHandler(new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `Second Client ${Date.now()}` }),
    }), CTX);
    const c2 = (await cr2.json() as { client: { id: string; slug: string } }).client;
    createdClients.push(c2.id);
    const r2 = await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${c2.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
    }), CTX);
    const role2 = (await r2.json() as { role: { id: string } }).role.id;
    await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${c2.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 1 }),
    }), CTX);
    await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${c2.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        role_id: role2, level_number: 1, parent_id: null,
        display_name: 'Multi', email: sharedEmail,
        create_login: true, temp_password: 'unified-pass-multi',
      }),
    }), CTX);

    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: sharedEmail, password: 'unified-pass-multi' }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie') ?? '').not.toContain('bu_session=');
    const body = await r.json() as { kind: string; clients: Array<{ slug: string }> };
    expect(body.kind).toBe('choice');
    expect(body.clients.length).toBeGreaterThanOrEqual(2);
  });

  test('unified login: disambiguation with `client` slug returns kind:bucket_user', async () => {
    const sharedEmail = `unified-disamb-${Date.now()}@example.com`;
    await createNodeWithLogin(sharedEmail, 'disamb-pass');
    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: sharedEmail, password: 'disamb-pass', client: testClientSlug }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie') ?? '').toContain('bu_session=');
    const body = await r.json() as { kind: string; client: { slug: string } };
    expect(body.kind).toBe('bucket_user');
    expect(body.client.slug).toBe(testClientSlug);
  });

  test('unified login: wrong password returns 401 unauthorized', async () => {
    const email = `unified-wrong-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'correct-pass');
    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-pass' }),
      }), CTX,
    );
    expect(r.status).toBe(401);
  });

  test('unified login: unknown email returns 401 unauthorized', async () => {
    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody-here@example.com', password: 'whatever' }),
      }), CTX,
    );
    expect(r.status).toBe(401);
  });

  test('unified login: admin precedence wins over bucket-user with same email', async () => {
    const collidingEmail = `unified-collide-${Date.now()}@example.com`;
    const tempHash = await hashPassword('admin-wins-pass');
    await sql`
      INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
      VALUES (${collidingEmail}, ${tempHash}, 'Collide Admin', false)
    `;
    await createNodeWithLogin(collidingEmail, 'bucket-pass-different');

    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: collidingEmail, password: 'admin-wins-pass' }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { kind: string };
    expect(body.kind).toBe('admin');

    await sql`DELETE FROM public.admins WHERE email = ${collidingEmail}`;
  });

  // ── Google flow on unified /api/login ────────────────────────────────

  test('Google login: bucket-user with matching email gets bu_session + first-binds google_sub', async () => {
    const email = `g-bind-${Date.now()}@example.com`;
    const nodeId = await createNodeWithLogin(email, 'pwd-irrelevant');
    (verifyGoogleIdToken as any).mockResolvedValueOnce({
      sub: `google-sub-${Date.now()}`,
      email,
      emailVerified: true,
      name: 'Test G User',
    });
    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'fake-google-id-token' }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { kind: string; user?: { id: string } };
    expect(body.kind).toBe('bucket_user');
    expect(body.user?.id).toBe(nodeId);
    expect(r.headers.get('set-cookie') ?? '').toContain('bu_session=');
    const after = (await sql`
      SELECT google_sub FROM public.user_node_credentials WHERE user_node_id = ${nodeId}
    `) as { google_sub: string | null }[];
    expect(after[0]!.google_sub).not.toBeNull();
  });

  test('Google login: unverified email → 401', async () => {
    const email = `g-unverified-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'unverified-pwd-1');
    (verifyGoogleIdToken as any).mockResolvedValueOnce({
      sub: 'g-sub-unverified', email, emailVerified: false, name: 'X',
    });
    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'fake-token' }),
      }), CTX,
    );
    expect(r.status).toBe(401);
  });

  test('Google login: no matching credential → 401 (strict bind, no auto-provision)', async () => {
    (verifyGoogleIdToken as any).mockResolvedValueOnce({
      sub: 'g-sub-nobody', email: `g-nobody-${Date.now()}@example.com`,
      emailVerified: true, name: 'Nobody',
    });
    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'fake-token' }),
      }), CTX,
    );
    expect(r.status).toBe(401);
  });

  test('Google login: admin precedence wins when email matches admin', async () => {
    (verifyGoogleIdToken as any).mockResolvedValueOnce({
      sub: 'g-sub-admin-precedence', email: ADMIN_EMAIL,
      emailVerified: true, name: 'Admin',
    });
    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'fake-token' }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { kind: string };
    expect(body.kind).toBe('admin');
    expect(r.headers.get('set-cookie') ?? '').toContain('session=');
    // Clear the google_sub we just first-bound so the test admin row is reusable.
    await sql`UPDATE public.admins SET google_sub = NULL WHERE email = ${ADMIN_EMAIL}`;
  });

  test('Google login: first-bind only — does not overwrite existing google_sub on a different admin', async () => {
    // Bootstrap the test admin's google_sub to a known value.
    const existingSub = 'g-sub-existing';
    await sql`UPDATE public.admins SET google_sub = ${existingSub} WHERE email = ${ADMIN_EMAIL}`;
    (verifyGoogleIdToken as any).mockResolvedValueOnce({
      sub: 'g-sub-different', email: ADMIN_EMAIL,
      emailVerified: true, name: 'Admin',
    });
    const r = await loginUnifiedHandler(
      new Request('http://localhost/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: 'fake-token' }),
      }), CTX,
    );
    expect(r.status).toBe(200);
    const after = (await sql`SELECT google_sub FROM public.admins WHERE email = ${ADMIN_EMAIL}`) as { google_sub: string }[];
    expect(after[0]!.google_sub).toBe(existingSub);
    await sql`UPDATE public.admins SET google_sub = NULL WHERE email = ${ADMIN_EMAIL}`;
  });
});

describe('client-roles bucket_family', () => {
  test('client-roles POST accepts and persists bucket_family', async () => {
    const r = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'patient', label: 'Patient', color: '#aa5555', bucket_family: 'customers' }),
      }), CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { role: { id: string; bucket_family: string | null } };
    expect(body.role.bucket_family).toBe('customers');
  });

  test('client-roles POST rejects invalid bucket_family with 400', async () => {
    const r = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'pp', label: 'PP', color: '#aaaaaa', bucket_family: 'bogus' }),
      }), CTX,
    );
    expect(r.status).toBe(400);
  });
});

describe('u-me payload extensions (dashboard)', () => {
  // Helper: create L2 level and return its id.
  async function createL2Level(): Promise<string> {
    const r = await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 2 }),
      }), CTX,
    );
    if (r.status !== 201) throw new Error(`create L2 failed: ${r.status} ${await r.text()}`);
    return (await r.json() as { level: { id: string } }).level.id;
  }

  // Helper: enable saloon-booking on the test client.
  async function enableSaloonBooking(): Promise<void> {
    const r = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${testClientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['saloon-booking'] }),
      }), CTX,
    );
    if (r.status !== 200) throw new Error(`enable product failed: ${r.status} ${await r.text()}`);
  }

  // Helper: log in as a bucket user and return the bu_session cookie header.
  async function bucketUserLogin(email: string, password: string): Promise<string> {
    const r = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }), CTX,
    );
    if (r.status !== 200) throw new Error(`u-login failed: ${r.status}`);
    return r.headers.get('set-cookie')!.split(';')[0]!;
  }

  // Helper: create a node at a specific level and return the node id.
  // L2+ nodes require a parent (server enforces top_level_requires_level_1),
  // so for levelNumber>1 we first create an L1 parent (no login) and attach.
  async function createNodeAtLevel(
    email: string, password: string, levelNumber: number,
  ): Promise<string> {
    let parentId: string | null = null;
    if (levelNumber !== 1) {
      const parentR = await userNodesHandler(
        new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({
            role_id: roleId, level_number: 1, parent_id: null,
            display_name: `L1 Parent for L${levelNumber}`, email: null,
            create_login: false,
          }),
        }), CTX,
      );
      if (parentR.status !== 201) throw new Error(`create parent failed: ${parentR.status} ${await parentR.text()}`);
      parentId = (await parentR.json() as { node: { id: string } }).node.id;
    }
    const r = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleId, level_number: levelNumber, parent_id: parentId,
          display_name: `L${levelNumber} User`, email,
          create_login: true, temp_password: password,
        }),
      }), CTX,
    );
    if (r.status !== 201) throw new Error(`create node failed: ${r.status} ${await r.text()}`);
    return (await r.json() as { node: { id: string } }).node.id;
  }

  test('L1 user u-me response includes permissions object and enabled_modules', async () => {
    await enableSaloonBooking();
    const email = `u-me-l1-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'l1-pass-1');
    const buCookie = await bucketUserLogin(email, 'l1-pass-1');

    const r = await uMeHandler(
      new Request('http://localhost/api/u-me', { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      user: { level_number: number | null };
      permissions: Record<string, true>;
      enabled_modules: Array<{ key: string; label: string }>;
    };
    expect(body.user.level_number).toBe(1);
    expect(typeof body.permissions).toBe('object'); // may be empty — L1 bypasses matrix
    const moduleKeys = body.enabled_modules.map((m) => m.key).sort();
    expect(moduleKeys).toEqual(['booking', 'payments']);
  });

  test('L2 user u-me response surfaces only the granted matrix keys', async () => {
    await enableSaloonBooking();
    const l2Id = await createL2Level();
    // Set a restricted matrix on the L2 level: view on booking.customers only.
    // We import clientLevelsPermissionsHandler at the top of the file for this.
    const clientLevelsPermissionsHandler = (
      await import('../../netlify/functions/client-levels-permissions')
    ).default;
    const putR = await clientLevelsPermissionsHandler(
      new Request(`http://localhost/api/client-levels-permissions?id=${l2Id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ permissions: { 'booking.customers.view': true } }),
      }), CTX,
    );
    expect(putR.status).toBe(200);

    const email = `u-me-l2-${Date.now()}@example.com`;
    await createNodeAtLevel(email, 'l2-pass-1', 2);
    const buCookie = await bucketUserLogin(email, 'l2-pass-1');

    const r = await uMeHandler(
      new Request('http://localhost/api/u-me', { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      user: { level_number: number | null };
      permissions: Record<string, true>;
      enabled_modules: Array<{ key: string; label: string }>;
    };
    expect(body.user.level_number).toBe(2);
    expect(body.permissions).toEqual({ 'booking.customers.view': true });
    // Module is enabled on the client regardless of the user's matrix —
    // the client-side useNavItems hook is what filters by matrix.
    const moduleKeys = body.enabled_modules.map((m) => m.key).sort();
    expect(moduleKeys).toEqual(['booking', 'payments']);
  });

  test('user on a client with no enabled Products receives empty enabled_modules', async () => {
    // No enableSaloonBooking() — clean client from beforeEach.
    const email = `u-me-empty-${Date.now()}@example.com`;
    await createNodeWithLogin(email, 'empty-pass-1');
    const buCookie = await bucketUserLogin(email, 'empty-pass-1');

    const r = await uMeHandler(
      new Request('http://localhost/api/u-me', { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      enabled_modules: unknown[];
      permissions: Record<string, true>;
    };
    expect(body.enabled_modules).toEqual([]);
    expect(typeof body.permissions).toBe('object');
  });
});

describe('user-node-credential — bucket-user widening', () => {
  // Local helper: log in as a bucket user against testClientSlug.
  async function buLogin(email: string, password: string): Promise<string> {
    const r = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }), CTX,
    );
    if (r.status !== 200) throw new Error(`bu-login failed: ${r.status}`);
    return r.headers.get('set-cookie')!.split(';')[0]!;
  }

  test('L1 Owner can POST reset another user\'s password (own workspace)', async () => {
    const ownerEmail = `cred-owner-${Date.now()}@example.com`;
    const ownerPw = 'cred-owner-pw-1';
    const ownerNodeId = await createNodeWithLogin(ownerEmail, ownerPw);
    const ownerCookie = await buLogin(ownerEmail, ownerPw);

    // Admin creates a target node (also L1 since this test client only has L1).
    const targetEmail = `cred-target-${Date.now()}@example.com`;
    const targetCreate = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleId, level_number: null, parent_id: null,
          display_name: 'Target', email: targetEmail,
          create_login: true, temp_password: 'target-orig-pw',
        }),
      }), CTX,
    );
    expect(targetCreate.status).toBe(201);
    const targetId = (await targetCreate.json() as { node: { id: string } }).node.id;

    // Delete the admin-created credential so the Owner's reset is an INSERT
    // (created_by_user_node is only set on INSERT, not ON CONFLICT UPDATE —
    // attribution belongs to whoever first created the credential row).
    await sql`DELETE FROM public.user_node_credentials WHERE user_node_id = ${targetId}::uuid`;

    // Owner resets target's password.
    const reset = await userNodeCredentialHandler(
      new Request(`http://localhost/api/user-node-credential?node=${targetId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ temp_password: 'owner-reset-pw-1' }),
      }), CTX,
    );
    expect(reset.status).toBe(200);

    // Verify the credential row inserted — must_change_password true + temp pw set
    // and attribution columns: admin NULL, user_node = owner.
    const rows = (await sql`
      SELECT must_change_password, temp_password_plain, created_by_admin, created_by_user_node
      FROM public.user_node_credentials WHERE user_node_id = ${targetId}::uuid
    `) as {
      must_change_password: boolean;
      temp_password_plain: string;
      created_by_admin: string | null;
      created_by_user_node: string | null;
    }[];
    expect(rows[0]!.must_change_password).toBe(true);
    expect(rows[0]!.temp_password_plain).toBe('owner-reset-pw-1');
    expect(rows[0]!.created_by_admin).toBeNull();
    expect(rows[0]!.created_by_user_node).toBe(ownerNodeId);
    await assertLastAudit(sql, {
      op: 'credential.reset',
      targetType: 'user_node',
      targetId: targetId,
      clientId: testClientId,
      actorUserNodeId: ownerNodeId,
      actorAdminId: null,
    });

    // Same test exercises credential DELETE attribution + audit row (credential.deleted).
    const del = await userNodeCredentialHandler(
      new Request(`http://localhost/api/user-node-credential?node=${targetId}`, {
        method: 'DELETE', headers: { cookie: ownerCookie },
      }), CTX,
    );
    expect(del.status).toBe(200);
    await assertLastAudit(sql, {
      op: 'credential.deleted',
      targetType: 'user_node',
      targetId: targetId,
      clientId: testClientId,
      actorUserNodeId: ownerNodeId,
    });
  });

  test('L1 Owner can GET peek another user\'s temp password (own workspace)', async () => {
    const ownerEmail = `cred-peek-owner-${Date.now()}@example.com`;
    const ownerPw = 'cred-peek-owner-pw-1';
    await createNodeWithLogin(ownerEmail, ownerPw);
    const ownerCookie = await buLogin(ownerEmail, ownerPw);

    const targetEmail = `cred-peek-target-${Date.now()}@example.com`;
    const targetCreate = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleId, level_number: null, parent_id: null,
          display_name: 'Peek Target', email: targetEmail,
          create_login: true, temp_password: 'peek-temp-1234',
        }),
      }), CTX,
    );
    expect(targetCreate.status).toBe(201);
    const targetId = (await targetCreate.json() as { node: { id: string } }).node.id;

    const peek = await userNodeCredentialHandler(
      new Request(`http://localhost/api/user-node-credential?node=${targetId}`, {
        method: 'GET', headers: { cookie: ownerCookie },
      }), CTX,
    );
    expect(peek.status).toBe(200);
    const body = await peek.json() as { temp_password_plain: string | null };
    expect(body.temp_password_plain).toBe('peek-temp-1234');
  });

  test('Bucket-user cannot reset cred for a node in another workspace → 403', async () => {
    // Owner-A in testClient.
    const ownerEmail = `cred-cross-${Date.now()}@example.com`;
    const ownerPw = 'cred-cross-pw-1';
    await createNodeWithLogin(ownerEmail, ownerPw);
    const ownerCookie = await buLogin(ownerEmail, ownerPw);

    // Build client B + node with credential.
    const cr2 = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: `Cred Other ${Date.now()}` }),
      }), CTX,
    );
    const clientB = (await cr2.json() as { client: { id: string } }).client;
    createdClients.push(clientB.id);
    const rrB = await clientRolesHandler(
      new Request(`http://localhost/api/client-roles?client=${clientB.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
      }), CTX,
    );
    const roleB = (await rrB.json() as { role: { id: string } }).role.id;
    await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${clientB.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 1 }),
    }), CTX);
    const targetEmailB = `cred-target-B-${Date.now()}@example.com`;
    const nodeBResp = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${clientB.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleB, level_number: 1, parent_id: null,
          display_name: 'Target B', email: targetEmailB,
          create_login: true, temp_password: 'b-target-pw-1',
        }),
      }), CTX,
    );
    expect(nodeBResp.status).toBe(201);
    const nodeBId = (await nodeBResp.json() as { node: { id: string } }).node.id;

    const r = await userNodeCredentialHandler(
      new Request(`http://localhost/api/user-node-credential?node=${nodeBId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ temp_password: 'hijack-pw-12345' }),
      }), CTX,
    );
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('forbidden_cross_client');
  });

  // ---------------------------------------------------------------------------
  // Subtree scoping on credential endpoints. Build a 2-level tree:
  //   Alice (L1) → [Bob (L2), Carol (L2)]
  // Bob has a credential; Carol has one too. With Bob logged in (L2), he must
  // NOT be able to peek or reset Carol's credential — she's outside his subtree
  // even though both share the workspace.
  // ---------------------------------------------------------------------------
  async function setupCredSubtreeScenario(): Promise<{
    bobCookie: string;
    carolNodeId: string;
  }> {
    // Add an L2 level alongside the existing L1 + grant edit perm.
    await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${testClientId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ level_number: 2, allowed_role_ids: [roleId] }),
    }), CTX);
    await sql`
      UPDATE public.client_levels
      SET permissions = ${JSON.stringify({
        '_platform.users.view': true,
        '_platform.users.edit': true,
      })}::jsonb
      WHERE client_id = ${testClientId} AND level_number = 2
    `;

    // Alice (L1) — created via admin so we control the cookie cleanly.
    const aliceEmail = `cred-sub-alice-${Date.now()}@example.com`;
    const aliceResp = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleId, level_number: 1, parent_id: null,
          display_name: 'Alice', email: aliceEmail,
        }),
      }), CTX,
    );
    const aliceId = (await aliceResp.json() as { node: { id: string } }).node.id;

    // Bob (L2) under Alice + login.
    const bobEmail = `cred-sub-bob-${Date.now()}@example.com`;
    const bobPw = `cred-sub-bob-pw-${Date.now()}`;
    const bobResp = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleId, level_number: 2, parent_id: aliceId,
          display_name: 'Bob', email: bobEmail,
          create_login: true, temp_password: bobPw,
        }),
      }), CTX,
    );
    expect(bobResp.status).toBe(201);
    const bobLogin = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: bobEmail, password: bobPw }),
      }), CTX,
    );
    const bobCookie = bobLogin.headers.get('set-cookie')!.split(';')[0]!;

    // Carol (L2) — Bob's sibling, also has a credential.
    const carolEmail = `cred-sub-carol-${Date.now()}@example.com`;
    const carolResp = await userNodesHandler(
      new Request(`http://localhost/api/user-nodes?client=${testClientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          role_id: roleId, level_number: 2, parent_id: aliceId,
          display_name: 'Carol', email: carolEmail,
          create_login: true, temp_password: 'carol-orig-pw-12345',
        }),
      }), CTX,
    );
    expect(carolResp.status).toBe(201);
    const carolNodeId = (await carolResp.json() as { node: { id: string } }).node.id;

    return { bobCookie, carolNodeId };
  }

  test('L2 user cannot peek a sibling credential', async () => {
    const { bobCookie, carolNodeId } = await setupCredSubtreeScenario();
    const r = await userNodeCredentialHandler(
      new Request(`http://localhost/api/user-node-credential?node=${carolNodeId}`, {
        method: 'GET', headers: { cookie: bobCookie },
      }), CTX,
    );
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('forbidden_subtree');
  });

  test('L2 user cannot reset a sibling credential password', async () => {
    const { bobCookie, carolNodeId } = await setupCredSubtreeScenario();
    const r = await userNodeCredentialHandler(
      new Request(`http://localhost/api/user-node-credential?node=${carolNodeId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: bobCookie },
        body: JSON.stringify({ temp_password: 'hijack-pw-67890' }),
      }), CTX,
    );
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('forbidden_subtree');
  });
});
