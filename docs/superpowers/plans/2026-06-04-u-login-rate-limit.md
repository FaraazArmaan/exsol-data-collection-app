# Rate-limit `u-login` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the existing `_shared/rate-limit.ts` helper to `u-login.ts` so bucket-user logins get the same throttling guarantees as admin logins.

**Architecture:** Single-file server change mirroring the rate-limit flow already in `auth-login.ts`. `extractIp` → `checkRateLimit` (BEFORE any DB work) → on failure log `'failed'` + return 401 → on success log `'success'` + mint session. Add `too_many_attempts` error message to `UserLogin.tsx` (admin `LoginPage.tsx` already has this).

**Tech Stack:** TypeScript everywhere. Netlify Functions + Neon. Vitest for tests. Builds on [2026-06-04-u-login-rate-limit-design.md](../specs/2026-06-04-u-login-rate-limit-design.md).

---

## File map

**Modified files:**
- `netlify/functions/u-login.ts` — add imports + 3 helper calls.
- `src/modules/user-portal/pages/UserLogin.tsx` — extend the existing error mapping with a `too_many_attempts` branch.
- `tests/integration/user-node-auth.test.ts` — add 3 new test cases inside the existing describe block.

**No new files. No migration. No new dependencies.**

---

## Pre-flight (every task)

```bash
npm run typecheck && npm test
```

Both green before commit. Saved feedback `feedback_implementer_verify_typecheck` is binding.

---

# Task 1: Instrument `u-login.ts` + integration tests

**Files:**
- Modify: `netlify/functions/u-login.ts`
- Modify: `tests/integration/user-node-auth.test.ts`

- [ ] **Step 1: Write the failing integration tests**

In `tests/integration/user-node-auth.test.ts`, find the existing u-login describe block (or the u-login happy-path tests). Add these 3 tests inside it:

```typescript
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
```

The `createNodeWithLogin` helper, `uLoginHandler`, `testClientSlug`, `sql`, and `CTX` are all in scope in this file from the existing `beforeAll`/`beforeEach` setup — verify by reading the file before pasting the tests.

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- tests/integration/user-node-auth.test.ts
```

Expected: the 3 new tests FAIL. The first two fail because `login_attempts` has no rows — `u-login` doesn't log anything yet. The third fails because seeding 10 failed attempts doesn't change `u-login`'s behavior — it still returns 200 (or 401 for wrong pw) regardless.

- [ ] **Step 3: Instrument `u-login.ts`**

Edit `netlify/functions/u-login.ts`. Four insertions:

**3a. Add import** (after the existing imports, around line 13):

```typescript
import { checkRateLimit, logAttempt, extractIp } from './_shared/rate-limit';
```

**3b. Rate-limit check** — right after the body parse on line 36, BEFORE the slug lookup on line 39:

```typescript
const ip = extractIp(req);
const sql = db();
const limit = await checkRateLimit(sql, { email: parsed.data.email, ip });
if (!limit.allowed) {
  return jsonError(429, 'too_many_attempts', { retry_after_sec: limit.retryAfterSec });
}
```

(Note: the existing code has `const sql = db();` on line 38. Move that line UP into the rate-limit block so it's available, and DELETE the original `const sql = db();` line.)

**3c. Failure logging** — modify the existing failure paths. There are TWO failure paths:

- Line 43: `if (!client) return jsonError(404, 'client_not_found');`
- Line 54: `if (!ok || !credential) return jsonError(401, 'unauthorized');`

Both should log a failed attempt before returning. Replace both:

```typescript
// Line 43 → becomes:
if (!client) {
  await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
  return jsonError(404, 'client_not_found');
}

// Line 54 → becomes:
if (!ok || !credential) {
  await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
  return jsonError(401, 'unauthorized');
}
```

**3d. Success logging** — after the `UPDATE last_login_at` (existing line 56), BEFORE `mintBucketUserSession`:

```typescript
await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'success' });
```

Final file should have:
- Original imports + the new `rate-limit` import
- Body parse → `extractIp` → `db()` → `checkRateLimit` → 429 short-circuit
- Slug lookup → log failure + 404 on miss
- Credential lookup + verifyPassword → log failure + 401 on miss/bad-pw
- Success path: log success → update last_login_at → mint session → 200 with cookie

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm run typecheck
npm test -- tests/integration/user-node-auth.test.ts
```

Expected: typecheck clean. All 3 new tests pass. Existing u-login tests (happy path, wrong password) still pass.

