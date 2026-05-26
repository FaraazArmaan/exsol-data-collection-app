/**
 * Integration tests for admin team endpoints (Phase 8.1).
 *
 *   - GET    /api/admin-team             → list, bootstrap-first ordering
 *   - POST   /api/admin-team             → create; dup-email → 409 email_taken
 *   - DELETE /api/admin-team-detail?id=  → bootstrap-undeletable (409 cannot_delete_bootstrap),
 *                                         self-undeletable (409 cannot_delete_self)
 *   - PATCH  /api/admin-self             → updates display_name; rejects password < 8
 *
 * Handlers invoked directly (no netlify dev) — same approach as
 * tests/integration/buckets-cardinality.test.ts.
 */

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import adminTeamHandler from '../../netlify/functions/admin-team';
import adminTeamDetailHandler from '../../netlify/functions/admin-team-detail';
import adminSelfHandler from '../../netlify/functions/admin-self';

const BOOTSTRAP_EMAIL = 'admin-team-bootstrap-test@example.com';
const BOOTSTRAP_PASSWORD = 'admin-team-bootstrap-pw';
const CTX = {} as Context;

function loginReq(email: string, password: string): Request {
  return new Request('http://localhost/api/auth-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function loginAndGetCookie(email: string, password: string): Promise<string> {
  const res = await loginHandler(loginReq(email, password), CTX);
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

let sql: ReturnType<typeof neon>;
let bootstrapCookie: string;
let bootstrapId: string;

// Track created non-bootstrap admins for teardown.
const createdEmails: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);

  const hash = await hashPassword(BOOTSTRAP_PASSWORD);
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${BOOTSTRAP_EMAIL}, ${hash}, 'Bootstrap Test Admin', true)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${hash}, google_sub = NULL,
                  display_name = 'Bootstrap Test Admin', is_bootstrap = true
    RETURNING id
  `) as { id: string }[];
  bootstrapId = rows[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${BOOTSTRAP_EMAIL}`;
  bootstrapCookie = await loginAndGetCookie(BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD);
});

afterAll(async () => {
  for (const email of createdEmails) {
    await sql`DELETE FROM public.admins WHERE email = ${email}`;
  }
  // Bootstrap test admin remains — keeps subsequent runs idempotent (ON CONFLICT path).
});

