/**
 * Integration tests for bucket CRUD endpoints + singleton concurrency (Phase 7 Tasks 7.1 + 7.2).
 *
 * Plan deviation (controller-approved): handlers are invoked directly via
 *   await handler(new Request(...), {} as Context)
 * instead of netlify dev + fetch(). Same rationale as auth.test.ts and
 * clients-lifecycle.test.ts — direct invocation is faster and exercises
 * identical handler code against the real Neon dev DB.
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
import clientsBucketsHandler from '../../netlify/functions/clients-buckets';
import clientsBucketUsersHandler from '../../netlify/functions/clients-bucket-users';
import clientsBucketUserDetailHandler from '../../netlify/functions/clients-bucket-user-detail';
import { dropClientSchema } from '../../netlify/functions/_shared/schema-manager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_EMAIL = 'buckets-cardinality-test@example.com';
const TEST_PASSWORD = 'buckets-cardinality-pw';
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
  return setCookie.split(';')[0]!;
}

function bucketsReq(clientId: string, cookie: string): Request {
  return new Request(`http://localhost/api/clients-buckets?client=${clientId}`, {
    method: 'GET',
    headers: { cookie },
  });
}

function bucketUsersReq(method: 'GET' | 'POST', clientId: string, role: string, cookie: string, body?: unknown): Request {
  return new Request(`http://localhost/api/clients-bucket-users?client=${clientId}&role=${role}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function bucketUserDetailReq(method: 'PATCH' | 'DELETE', clientId: string, role: string, userId: string, cookie: string, body?: unknown): Request {
  return new Request(`http://localhost/api/clients-bucket-user-detail?client=${clientId}&role=${role}&user=${userId}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let sql: ReturnType<typeof neon>;
let sessionCookie: string;
let actorAdminId: string;

// Per-test client state (set in beforeEach, torn down in afterEach).
let testClientId: string;
let testSchemaName: string;

// Straggler tracking.
const createdClientIds: string[] = [];
const createdSchemaNames: string[] = [];

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);

  const hash = await hashPassword(TEST_PASSWORD);
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${TEST_EMAIL}, ${hash}, 'Buckets Test Admin', false)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${hash}, google_sub = NULL, display_name = 'Buckets Test Admin'
    RETURNING id
  `) as { id: string }[];
  actorAdminId = rows[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${TEST_EMAIL}`;
  sessionCookie = await loginAndGetCookie();

  // Create a fresh hospital client for this test.
  const res = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ name: 'Buckets Test Hospital', template_key: 'hospital' }),
    }),
    CTX,
  );
  if (res.status !== 201) throw new Error(`Failed to create test client: ${res.status}`);
  const body = await res.json() as { client: { id: string; schema_name: string } };
  testClientId = body.client.id;
  testSchemaName = body.client.schema_name;
  createdClientIds.push(testClientId);
  createdSchemaNames.push(testSchemaName);
});

afterEach(async () => {
  // Delete the test client (cascades the schema drop via clients-detail handler).
  if (testClientId) {
    try {
      await clientsDetailHandler(
        new Request(`http://localhost/api/clients-detail?id=${testClientId}`, {
          method: 'DELETE',
          headers: { cookie: sessionCookie },
        }),
        CTX,
      );
    } catch {
      // Best-effort: if already deleted or schema gone, ignore.
      try {
        await dropClientSchema({ schemaName: testSchemaName, clientId: testClientId, actorAdminId });
      } catch { /* best-effort */ }
      try {
        await sql`DELETE FROM public.clients WHERE id = ${testClientId}::uuid`;
      } catch { /* best-effort */ }
    }
    const ci = createdClientIds.indexOf(testClientId);
    if (ci >= 0) createdClientIds.splice(ci, 1);
    const si = createdSchemaNames.indexOf(testSchemaName);
    if (si >= 0) createdSchemaNames.splice(si, 1);
  }
});

