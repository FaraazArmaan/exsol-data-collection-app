# Rate-limit `u-login` — Design

**Date:** 2026-06-04
**Status:** Approved — implementation plan to follow
**Predecessors:** [2026-05-26-bucket-user-auth-design.md](./2026-05-26-bucket-user-auth-design.md), [2026-06-04-audit-log-design.md](./2026-06-04-audit-log-design.md)

## 1. Problem

`netlify/functions/auth-login.ts` (admin login) is rate-limited via `_shared/rate-limit.ts` — 5-minute sliding window, 10 failed attempts per email, 20 per IP, lazy GC. `netlify/functions/u-login.ts` (bucket-user login) is **not**. An attacker can brute-force bucket-user passwords (or harvest valid emails) against a known client slug with no throttling. The defensive infrastructure already exists and is battle-tested via the admin path; the bucket-user path just doesn't call it.

## 2. Goal

Apply the existing rate-limit helper to `u-login.ts` so bucket-user logins get the same throttling guarantees as admin logins. Single-file change.

## 3. Non-goals

- **Per-client scoping** of rate limits. The `login_attempts` table has columns `(email, ip, outcome, attempted_at)` — no `client_id`. For a single-tenant deployment, global per-email throttling is the right behavior. Multi-tenant scoping is a future enhancement (would require a migration + helper signature change).
- **Different thresholds** for bucket-user vs admin. Use the same 10/email + 20/IP constants in `_shared/rate-limit.ts` (no new tunables).
- **Account lockout UI** beyond the 429 error message. The throttle releases automatically after the 5-minute window; no manual unlock needed.
- **Rate-limiting `forgot-password`** (deferred — separate scope discussion).
- **Rate-limiting `u-change-password`** (deferred — caller already has a valid bu_session, different threat model).
- **Rate-limiting Google sign-in** paths (Google's own token issuance throttles).
- **CAPTCHA after N failures** (out of scope; throttling is the v1 mitigation).
- **Tracking lockout state in the user's session** (purely time-based, no per-user state).

## 4. Architecture

### 4.1 `u-login.ts` change

Mirror the rate-limit flow `auth-login.ts:25-45` already has. Three insertions:

```typescript
// 1. Imports
import { checkRateLimit, logAttempt, extractIp } from './_shared/rate-limit';

// 2. After body parse, BEFORE the credential lookup:
const ip = extractIp(req);
const limit = await checkRateLimit(sql, { email: parsed.data.email, ip });
if (!limit.allowed) {
  return jsonError(429, 'too_many_attempts', { retry_after_sec: limit.retryAfterSec });
}

// 3. On every failure path (credential not found, password mismatch),
// BEFORE returning the 401:
await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });

// 4. On the success path, BEFORE minting the bu_session:
await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'success' });
```

### 4.2 Shared `login_attempts` table

Bucket-user failed attempts contribute to the **same** per-email and per-IP counters as admin failed attempts. Rationale: an attacker probing a known email shouldn't get a fresh budget just by switching login endpoints. For single-tenant deployments where an email rarely exists in both admin and a bucket-user workspace, this collision is benign. If an email DOES exist in both, the legitimate user's experience is slightly worse (shared lockout); this is a known acceptable trade-off documented in spec §3.

### 4.3 Error shape

`429 too_many_attempts` with body `{ error: { code: 'too_many_attempts', details: { retry_after_sec: 300 } } }` — matches `auth-login`'s shape exactly so any error-handling code that already keys on `too_many_attempts` works for both surfaces.

### 4.4 Frontend

`src/modules/user-portal/pages/UserLogin.tsx` may already map `too_many_attempts` to a friendly message via the existing admin-login experience. **Verify during implementation**; if not, add:

```typescript
errCode === 'too_many_attempts' ? 'Too many failed attempts — please wait a few minutes before trying again.'
```

The retry_after_sec value is available in the error body if a countdown is desired (deferred to a polish pass).

## 5. Error handling

| Scenario | Behavior |
|---|---|
| Email threshold exceeded (10 failed in last 5 min) | 429 `too_many_attempts` |
| IP threshold exceeded (20 failed in last 5 min) | 429 `too_many_attempts` |
| Race: two concurrent failures pass the check, both log | Acceptable (documented in `_shared/rate-limit.ts:32-39`; argon2's verify cost caps the attacker's max-win-per-burst) |
| `extractIp` returns null (no recognizable IP header) | `checkRateLimit` skips the IP dimension; email throttling still applies |
| `logAttempt` INSERT fails | Currently the call is awaited and an error would propagate. The same is true for `auth-login`. Acceptable — DB-down means the request fails anyway. |

## 6. Testing

Extend `tests/integration/user-node-auth.test.ts` with 3 new cases (inside the existing u-login describe block):

1. **`u-login failure logs an attempt as 'failed'`** — send wrong password, assert 401, then `SELECT outcome FROM login_attempts WHERE email = <test> ORDER BY id DESC LIMIT 1` returns `'failed'`.
2. **`u-login success logs an attempt as 'success'`** — happy path, then the latest `login_attempts` row for that email is `'success'`.
3. **`u-login returns 429 after 10 failed attempts in 5 minutes`** — seed 10 `outcome='failed'` rows via direct INSERT against the test email; next u-login request returns 429 with body code `too_many_attempts`. Cleanup deletes the seeded rows in `afterEach`.

Tests should use a unique email per test (e.g., `rate-limit-${Date.now()}@example.com`) to avoid polluting the shared `login_attempts` table across parallel test runs.

Test count: 233 → 236 (+3).

## 7. Migration / backwards-compat

- **No DB migration.** `login_attempts` table exists from migration 007.
- **No new endpoints.** Same `/api/u-login` URL, same success response shape.
- **New failure status code** (429) is a documented HTTP status; existing UI error handlers that fall through to a generic "login failed" branch will render *some* message.

## 8. Out of scope (v1)

- Per-client rate-limit scoping.
- Separate thresholds for bucket-user vs admin.
- Account lockout UI / unlock flow.
- CAPTCHA.
- Rate-limiting forgot-password / u-change-password / link-google.
- Telemetry/alerting on suspicious patterns.
- Logging the rate-limit hit to `audit_log` (could be added; deferred since `login_attempts` already records the underlying data).

## 9. Suggested next steps

1. User reviews this spec.
2. `superpowers:writing-plans` → 2-task plan (instrumentation + tests; UI tweak if needed).
3. `superpowers:subagent-driven-development` to execute.
