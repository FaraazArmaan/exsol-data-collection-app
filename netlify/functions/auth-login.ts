import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyPassword } from './_shared/argon';
import { mintSession, cookieHeader } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { checkRateLimit, logAttempt, extractIp } from './_shared/rate-limit';
import { rejectCrossSiteMutation } from './_shared/csrf';
import { adminMfaEnabled, createAdminMfaChallenge } from './_shared/mfa';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface AdminRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  is_bootstrap: boolean;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const ip = extractIp(req);
  const sql = db();
  const limit = await checkRateLimit(sql, { email: parsed.data.email, ip });
  if (!limit.allowed) {
    return jsonError(
      429,
      'too_many_attempts',
      { reason: limit.reason },
      { 'Retry-After': String(limit.retryAfterSec ?? 300) },
    );
  }

  const rows = (await sql`
    SELECT id, email, password_hash, display_name, is_bootstrap
    FROM public.admins
    WHERE email = ${parsed.data.email}
    LIMIT 1
  `) as AdminRow[];
  const admin = rows[0];

  // verifyPassword equalizes timing on all failure paths: when admin
  // doesn't exist or has no password_hash (Google-only), it runs a
  // verify against a precomputed dummy hash so the response latency
  // doesn't leak whether the email has a password account. Prevents
  // account enumeration.
  const ok = await verifyPassword(parsed.data.password, admin?.password_hash ?? null);
  if (!ok || !admin) {
    await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
    return jsonError(401, 'unauthorized');
  }

  await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'success' });
  const adminBody = { id: admin.id, email: admin.email, display_name: admin.display_name, is_bootstrap: admin.is_bootstrap };
  if (await adminMfaEnabled(sql, admin.id)) {
    const challengeId = await createAdminMfaChallenge(sql, {
      adminId: admin.id,
      ip,
      userAgent: req.headers.get('user-agent'),
    });
    return jsonOk({ mfa_required: true, challenge_id: challengeId, admin: adminBody });
  }
  const token = await mintSession(
    { sub: admin.id, email: admin.email },
    { ip, userAgent: req.headers.get('user-agent') },
  );
  return jsonOk(
    { admin: adminBody },
    { headers: { 'Set-Cookie': cookieHeader(token) } },
  );
};
