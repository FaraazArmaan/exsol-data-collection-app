import { isIP } from 'node:net';
import { neon } from '@neondatabase/serverless';

const WINDOW_SECONDS = 5 * 60;
const EMAIL_THRESHOLD = 10;
const IP_THRESHOLD = 20;

type SQL = ReturnType<typeof neon>;

export interface RateLimitInput {
  email: string;
  ip: string | null;
}

export type RateLimitReason = 'email_throttled' | 'ip_throttled';

export interface RateLimitDecision {
  allowed: boolean;
  reason?: RateLimitReason;
  retryAfterSec?: number;
}

/**
 * Check whether a login attempt for (email, ip) should be allowed.
 * Counts failed attempts inside the last WINDOW_SECONDS. Blocks if
 * either dimension exceeds its threshold.
 *
 * Accepted slop: there is a small read-then-write race between this
 * function and logAttempt (concurrent requests can both pass the check
 * before either records its failure). With argon2's ~100 ms verify cost
 * the attacker's max win is a handful of extra attempts per burst, far
 * below the brute-force economy. Closing the race would require
 * SERIALIZABLE isolation or row-level locking — not worth the cost.
 */
export async function checkRateLimit(sql: SQL, input: RateLimitInput): Promise<RateLimitDecision> {
  const rows = (await sql`
    SELECT
      count(*) FILTER (WHERE email = ${input.email})::int AS email_count,
      count(*) FILTER (WHERE ip = ${input.ip ?? null}::inet)::int AS ip_count
    FROM public.login_attempts
    WHERE attempted_at > now() - (${WINDOW_SECONDS} || ' seconds')::interval
      AND outcome = 'failed'
  `) as { email_count: number; ip_count: number }[];
  const row = rows[0]!;
  if (row.email_count >= EMAIL_THRESHOLD) {
    return { allowed: false, reason: 'email_throttled', retryAfterSec: WINDOW_SECONDS };
  }
  if (input.ip && row.ip_count >= IP_THRESHOLD) {
    return { allowed: false, reason: 'ip_throttled', retryAfterSec: WINDOW_SECONDS };
  }
  return { allowed: true };
}

/**
 * Record the outcome of a login attempt and occasionally garbage-collect
 * old rows (lazy cleanup: 1% of inserts trigger a DELETE of rows older than 24h).
 */
export async function logAttempt(sql: SQL, input: RateLimitInput & { outcome: 'failed' | 'success' }) {
  await sql`
    INSERT INTO public.login_attempts (email, ip, outcome)
    VALUES (${input.email}, ${input.ip ?? null}::inet, ${input.outcome})
  `;
  if (Math.random() < 0.01) {
    await sql`DELETE FROM public.login_attempts WHERE attempted_at < now() - interval '24 hours'`;
  }
}

/**
 * Extract the client IP from Netlify-set headers. Falls back through
 * x-nf-client-connection-ip → x-forwarded-for (first value).
 * Returns null if no header is present OR if the value is not a valid
 * IPv4/IPv6 address — anything else would crash the `::inet` cast in
 * checkRateLimit/logAttempt and produce a 500 (trivial DoS vector via
 * header injection).
 */
export function extractIp(req: Request): string | null {
  const nf = req.headers.get('x-nf-client-connection-ip');
  if (nf) {
    const trimmed = nf.trim();
    return isIP(trimmed) ? trimmed : null;
  }
  const xff = req.headers.get('x-forwarded-for');
  if (!xff) return null;
  const first = xff.split(',')[0]?.trim();
  return first && isIP(first) ? first : null;
}
