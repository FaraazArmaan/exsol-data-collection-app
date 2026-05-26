/**
 * Integration tests for clients lifecycle endpoints (Phase 6 Task 6.2).
 *
 * Plan deviation (controller-approved): handlers are invoked directly via
 *   await handler(new Request(...), {} as Context)
 * instead of the plan's `netlify dev` + fetch() pattern.
 * Rationale: same as auth.test.ts — direct invocation is faster, requires no
 * separate process, and exercises identical handler code against the real Neon dev DB.
 *
 * ENV loading: handled by tests/setup-env.ts (vitest setupFile).
 */

// vi.mock must be at top level — vitest hoists it before imports.
vi.mock('../../netlify/functions/_shared/google-verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientsDetailHandler from '../../netlify/functions/clients-detail';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_EMAIL = 'clients-lifecycle-test@example.com';
const TEST_PASSWORD = 'clients-lifecycle-pw';
const CTX = {} as Context;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loginReq(email: string, password: string): Request {
  return new Request('http://localhost/api/auth-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function loginAndGetCookie(): Promise<string> {
  const res = await loginHandler(loginReq(TEST_EMAIL, TEST_PASSWORD), CTX);
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`);
  const setCookie = res.headers.get('set-cookie')!;
  // Return "session=<token>" pair (stripped of other cookie attrs).
  return setCookie.split(';')[0]!;
}

function clientsReq(method: 'GET' | 'POST', cookie: string, body?: unknown): Request {
  return new Request('http://localhost/api/clients', {
    method,
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function clientsDetailReq(method: 'GET' | 'DELETE', id: string, cookie: string): Request {
  return new Request(`http://localhost/api/clients-detail?id=${id}`, {
    method,
    headers: { cookie },
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let sql: ReturnType<typeof neon>;
let sessionCookie: string;

// Track created clients so afterAll can clean up stragglers.
const createdClientIds: string[] = [];
const createdSchemaNames: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);

  // Upsert the test admin with a known password hash.
  const hash = await hashPassword(TEST_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${TEST_EMAIL}, ${hash}, 'Clients Test Admin', false)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${hash}, google_sub = NULL, display_name = 'Clients Test Admin'
  `;
});

beforeEach(async () => {
  // Clear any leftover test client rows.
  await sql`
    DELETE FROM public.clients WHERE name LIKE 'Integration Co%' OR name LIKE 'Lifecycle Test%'
  `;
  // Clear login_attempts for the test email.
  await sql`
    DELETE FROM public.login_attempts WHERE email = ${TEST_EMAIL}
  `;
  // Obtain a fresh session cookie for each test.
  sessionCookie = await loginAndGetCookie();
});

afterAll(async () => {
  // Drop any straggler schemas.
  for (const schemaName of createdSchemaNames) {
    try {
      await sql(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } catch {
      // best-effort
    }
  }
  // Delete any straggler client rows.
  for (const clientId of createdClientIds) {
    try {
      await sql`DELETE FROM public.clients WHERE id = ${clientId}::uuid`;
    } catch {
      // best-effort
    }
  }
  // Delete the test admin and its login_attempts.
  // schema_ops_log has a non-cascading FK on actor_admin; clear those rows first.
  const adminRows = (await sql`
    SELECT id FROM public.admins WHERE email = ${TEST_EMAIL}
  `) as { id: string }[];
  if (adminRows.length > 0) {
    await sql`DELETE FROM public.schema_ops_log WHERE actor_admin = ${adminRows[0]!.id}::uuid`;
  }
  await sql`DELETE FROM public.admins WHERE email = ${TEST_EMAIL}`;
  await sql`DELETE FROM public.login_attempts WHERE email = ${TEST_EMAIL}`;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('clients lifecycle integration', () => {

  // ── Test 1: POST /api/clients (happy path) ────────────────────────────────
  it('POST /api/clients with valid body → 201 with client shape', async () => {
    const res = await clientsHandler(
      clientsReq('POST', sessionCookie, { name: 'Integration Co', template_key: 'shop' }),
      CTX,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { client: { id: string; schema_name: string; template_key: string; template_version_applied: number } };
    expect(body.client.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(body.client.schema_name).toMatch(/^client_[0-9a-f]{32}$/);
    expect(body.client.template_key).toBe('shop');
    expect(body.client.template_version_applied).toBe(1);

    // Track for afterAll cleanup.
    createdClientIds.push(body.client.id);
    createdSchemaNames.push(body.client.schema_name);
  });

  // ── Test 2: Schema actually exists in DB after create ────────────────────
  it('schema exists in information_schema.tables after create', async () => {
    const createRes = await clientsHandler(
      clientsReq('POST', sessionCookie, { name: 'Integration Co', template_key: 'shop' }),
      CTX,
    );
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json() as { client: { id: string; schema_name: string } };
    const { id, schema_name } = createBody.client;
    createdClientIds.push(id);
    createdSchemaNames.push(schema_name);

    // Confirm shop template tables exist in the new schema.
    const tableRows = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${schema_name}
      ORDER BY table_name
    `) as { table_name: string }[];
    const tableNames = tableRows.map((r) => r.table_name).sort();
    expect(tableNames).toContain('_meta');
    expect(tableNames).toContain('owners');
    expect(tableNames).toContain('employees');
    expect(tableNames).toContain('customers');
  });

  // ── Test 3: GET /api/clients lists the created client ────────────────────
  it('GET /api/clients returns created client in list', async () => {
    const createRes = await clientsHandler(
      clientsReq('POST', sessionCookie, { name: 'Integration Co', template_key: 'shop' }),
      CTX,
    );
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json() as { client: { id: string; schema_name: string } };
    const { id, schema_name } = createBody.client;
    createdClientIds.push(id);
    createdSchemaNames.push(schema_name);

    const listRes = await clientsHandler(clientsReq('GET', sessionCookie), CTX);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { clients: { id: string }[] };
    expect(listBody.clients.some((c) => c.id === id)).toBe(true);
  });

  // ── Test 4: POST with unknown template_key → 400 template_unknown ─────────
  it('POST with unknown template_key → 400 template_unknown', async () => {
    const res = await clientsHandler(
      clientsReq('POST', sessionCookie, { name: 'Integration Co', template_key: 'nope' }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('template_unknown');
  });

  // ── Test 5: POST with empty name → 400 validation_failed ─────────────────
  it('POST with empty name → 400 validation_failed', async () => {
    const res = await clientsHandler(
      clientsReq('POST', sessionCookie, { name: '', template_key: 'shop' }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });

  // ── Test 6: Full lifecycle — create → verify schema → delete → verify gone ─
  it('full lifecycle: create → verify schema exists → DELETE → schema gone, client row gone', async () => {
    // Create.
    const createRes = await clientsHandler(
      clientsReq('POST', sessionCookie, { name: 'Lifecycle Test Shop', template_key: 'shop' }),
      CTX,
    );
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json() as { client: { id: string; schema_name: string } };
    const { id, schema_name } = createBody.client;

    // Verify schema exists.
    const beforeRows = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${schema_name}
    `) as { table_name: string }[];
    expect(beforeRows.length).toBeGreaterThan(0);

    // Delete.
    const deleteRes = await clientsDetailHandler(
      clientsDetailReq('DELETE', id, sessionCookie),
      CTX,
    );
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json() as { ok: boolean };
    expect(deleteBody.ok).toBe(true);

    // Schema should be gone.
    const afterSchemaRows = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${schema_name}
    `) as { table_name: string }[];
    expect(afterSchemaRows).toHaveLength(0);

    // Client row should be gone.
    const afterClientRows = (await sql`
      SELECT id FROM public.clients WHERE id = ${id}::uuid
    `) as { id: string }[];
    expect(afterClientRows).toHaveLength(0);
  });

  // ── Test 7: DELETE on nonexistent id → 404 ───────────────────────────────
  it('DELETE /api/clients-detail with nonexistent id → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await clientsDetailHandler(
      clientsDetailReq('DELETE', fakeId, sessionCookie),
      CTX,
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  // ── Test 8: GET /api/clients-detail returns client; 404 on nonexistent ────
  it('GET /api/clients-detail returns client; 404 on nonexistent id', async () => {
    // Create a client first.
    const createRes = await clientsHandler(
      clientsReq('POST', sessionCookie, { name: 'Integration Co', template_key: 'shop' }),
      CTX,
    );
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json() as { client: { id: string; schema_name: string } };
    const { id, schema_name } = createBody.client;
    createdClientIds.push(id);
    createdSchemaNames.push(schema_name);

    // GET → 200.
    const getRes = await clientsDetailHandler(
      clientsDetailReq('GET', id, sessionCookie),
      CTX,
    );
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as { client: { id: string; schema_name: string } };
    expect(getBody.client.id).toBe(id);
    expect(getBody.client.schema_name).toBe(schema_name);

    // GET on nonexistent id → 404.
    const notFoundRes = await clientsDetailHandler(
      clientsDetailReq('GET', '00000000-0000-0000-0000-000000000001', sessionCookie),
      CTX,
    );
    expect(notFoundRes.status).toBe(404);
  });

  // ── Test 9: No session cookie → POST /api/clients → 401 ──────────────────
  it('POST /api/clients with no cookie → 401 unauthorized', async () => {
    const res = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Integration Co', template_key: 'shop' }),
      }),
      CTX,
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

});
