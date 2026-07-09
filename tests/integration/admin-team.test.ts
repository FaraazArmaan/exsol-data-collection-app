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
import authMeHandler from '../../netlify/functions/auth-me';
import { assertLastAudit } from '../helpers/audit';

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
    await sql`
      DELETE FROM public.audit_log
      WHERE actor_admin IN (SELECT id FROM public.admins WHERE email = ${email})
    `;
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

  function detailReq(method: 'DELETE' | 'PATCH', id: string, cookie: string, body?: unknown): Request {
    return new Request(`http://localhost/api/admin-team-detail?id=${id}`, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
    const body = await res.json() as { admin: { id: string; email: string; is_bootstrap: boolean; role: string; has_password: boolean } };
    expect(body.admin.email).toBe(email);
    expect(body.admin.is_bootstrap).toBe(false);
    expect(body.admin.role).toBe('support');
    expect(body.admin.has_password).toBe(true);
    await assertLastAudit(sql, {
      op: 'admin.created',
      targetType: 'admin',
      targetId: body.admin.id,
      clientId: null,
    });
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
      teamReq('POST', bootstrapCookie, { email, display_name: 'Self Test', password, role: 'owner' }),
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
    await assertLastAudit(sql, {
      op: 'admin.deleted',
      targetType: 'admin',
      targetId: created.admin.id,
      clientId: null,
    });
  });

  test('support/read-only admins cannot manage admins; security admin can', async () => {
    const supportEmail = `admin-team-support-${Date.now()}@example.com`;
    const readOnlyEmail = `admin-team-readonly-${Date.now()}@example.com`;
    const securityEmail = `admin-team-security-${Date.now()}@example.com`;
    const createdBySecurity = `admin-team-security-created-${Date.now()}@example.com`;
    createdEmails.push(supportEmail, readOnlyEmail, securityEmail, createdBySecurity);
    const supportHash = await hashPassword('support-pass-1');
    const readOnlyHash = await hashPassword('readonly-pass-1');
    const securityHash = await hashPassword('security-pass-1');
    await sql`
      INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap, role)
      VALUES
        (${supportEmail}, ${supportHash}, 'Support Admin', false, 'support'),
        (${readOnlyEmail}, ${readOnlyHash}, 'Read Only Admin', false, 'read_only'),
        (${securityEmail}, ${securityHash}, 'Security Admin', false, 'security_admin')
    `;

    const supportCookie = await loginAndGetCookie(supportEmail, 'support-pass-1');
    const readOnlyCookie = await loginAndGetCookie(readOnlyEmail, 'readonly-pass-1');
    const securityCookie = await loginAndGetCookie(securityEmail, 'security-pass-1');

    const supportCreate = await adminTeamHandler(
      teamReq('POST', supportCookie, {
        email: `blocked-support-${Date.now()}@example.com`,
        display_name: 'Blocked',
        password: 'blocked-pass-1',
      }),
      CTX,
    );
    expect(supportCreate.status).toBe(403);
    expect((await supportCreate.json() as { error: { code: string } }).error.code).toBe('admin_role_forbidden');

    const readOnlyCreate = await adminTeamHandler(
      teamReq('POST', readOnlyCookie, {
        email: `blocked-readonly-${Date.now()}@example.com`,
        display_name: 'Blocked',
        password: 'blocked-pass-1',
      }),
      CTX,
    );
    expect(readOnlyCreate.status).toBe(403);

    const securityCreate = await adminTeamHandler(
      teamReq('POST', securityCookie, {
        email: createdBySecurity,
        display_name: 'Created By Security',
        password: 'created-security-pass-1',
        role: 'read_only',
      }),
      CTX,
    );
    expect(securityCreate.status).toBe(201);
  });

  test('disabling an admin revokes active sessions and blocks login', async () => {
    const email = `admin-team-disable-${Date.now()}@example.com`;
    const password = 'disable-pass-1';
    createdEmails.push(email);
    const create = await adminTeamHandler(
      teamReq('POST', bootstrapCookie, { email, display_name: 'Disable Me', password, role: 'owner' }),
      CTX,
    );
    expect(create.status).toBe(201);
    const created = await create.json() as { admin: { id: string } };
    const targetCookie = await loginAndGetCookie(email, password);

    const disable = await adminTeamDetailHandler(detailReq('PATCH', created.admin.id, bootstrapCookie, { disabled: true }), CTX);
    expect(disable.status).toBe(200);

    const me = await authMeHandler(new Request('http://localhost/api/auth-me', {
      method: 'GET',
      headers: { cookie: targetCookie },
    }), CTX);
    expect(me.status).toBe(401);
    const revoked = (await sql`
      SELECT revoked_at FROM public.auth_sessions
      WHERE realm = 'admin'
        AND subject_id = ${created.admin.id}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `) as { revoked_at: string | null }[];
    expect(revoked[0]!.revoked_at).not.toBeNull();

    await sql`DELETE FROM public.login_attempts WHERE email = ${email}`;
    const relogin = await loginHandler(loginReq(email, password), CTX);
    expect(relogin.status).toBe(401);

    const enable = await adminTeamDetailHandler(detailReq('PATCH', created.admin.id, bootstrapCookie, { disabled: false }), CTX);
    expect(enable.status).toBe(200);
    await sql`DELETE FROM public.login_attempts WHERE email = ${email}`;
    const afterEnable = await loginHandler(loginReq(email, password), CTX);
    expect(afterEnable.status).toBe(200);
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