afterAll(async () => {
  // Drop any straggler schemas.
  for (const schemaName of createdSchemaNames) {
    try { await sql(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); } catch { /* best-effort */ }
  }
  for (const clientId of createdClientIds) {
    try { await sql`DELETE FROM public.clients WHERE id = ${clientId}::uuid`; } catch { /* best-effort */ }
  }
  // Clean up test admin.
  if (actorAdminId) {
    await sql`DELETE FROM public.schema_ops_log WHERE actor_admin = ${actorAdminId}::uuid`;
  }
  await sql`DELETE FROM public.admins WHERE email = ${TEST_EMAIL}`;
  await sql`DELETE FROM public.login_attempts WHERE email = ${TEST_EMAIL}`;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bucket CRUD endpoints + singleton concurrency', () => {

  // ── Test 1: GET /clients-buckets returns 5 buckets for hospital ─────────
  it('GET /clients-buckets returns 5 buckets in order with zero counts', async () => {
    const res = await clientsBucketsHandler(bucketsReq(testClientId, sessionCookie), CTX);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      client: { id: string; name: string };
      buckets: Array<{ role: string; label: string; cardinality: string; count: number; columns: unknown[] }>;
    };
    expect(body.client.id).toBe(testClientId);
    expect(body.buckets).toHaveLength(5);

    const roles = body.buckets.map((b) => b.role);
    expect(roles).toEqual(['directors', 'doctors', 'nurses', 'staff', 'patients']);

    const directors = body.buckets[0]!;
    expect(directors.cardinality).toBe('singleton');
    expect(directors.count).toBe(0);

    const doctors = body.buckets[1]!;
    expect(doctors.cardinality).toBe('multi');
    expect(doctors.count).toBe(0);
    expect(doctors.columns.length).toBeGreaterThan(0);

    // All counts zero on fresh schema.
    for (const b of body.buckets) {
      expect(b.count).toBe(0);
    }
  });

  // ── Test 2: POST to singleton role (happy path) + list ──────────────────
  it('POST to directors (singleton) succeeds; list returns 1 user', async () => {
    const addRes = await clientsBucketUsersHandler(
      bucketUsersReq('POST', testClientId, 'directors', sessionCookie, { display_name: 'Dr. Alice' }),
      CTX,
    );
    expect(addRes.status).toBe(201);
    const addBody = await addRes.json() as { user: { id: string; display_name: string } };
    expect(addBody.user.display_name).toBe('Dr. Alice');
    expect(addBody.user.id).toBeTruthy();

    // List returns 1 user.
    const listRes = await clientsBucketUsersHandler(
      bucketUsersReq('GET', testClientId, 'directors', sessionCookie),
      CTX,
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { users: { id: string }[] };
    expect(listBody.users).toHaveLength(1);
    expect(listBody.users[0]!.id).toBe(addBody.user.id);

    // Buckets endpoint now shows count = 1 for directors.
    const bucketsRes = await clientsBucketsHandler(bucketsReq(testClientId, sessionCookie), CTX);
    const bucketsBody = await bucketsRes.json() as { buckets: Array<{ role: string; count: number }> };
    const directorsBucket = bucketsBody.buckets.find((b) => b.role === 'directors')!;
    expect(directorsBucket.count).toBe(1);
  });

  // ── Test 3: Attempt to add second director → 409 conflict ───────────────
  it('second POST to directors (singleton) → 409 conflict; count stays 1', async () => {
    // First add succeeds.
    const first = await clientsBucketUsersHandler(
      bucketUsersReq('POST', testClientId, 'directors', sessionCookie, { display_name: 'Director One' }),
      CTX,
    );
    expect(first.status).toBe(201);

    // Second add must fail with 409.
    const second = await clientsBucketUsersHandler(
      bucketUsersReq('POST', testClientId, 'directors', sessionCookie, { display_name: 'Director Two' }),
      CTX,
    );
    expect(second.status).toBe(409);
    const secondBody = await second.json() as { error: { code: string } };
    expect(secondBody.error.code).toBe('conflict');

    // List still shows only 1 user.
    const listRes = await clientsBucketUsersHandler(
      bucketUsersReq('GET', testClientId, 'directors', sessionCookie),
      CTX,
    );
    const listBody = await listRes.json() as { users: unknown[] };
    expect(listBody.users).toHaveLength(1);
  });

  // ── Test 4: Concurrent dual-add to singleton → exactly one 201, one 409 ─
  it('concurrent dual-add to directors singleton → exactly one 201 and one 409', async () => {
    // Fire both requests simultaneously.
    const [resultA, resultB] = await Promise.allSettled([
      clientsBucketUsersHandler(
        bucketUsersReq('POST', testClientId, 'directors', sessionCookie, { display_name: 'Concurrent A' }),
        CTX,
      ),
      clientsBucketUsersHandler(
        bucketUsersReq('POST', testClientId, 'directors', sessionCookie, { display_name: 'Concurrent B' }),
        CTX,
      ),
    ]);

    // Both promises should fulfill (not reject).
    expect(resultA.status).toBe('fulfilled');
    expect(resultB.status).toBe('fulfilled');

    const resA = (resultA as PromiseFulfilledResult<Response>).value;
    const resB = (resultB as PromiseFulfilledResult<Response>).value;

    const statuses = [resA.status, resB.status].sort();
    // Exactly one 201 and one 409.
    expect(statuses).toEqual([201, 409]);

    // Count must be exactly 1 after the race.
    const listRes = await clientsBucketUsersHandler(
      bucketUsersReq('GET', testClientId, 'directors', sessionCookie),
      CTX,
    );
    const listBody = await listRes.json() as { users: unknown[] };
    expect(listBody.users).toHaveLength(1);
  }, 30_000);

  // ── Test 5: Add doctor with required column (multi role happy path) ──────
  it('POST to doctors (multi) with required specialty → 201, doctor visible in list', async () => {
    const addRes = await clientsBucketUsersHandler(
      bucketUsersReq('POST', testClientId, 'doctors', sessionCookie, {
        display_name: 'Dr. Smith',
        specialty: 'Cardiology',
      }),
      CTX,
    );
    expect(addRes.status).toBe(201);
    const addBody = await addRes.json() as { user: { id: string; display_name: string; specialty?: unknown } };
    expect(addBody.user.display_name).toBe('Dr. Smith');
    expect((addBody.user as Record<string, unknown>).specialty).toBe('Cardiology');

    const listRes = await clientsBucketUsersHandler(
      bucketUsersReq('GET', testClientId, 'doctors', sessionCookie),
      CTX,
    );
    const listBody = await listRes.json() as { users: Array<{ id: string }> };
    expect(listBody.users).toHaveLength(1);
    expect(listBody.users[0]!.id).toBe(addBody.user.id);
  });

  // ── Test 6: Add doctor missing required column → 400 validation_failed ───
  it('POST to doctors without required specialty → 400 validation_failed', async () => {
    const res = await clientsBucketUsersHandler(
      bucketUsersReq('POST', testClientId, 'doctors', sessionCookie, {
        display_name: 'Dr. Jones',
        // specialty intentionally omitted
      }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
  });

  // ── Test 7: PATCH a doctor's specialty ──────────────────────────────────
  it('PATCH a doctor specialty → 200, updated_at advanced, specialty changed', async () => {
    // Create the doctor first.
    const addRes = await clientsBucketUsersHandler(
      bucketUsersReq('POST', testClientId, 'doctors', sessionCookie, {
        display_name: 'Dr. Patch',
        specialty: 'General',
      }),
      CTX,
    );
    expect(addRes.status).toBe(201);
    const addBody = await addRes.json() as { user: { id: string; updated_at: string } };
    const doctorId = addBody.user.id;
    const originalUpdatedAt = addBody.user.updated_at;

    // Brief wait to ensure updated_at advances.
    await new Promise((r) => setTimeout(r, 50));

    const patchRes = await clientsBucketUserDetailHandler(
      bucketUserDetailReq('PATCH', testClientId, 'doctors', doctorId, sessionCookie, {
        specialty: 'Neurology',
      }),
      CTX,
    );
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json() as { user: { id: string; updated_at: string } };
    expect(patchBody.user.id).toBe(doctorId);
    expect((patchBody.user as Record<string, unknown>).specialty).toBe('Neurology');
    // updated_at should be >= original (may be equal in fast DBs, but not earlier).
    expect(new Date(patchBody.user.updated_at) >= new Date(originalUpdatedAt)).toBe(true);
  });

  // ── Test 8: DELETE a user → 200, user gone from list ────────────────────
  it('DELETE a doctor → 200 ok:true, user gone from list', async () => {
    const addRes = await clientsBucketUsersHandler(
      bucketUsersReq('POST', testClientId, 'doctors', sessionCookie, {
        display_name: 'Dr. Delete Me',
        specialty: 'Oncology',
      }),
      CTX,
    );
    expect(addRes.status).toBe(201);
    const addBody = await addRes.json() as { user: { id: string } };
    const doctorId = addBody.user.id;

    const delRes = await clientsBucketUserDetailHandler(
      bucketUserDetailReq('DELETE', testClientId, 'doctors', doctorId, sessionCookie),
      CTX,
    );
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json() as { ok: boolean };
    expect(delBody.ok).toBe(true);

    // User should not appear in list.
    const listRes = await clientsBucketUsersHandler(
      bucketUsersReq('GET', testClientId, 'doctors', sessionCookie),
      CTX,
    );
    const listBody = await listRes.json() as { users: Array<{ id: string }> };
    expect(listBody.users.find((u) => u.id === doctorId)).toBeUndefined();
  });

  // ── Test 9: PATCH nonexistent user → 404 ────────────────────────────────
  it('PATCH nonexistent user → 404 not_found', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000099';
    const res = await clientsBucketUserDetailHandler(
      bucketUserDetailReq('PATCH', testClientId, 'doctors', fakeId, sessionCookie, {
        specialty: 'Radiology',
      }),
      CTX,
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  // ── Test 10: GET /clients-buckets on missing client → 404 ───────────────
  it('GET /clients-buckets with nonexistent client id → 404 not_found', async () => {
    const fakeClientId = '00000000-0000-0000-0000-000000000000';
    const res = await clientsBucketsHandler(bucketsReq(fakeClientId, sessionCookie), CTX);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

});
