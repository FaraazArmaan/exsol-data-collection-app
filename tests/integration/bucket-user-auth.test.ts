/**
 * Integration tests for bucket-user (non-admin) authentication.
 *   - admin creates bucket user with create_login + temp_password → credential row exists
 *   - u-client-by-slug returns 404 for unknown slug, 200 for known
 *   - u-login happy path → bu_session cookie set; must_change_password=true
 *   - u-login wrong password → 401
 *   - u-change-password happy path → must_change_password=false; temp plaintext wiped
 *   - GET credential decrements views_left; at 0 plaintext is wiped
 *   - Session kind enforcement: bu_session cookie cannot auth admin endpoint
 *   - Cascade: deleting bucket-user removes credential row
 *   - Duplicate email-per-client returns 409 email_already_has_login_in_this_client
 */

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientsDetailHandler from '../../netlify/functions/clients-detail';
import clientsBucketUsersHandler from '../../netlify/functions/clients-bucket-users';
import clientsBucketUserDetailHandler from '../../netlify/functions/clients-bucket-user-detail';
import bucketUserCredentialHandler from '../../netlify/functions/bucket-user-credential';
import uClientBySlugHandler from '../../netlify/functions/u-client-by-slug';
import uLoginHandler from '../../netlify/functions/u-login';
import uMeHandler from '../../netlify/functions/u-me';
import uChangePasswordHandler from '../../netlify/functions/u-change-password';
import authMeHandler from '../../netlify/functions/auth-me';

const ADMIN_EMAIL = 'bucket-user-auth-test-admin@example.com';
const ADMIN_PASSWORD = 'bucket-user-auth-pw';
const CTX = {} as Context;

function loginReq(email: string, password: string): Request {
  return new Request('http://localhost/api/auth-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function adminCookie(): Promise<string> {
  const res = await loginHandler(loginReq(ADMIN_EMAIL, ADMIN_PASSWORD), CTX);
  if (res.status !== 200) throw new Error(`Admin login failed: ${res.status}`);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

let sql: ReturnType<typeof neon>;
let adminId: string;
let cookie: string;
let testClientId: string;
let testClientSlug: string;

const createdClientIds: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const hash = await hashPassword(ADMIN_PASSWORD);
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${hash}, 'BU Auth Test Admin', false)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${hash}, display_name = 'BU Auth Test Admin', google_sub = NULL
    RETURNING id
  `) as { id: string }[];
  adminId = rows[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  cookie = await adminCookie();

  const clientName = `Auth Test Shop ${Date.now()}`;
  const res = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: clientName, template_key: 'shop' }),
    }),
    CTX,
  );
  if (res.status !== 201) throw new Error(`create client failed: ${res.status}`);
  const body = await res.json() as { client: { id: string; slug: string } };
  testClientId = body.client.id;
  testClientSlug = body.client.slug;
  createdClientIds.push(testClientId);
});

afterEach(async () => {
  if (testClientId) {
    try {
      await clientsDetailHandler(
        new Request(`http://localhost/api/clients-detail?id=${testClientId}`, {
          method: 'DELETE',
          headers: { cookie },
        }),
        CTX,
      );
    } catch { /* best effort */ }
  }
});