- [ ] **Step 5: Full suite**

```bash
npm test
```

Expected: previous green count (~230) + 3 new = ~233 passing.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/u-login.ts tests/integration/user-node-auth.test.ts
git commit -m "$(cat <<'EOF'
feat(u-login): rate-limit via shared _shared/rate-limit helper

Mirror the rate-limit flow auth-login already has. 5-min sliding window,
10 failed attempts per email, 20 per IP — shared with admin login via the
same login_attempts table. extractIp + checkRateLimit run BEFORE the
slug/credential lookups so attackers don't pay DB cost to be told they're
throttled. Both failure paths (404 client_not_found, 401 unauthorized)
log as 'failed'; the success path logs as 'success'.

3 integration tests cover: failure logs as 'failed', success logs as
'success', 10 seeded failures triggers 429 even on correct password.

Closes the spec at docs/superpowers/specs/2026-06-04-u-login-rate-limit-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Task 2: Friendly `too_many_attempts` message in `UserLogin.tsx`

The admin `LoginPage.tsx` already maps `too_many_attempts` to a friendly message ("Too many attempts. Try again in a few minutes."). The bucket-user `UserLogin.tsx` only maps `unauthorized` — everything else falls through to a generic `Login failed (too_many_attempts).` which is ugly. Match the admin pattern.

**Files:**
- Modify: `src/modules/user-portal/pages/UserLogin.tsx`

- [ ] **Step 1: Locate the error mapping**

`src/modules/user-portal/pages/UserLogin.tsx` line 48 currently:

```typescript
setError(r.error.code === 'unauthorized' ? 'Email or password incorrect.' : `Login failed (${r.error.code}).`);
```

- [ ] **Step 2: Add the `too_many_attempts` branch**

Replace the line with a clearer mapping:

```typescript
if (r.error.code === 'too_many_attempts') {
  setError('Too many attempts. Try again in a few minutes.');
} else if (r.error.code === 'unauthorized') {
  setError('Email or password incorrect.');
} else {
  setError(`Login failed (${r.error.code}).`);
}
```

(Same wording as `LoginPage.tsx` for consistency. The 429 retry_after_sec is in the error body but we don't render a live countdown in v1 — defer to a polish pass.)

- [ ] **Step 3: Run typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: clean. Test count unchanged at ~233 (no new tests this task; UI smoke covers via the existing manual flow).

- [ ] **Step 4: Commit**

```bash
git add src/modules/user-portal/pages/UserLogin.tsx
git commit -m "feat(user-portal): friendly too_many_attempts message in UserLogin"
```

- [ ] **Step 5: Manual smoke (optional but recommended)**

Start dev server if not running. Open `http://localhost:8888/c/joe-s-hardware/login`.

1. Enter `joe@joeshardware.com` + wrong password. Expect: "Email or password incorrect."
2. Repeat 9 more times (10 total failed). Verify each shows the unauthorized message.
3. On the 11th attempt (or any attempt after the threshold), expect: "Too many attempts. Try again in a few minutes."
4. Optionally: clear the throttle by running `DELETE FROM public.login_attempts WHERE email = 'joe@joeshardware.com'` against dev DB, then verify a correct password works again.

If the 11th attempt doesn't show the throttle message, check the dev-server console for any 500s from the rate-limit helper (column type mismatches, etc.). 

Step 5 is a nice-to-have — the integration test from Task 1 step 3 already pins the server behavior.

---

## Self-review checklist (after both tasks done)

- [ ] `npm run typecheck` clean.
- [ ] `npm test` shows previous count + 3 = ~233.
- [ ] Failed `u-login` attempts (wrong password OR bad slug) both log as `'failed'`.
- [ ] Success path logs as `'success'`.
- [ ] 429 returned with body `{ error: { code: 'too_many_attempts', details: { retry_after_sec: ... } } }`.
- [ ] UserLogin.tsx maps `too_many_attempts` to the friendly message.
- [ ] No migration; no new dependencies; no new endpoints.

## Out of scope (do not implement)

- Per-client rate-limit scoping.
- Separate thresholds for bucket-user vs admin.
- Account lockout UI / unlock flow.
- CAPTCHA.
- Rate-limiting forgot-password / u-change-password / link-google.
- Telemetry/alerting on suspicious patterns.
- Logging the rate-limit hit to `audit_log`.
- Live countdown in the UserLogin error message.
