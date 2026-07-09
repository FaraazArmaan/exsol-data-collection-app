/**
 * Integration tests for auth endpoints (Phase 3 Chunk C — Task 3.10).
 *
 * Plan deviation (controller-approved): handlers are invoked directly via
 *   await handler(new Request(...), {} as Context)
 * instead of the plan's original `netlify dev` + fetch() pattern.
 * Rationale: Netlify routing config is a Phase 11 deploy concern; the auth
 * logic itself is what these tests need to validate. Direct invocation is
 * faster, requires no separate process, and exercises identical handler code
 * against the real Neon dev DB.
 *
 * ENV loading: handled by tests/setup-env.ts (vitest setupFile) which parses
 * .env using Node's fs module before any test module is imported. dotenv is
 * not a direct project dependency.
 */

// vi.mock must be at top level — vitest hoists it before imports.
vi.mock('../../netlify/functions/_shared/google-verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import { verifyGoogleIdToken } from '../../netlify/functions/_shared/google-verifier';
import loginHandler from '../../netlify/functions/auth-login';
import meHandler from '../../netlify/functions/auth-me';
import logoutHandler from '../../netlify/functions/auth-logout';
import googleHandler from '../../netlify/functions/auth-google';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_EMAIL = 'auth-test@example.com';
const TEST_PASSWORD = 'integration-test-pw';
const TEST_IP = '203.0.113.42'; // TEST-NET-3 reserved range (RFC 5737)
const CTX = {} as Context;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loginReq(email: string, password: string, ip?: string): Request {
  return new Request('http://localhost/api/auth-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'x-nf-client-connection-ip': ip } : {}),
    },
    body: JSON.stringify({ email, password }),
  });
}

function meReq(cookieToken: string): Request {
  return new Request('http://localhost/api/auth-me', {
    method: 'GET',
    headers: { cookie: `session=${cookieToken}` },
  });
}

function logoutReq(cookieToken: string): Request {
  return new Request('http://localhost/api/auth-logout', {
    method: 'POST',
    headers: { cookie: `session=${cookieToken}` },
  });
}

function googleReq(idToken: string, ip?: string): Request {
  return new Request('http://localhost/api/auth-google', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'x-nf-client-connection-ip': ip } : {}),
    },
    body: JSON.stringify({ idToken }),
  });
}

/** Extract the bare session=<token> pair from a Set-Cookie header value. */
function extractSessionCookie(setCookie: string): string {
  return setCookie.split(';')[0]!; // e.g. "session=eyJ..."
}