afterAll(async () => {
  for (const id of createdClientIds) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

async function createOwnerWithLogin(opts: {
  email: string; tempPassword: string; displayName?: string;
}): Promise<{ bucketUserId: string }> {
  const res = await clientsBucketUsersHandler(
    new Request(`http://localhost/api/clients-bucket-users?client=${testClientId}&role=owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        display_name: opts.displayName ?? 'Test Owner',
        email: opts.email,
        create_login: true,
        temp_password: opts.tempPassword,
      }),
    }),
    CTX,
  );
  if (res.status !== 201) throw new Error(`create bucket-user with login failed: ${res.status} ${await res.text()}`);
  const body = await res.json() as { user: { id: string }; login_created: boolean };
  if (!body.login_created) throw new Error('login_created was false');
  return { bucketUserId: body.user.id };
}

describe('bucket-user auth endpoints', () => {
  test('u-client-by-slug: returns the client for a valid slug', async () => {
    const res = await uClientBySlugHandler(
      new Request(`http://localhost/api/u-client-by-slug?slug=${testClientSlug}`, { method: 'GET' }),
      CTX,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { client: { id: string; slug: string; name: string } };
    expect(body.client.id).toBe(testClientId);
    expect(body.client.slug).toBe(testClientSlug);
  });

  test('u-client-by-slug: 404 for unknown slug', async () => {
    const res = await uClientBySlugHandler(
      new Request('http://localhost/api/u-client-by-slug?slug=does-not-exist-xyz', { method: 'GET' }),
      CTX,
    );
    expect(res.status).toBe(404);
  });

  test('admin creates bucket user with create_login → credential row inserted', async () => {
    const email = `bu-login-${Date.now()}@example.com`;
    const { bucketUserId } = await createOwnerWithLogin({ email, tempPassword: 'temp-pass-123' });
    const rows = (await sql`
      SELECT must_change_password, temp_password_views_left, temp_password_plain
      FROM public.bucket_user_credentials
      WHERE bucket_user_id = ${bucketUserId}
    `) as { must_change_password: boolean; temp_password_views_left: number; temp_password_plain: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.must_change_password).toBe(true);
    expect(rows[0]!.temp_password_views_left).toBe(3);
    expect(rows[0]!.temp_password_plain).toBe('temp-pass-123');
  });

  test('u-login happy path → 200, bu_session cookie, must_change_password=true', async () => {
    const email = `bu-happy-${Date.now()}@example.com`;
    await createOwnerWithLogin({ email, tempPassword: 'happy-pass-1' });
    const res = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'happy-pass-1' }),
      }),
      CTX,
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('bu_session=');
    const body = await res.json() as { user: { must_change_password: boolean } };
    expect(body.user.must_change_password).toBe(true);
  });

  test('u-login wrong password → 401', async () => {
    const email = `bu-wrong-${Date.now()}@example.com`;
    await createOwnerWithLogin({ email, tempPassword: 'correct-pass-1' });
    const res = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-pass' }),
      }),
      CTX,
    );
    expect(res.status).toBe(401);
  });

  test('u-change-password: clears must_change_password and wipes temp plaintext', async () => {
    const email = `bu-change-${Date.now()}@example.com`;
    const { bucketUserId } = await createOwnerWithLogin({ email, tempPassword: 'change-me-1' });
    const loginRes = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'change-me-1' }),
      }),
      CTX,
    );
    const buCookie = loginRes.headers.get('set-cookie')!.split(';')[0]!;

    const changeRes = await uChangePasswordHandler(
      new Request('http://localhost/api/u-change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: buCookie },
        body: JSON.stringify({ current_password: 'change-me-1', new_password: 'new-strong-pass' }),
      }),
      CTX,
    );
    expect(changeRes.status).toBe(200);

    const rows = (await sql`
      SELECT must_change_password, temp_password_plain, temp_password_views_left
      FROM public.bucket_user_credentials WHERE bucket_user_id = ${bucketUserId}
    `) as { must_change_password: boolean; temp_password_plain: string | null; temp_password_views_left: number | null }[];
    expect(rows[0]!.must_change_password).toBe(false);
    expect(rows[0]!.temp_password_plain).toBeNull();
    expect(rows[0]!.temp_password_views_left).toBeNull();
  });

  test('GET credential decrements views_left; at 0 plaintext is wiped', async () => {
    const email = `bu-views-${Date.now()}@example.com`;
    const { bucketUserId } = await createOwnerWithLogin({ email, tempPassword: 'views-test-1' });
    const url = `http://localhost/api/bucket-user-credential?client=${testClientId}&role=owners&user=${bucketUserId}`;

    for (let i = 0; i < 3; i++) {
      const res = await bucketUserCredentialHandler(new Request(url, { method: 'GET', headers: { cookie } }), CTX);
      expect(res.status).toBe(200);
      const body = await res.json() as { temp_password_plain: string | null; temp_password_views_left: number | null };
      expect(body.temp_password_plain).toBe('views-test-1');
      expect(body.temp_password_views_left).toBe(2 - i);
    }
    // 4th view: plaintext gone.
    const res4 = await bucketUserCredentialHandler(new Request(url, { method: 'GET', headers: { cookie } }), CTX);
    expect(res4.status).toBe(200);
    const body4 = await res4.json() as { temp_password_plain: string | null };
    expect(body4.temp_password_plain).toBeNull();
  });

  test('bu_session cookie cannot auth admin /api/auth-me', async () => {
    const email = `bu-kind-${Date.now()}@example.com`;
    await createOwnerWithLogin({ email, tempPassword: 'kind-test-1' });
    const loginRes = await uLoginHandler(
      new Request(`http://localhost/api/u-login?client=${testClientSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'kind-test-1' }),
      }),
      CTX,
    );
    const buCookie = loginRes.headers.get('set-cookie')!.split(';')[0]!;
    // bu_session=... — but auth-me looks for "session=" so it shouldn't find a cookie at all.
    const meRes = await authMeHandler(new Request('http://localhost/api/auth-me', { headers: { cookie: buCookie } }), CTX);
    expect(meRes.status).toBe(401);
  });

  test('admin cookie cannot auth /api/u-me (kind mismatch)', async () => {
    // Forge: send admin's session cookie under the bu_session name.
    const adminToken = cookie.replace(/^session=/, '');
    const forged = `bu_session=${adminToken}`;
    const res = await uMeHandler(new Request('http://localhost/api/u-me', { headers: { cookie: forged } }), CTX);
    expect(res.status).toBe(401);
  });

  test('duplicate email-per-client → 409 email_already_has_login_in_this_client', async () => {
    const email = `bu-dup-${Date.now()}@example.com`;
    await createOwnerWithLogin({ email, tempPassword: 'first-pass-1' });
    // Try to create another bucket user with same email + create_login in customers role.
    const res = await clientsBucketUsersHandler(
      new Request(`http://localhost/api/clients-bucket-users?client=${testClientId}&role=customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          display_name: 'Same Email',
          email,
          create_login: true,
          temp_password: 'second-pass-1',
        }),
      }),
      CTX,
    );
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('email_already_has_login_in_this_client');
  });

  test('deleting a bucket user cascades to its credential row', async () => {
    const email = `bu-cascade-${Date.now()}@example.com`;
    const { bucketUserId } = await createOwnerWithLogin({ email, tempPassword: 'cascade-1' });
    const del = await clientsBucketUserDetailHandler(
      new Request(`http://localhost/api/clients-bucket-user-detail?client=${testClientId}&role=owners&user=${bucketUserId}`, {
        method: 'DELETE',
        headers: { cookie },
      }),
      CTX,
    );
    expect(del.status).toBe(200);
    const remaining = (await sql`
      SELECT id FROM public.bucket_user_credentials WHERE bucket_user_id = ${bucketUserId}
    `) as { id: string }[];
    expect(remaining).toHaveLength(0);
  });
});