describe('admin-team endpoints', () => {
  function teamReq(method: 'GET' | 'POST', cookie: string, body?: unknown): Request {
    return new Request('http://localhost/api/admin-team', {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  function detailReq(method: 'DELETE', id: string, cookie: string): Request {
    return new Request(`http://localhost/api/admin-team-detail?id=${id}`, {
      method,
      headers: { cookie },
    });
  }

  function selfReq(cookie: string, body: unknown): Request {
    return new Request('http://localhost/api/admin-self', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  test('GET admin-team returns the bootstrap admin first', async () => {
    const res = await adminTeamHandler(teamReq('GET', bootstrapCookie), CTX);
    expect(res.status).toBe(200);
    const body = await res.json() as { admins: Array<{ id: string; email: string; is_bootstrap: boolean }> };
    const ids = body.admins.map((a) => a.id);
    expect(ids).toContain(bootstrapId);
    const first = body.admins[0]!;
    expect(first.is_bootstrap).toBe(true);
  });

  test('POST creates a non-bootstrap admin', async () => {
    const email = `admin-team-created-${Date.now()}@example.com`;
    createdEmails.push(email);
    const res = await adminTeamHandler(
      teamReq('POST', bootstrapCookie, { email, display_name: 'Created Admin', password: 'first-pass-1' }),
      CTX,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { admin: { email: string; is_bootstrap: boolean; has_password: boolean } };
    expect(body.admin.email).toBe(email);
    expect(body.admin.is_bootstrap).toBe(false);
    expect(body.admin.has_password).toBe(true);
  });

  test('POST with duplicate email returns 409 email_taken', async () => {
    const email = `admin-team-dup-${Date.now()}@example.com`;
    createdEmails.push(email);
    const first = await adminTeamHandler(
      teamReq('POST', bootstrapCookie, { email, display_name: 'Dup Admin', password: 'first-pass-1' }),
      CTX,
    );
    expect(first.status).toBe(201);
    const second = await adminTeamHandler(
      teamReq('POST', bootstrapCookie, { email, display_name: 'Dup Admin 2', password: 'first-pass-2' }),
      CTX,
    );
    expect(second.status).toBe(409);
    const body = await second.json() as { error: { code: string } };
    expect(body.error.code).toBe('email_taken');
  });

  test('POST with password omitted is rejected by CHECK → 400 credential_required', async () => {
    const email = `admin-team-nocred-${Date.now()}@example.com`;
    createdEmails.push(email);
    const res = await adminTeamHandler(
      teamReq('POST', bootstrapCookie, { email, display_name: 'No Cred' }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('credential_required');
  });

  test('DELETE bootstrap admin → 409 cannot_delete_bootstrap', async () => {
    const res = await adminTeamDetailHandler(detailReq('DELETE', bootstrapId, bootstrapCookie), CTX);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('cannot_delete_bootstrap');
  });

  test('DELETE self → 409 cannot_delete_self', async () => {
    // Create a second admin, log in as them, attempt to delete self.
    const email = `admin-team-self-${Date.now()}@example.com`;
    const password = 'self-test-pw-1';
    createdEmails.push(email);
    const create = await adminTeamHandler(
      teamReq('POST', bootstrapCookie, { email, display_name: 'Self Test', password }),
      CTX,
    );
    expect(create.status).toBe(201);
    const created = await create.json() as { admin: { id: string } };

    await sql`DELETE FROM public.login_attempts WHERE email = ${email}`;
    const selfCookie = await loginAndGetCookie(email, password);

    const res = await adminTeamDetailHandler(detailReq('DELETE', created.admin.id, selfCookie), CTX);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('cannot_delete_self');
  });

  test('DELETE another admin (not bootstrap, not self) succeeds and removes the row', async () => {
    const email = `admin-team-delete-${Date.now()}@example.com`;
    createdEmails.push(email);
    const create = await adminTeamHandler(
      teamReq('POST', bootstrapCookie, { email, display_name: 'To Delete', password: 'delete-pw-1' }),
      CTX,
    );
    expect(create.status).toBe(201);
    const created = await create.json() as { admin: { id: string } };

    const del = await adminTeamDetailHandler(detailReq('DELETE', created.admin.id, bootstrapCookie), CTX);
    expect(del.status).toBe(200);

    const verify = (await sql`SELECT id FROM public.admins WHERE id = ${created.admin.id}`) as { id: string }[];
    expect(verify).toHaveLength(0);
  });

  test('PATCH admin-self updates display_name', async () => {
    const before = await sql`SELECT display_name FROM public.admins WHERE id = ${bootstrapId}`;
    const beforeName = (before as { display_name: string }[])[0]!.display_name;

    const newName = `Bootstrap Updated ${Date.now()}`;
    const res = await adminSelfHandler(selfReq(bootstrapCookie, { display_name: newName }), CTX);
    expect(res.status).toBe(200);
    const body = await res.json() as { admin: { display_name: string } };
    expect(body.admin.display_name).toBe(newName);

    // Restore for idempotency across test runs.
    await sql`UPDATE public.admins SET display_name = ${beforeName} WHERE id = ${bootstrapId}`;
  });

  test('PATCH admin-self rejects password < 8 chars → 400 validation_failed', async () => {
    const res = await adminSelfHandler(selfReq(bootstrapCookie, { password: 'short' }), CTX);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });

  test('PATCH admin-self with no fields → 400 validation_failed', async () => {
    const res = await adminSelfHandler(selfReq(bootstrapCookie, {}), CTX);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });

  test('endpoints reject unauthenticated requests with 401', async () => {
    const list = await adminTeamHandler(
      new Request('http://localhost/api/admin-team', { method: 'GET' }),
      CTX,
    );
    expect(list.status).toBe(401);

    const del = await adminTeamDetailHandler(
      new Request(`http://localhost/api/admin-team-detail?id=${bootstrapId}`, { method: 'DELETE' }),
      CTX,
    );
    expect(del.status).toBe(401);

    const self = await adminSelfHandler(
      new Request('http://localhost/api/admin-self', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'x' }),
      }),
      CTX,
    );
    expect(self.status).toBe(401);
  });
});