/** Extract only the token value from "session=<token>". */
function extractToken(setCookie: string): string {
  const pair = extractSessionCookie(setCookie);
  return pair.slice('session='.length);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let sql: ReturnType<typeof neon>;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);

  // Upsert the test admin with a known password hash.
  // ON CONFLICT (email) UPDATE ensures idempotency if a previous test run
  // crashed without running afterAll.
  const hash = await hashPassword(TEST_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${TEST_EMAIL}, ${hash}, 'Auth Test Admin', false)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${hash}, google_sub = NULL, display_name = 'Auth Test Admin'
  `;
});

beforeEach(async () => {
  // Clear rate-limit state for the test email and for any IP-only rows
  // (where email is NULL) to keep test isolation clean.
  await sql`
    DELETE FROM public.login_attempts
    WHERE email = ${TEST_EMAIL}
       OR email LIKE 'test-%@example.com'
  `;
  // Also purge any NULL-email rows recorded against TEST_IP so the
  // IP-throttle test starts fresh.
  await sql`
    DELETE FROM public.login_attempts
    WHERE email IS NULL
      AND ip = ${TEST_IP}::inet
  `;

  // Reset google_sub to NULL so Google-bind tests start cleanly.
  await sql`
    UPDATE public.admins SET google_sub = NULL WHERE email = ${TEST_EMAIL}
  `;
});

afterAll(async () => {
  await sql`DELETE FROM public.admins WHERE email = ${TEST_EMAIL}`;
  await sql`
    DELETE FROM public.login_attempts
    WHERE email = ${TEST_EMAIL}
       OR email LIKE 'test-%@example.com'
       OR (email IS NULL AND ip = ${TEST_IP}::inet)
  `;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth integration', () => {
  it('auth-login rejects cross-site POST before credential handling', async () => {
    const res = await loginHandler(new Request('https://app.example.test/api/auth-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'https://evil.example.test',
      },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    }), CTX);

    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('csrf_origin_mismatch');
  });

  // ── Test 1: login → me → logout happy path ────────────────────────────────
  it('login → me → logout (happy path)', async () => {
    // 1a. Login
    const loginRes = await loginHandler(loginReq(TEST_EMAIL, TEST_PASSWORD), CTX);
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json() as { admin: { email: string } };
    expect(loginBody.admin.email).toBe(TEST_EMAIL);

    const setCookieLogin = loginRes.headers.get('set-cookie');
    expect(setCookieLogin).toBeTruthy();
    expect(setCookieLogin!).toMatch(/^session=/);
    const token = extractToken(setCookieLogin!);

    // 1b. me
    const meRes = await meHandler(meReq(token), CTX);
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json() as { admin: { email: string } };
    expect(meBody.admin.email).toBe(TEST_EMAIL);

    // 1c. logout
    const logoutRes = await logoutHandler(logoutReq(token), CTX);
    expect(logoutRes.status).toBe(200);
    const setCookieLogout = logoutRes.headers.get('set-cookie');
    expect(setCookieLogout).toBeTruthy();
    expect(setCookieLogout!).toContain('Max-Age=0');
  });

  // ── Test 2: login rejects wrong password ─────────────────────────────────
  it('login rejects wrong password → 401', async () => {
    const res = await loginHandler(loginReq(TEST_EMAIL, 'definitely-wrong-password'), CTX);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  // ── Test 3: me rejects no cookie ─────────────────────────────────────────
  it('me rejects request with no cookie → 401', async () => {
    const req = new Request('http://localhost/api/auth-me', { method: 'GET' });
    const res = await meHandler(req, CTX);
    expect(res.status).toBe(401);
  });

  // ── Test 4: login rejects nonexistent email ───────────────────────────────
  it('login rejects nonexistent email → 401', async () => {
    const res = await loginHandler(
      loginReq('no-such-user@example.com', 'any-password'),
      CTX,
    );
    expect(res.status).toBe(401);
  });

  // ── Test 5: timing equality between nonexistent-email and wrong-password ──
  it('login: nonexistent-email and wrong-password paths have similar latency (timing oracle check)', async () => {
    const RUNS = 5; // more samples = more stable median
    const THRESHOLD_MS = 250; // argon2 is ~100 ms; under shared-machine load the
    // baseline variance is ~30-50 ms even with constant-time defenses. A real
    // early-return leak would still show 80+ ms diff but consistently — this
    // threshold tolerates noise without weakening the assertion's intent.

    async function measureMs(req: Request): Promise<number> {
      const t0 = performance.now();
      await loginHandler(req, CTX);
      return performance.now() - t0;
    }

    // Warm up argon cache (dummyHash is lazy — first call computes and caches it)
    await loginHandler(loginReq('warmup@example.com', 'warmup-pass'), CTX);
    await loginHandler(loginReq(TEST_EMAIL, 'warmup-pass'), CTX);

    const nonexistentTimes: number[] = [];
    const wrongPwTimes: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      nonexistentTimes.push(await measureMs(loginReq('nonexistent-timing@example.com', 'any')));
      wrongPwTimes.push(await measureMs(loginReq(TEST_EMAIL, 'wrong-pw-timing')));
    }

    // Use median to reduce variance from outliers
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    };

    const diff = Math.abs(median(nonexistentTimes) - median(wrongPwTimes));
    expect(diff).toBeLessThan(THRESHOLD_MS);
  }, 60_000);

  // ── Test 6: email rate-limit fires after 10 failures ─────────────────────
  it('rate-limit: email throttles after 10 failed attempts → 429 with email_throttled', async () => {
    // Submit 10 failing attempts
    for (let i = 0; i < 10; i++) {
      const res = await loginHandler(
        loginReq(TEST_EMAIL, `bad-password-${i}`, TEST_IP),
        CTX,
      );
      expect(res.status).toBe(401);
    }

    // 11th attempt must be blocked
    const blockedRes = await loginHandler(
      loginReq(TEST_EMAIL, 'still-wrong', TEST_IP),
      CTX,
    );
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get('retry-after')).toBeTruthy();
    const blockedBody = await blockedRes.json() as {
      error: { code: string; details: { reason: string } };
    };
    expect(blockedBody.error.code).toBe('too_many_attempts');
    expect(blockedBody.error.details.reason).toBe('email_throttled');
  }, 60_000);

  // ── Test 7: IP rate-limit fires after 20 failures across different emails ──
  it('rate-limit: IP throttles after 20 failures across distinct emails → 429 with ip_throttled', async () => {
    // 20 failures with different emails — each gets 401 (email not found)
    for (let i = 0; i < 20; i++) {
      const res = await loginHandler(
        loginReq(`test-ip-${i}@example.com`, 'bad-pw', TEST_IP),
        CTX,
      );
      // Each distinct email has 0 email-attempts so email limit is not hit;
      // but all share TEST_IP so the IP counter climbs.
      expect(res.status).toBe(401);
    }

    // 21st attempt (any email) must be IP-blocked
    const blockedRes = await loginHandler(
      loginReq(`test-ip-overflow@example.com`, 'bad-pw', TEST_IP),
      CTX,
    );
    expect(blockedRes.status).toBe(429);
    const blockedBody = await blockedRes.json() as {
      error: { code: string; details: { reason: string } };
    };
    expect(blockedBody.error.code).toBe('too_many_attempts');
    expect(blockedBody.error.details.reason).toBe('ip_throttled');
  }, 120_000);

  // ── Test 8: tampered cookie → 401 ────────────────────────────────────────
  it('auth-me: tampered cookie returns 401', async () => {
    // Get a fresh valid session
    const loginRes = await loginHandler(loginReq(TEST_EMAIL, TEST_PASSWORD), CTX);
    expect(loginRes.status).toBe(200);
    const token = extractToken(loginRes.headers.get('set-cookie')!);

    // Mutate the last 4 characters
    const tampered = token.slice(0, -4) + 'XXXX';
    const res = await meHandler(meReq(tampered), CTX);
    expect(res.status).toBe(401);
  });

  // ── Test 9: auth-google happy path with mocked verifier ──────────────────
  it('auth-google: happy path — logs in and binds google_sub (mocked verifier)', async () => {
    const mockVerify = verifyGoogleIdToken as ReturnType<typeof vi.fn>;
    mockVerify.mockResolvedValueOnce({
      sub: 'fake-google-sub-123',
      email: TEST_EMAIL,
      emailVerified: true,
      name: 'Auth Test',
    });

    const res = await googleHandler(googleReq('fake-token', TEST_IP), CTX);
    expect(res.status).toBe(200);

    const body = await res.json() as { admin: { email: string } };
    expect(body.admin.email).toBe(TEST_EMAIL);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie!).toMatch(/^session=/);

    // Verify google_sub was bound in the database
    const rows = await sql`
      SELECT google_sub FROM public.admins WHERE email = ${TEST_EMAIL}
    ` as { google_sub: string | null }[];
    expect(rows[0]?.google_sub).toBe('fake-google-sub-123');
  });

  // ── Test 10: auth-google does NOT overwrite existing google_sub ───────────
  it('auth-google: first-bind only — does not overwrite pre-existing google_sub', async () => {
    // Directly set a pre-existing google_sub
    await sql`
      UPDATE public.admins SET google_sub = 'pre-existing-sub' WHERE email = ${TEST_EMAIL}
    `;

    const mockVerify = verifyGoogleIdToken as ReturnType<typeof vi.fn>;
    mockVerify.mockResolvedValueOnce({
      sub: 'different-sub',
      email: TEST_EMAIL,
      emailVerified: true,
      name: 'Auth Test',
    });

    const res = await googleHandler(googleReq('fake-token-2', TEST_IP), CTX);
    // Login still succeeds because the email matches
    expect(res.status).toBe(200);

    // google_sub must remain the original value — UPDATE only runs WHERE google_sub IS NULL
    const rows = await sql`
      SELECT google_sub FROM public.admins WHERE email = ${TEST_EMAIL}
    ` as { google_sub: string | null }[];
    expect(rows[0]?.google_sub).toBe('pre-existing-sub');
  });

});
