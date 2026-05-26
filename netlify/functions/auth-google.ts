import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyGoogleIdToken } from './_shared/google-verifier';
import { mintSession, cookieHeader } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { checkRateLimit, logAttempt, extractIp } from './_shared/rate-limit';

const Body = z.object({ idToken: z.string().min(10) });

interface AdminRow {
  id: string;
  email: string;
  display_name: string;
  is_bootstrap: boolean;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  let profile;
  try {
    profile = await verifyGoogleIdToken(parsed.data.idToken);
  } catch {
    return jsonError(401, 'unauthorized');
  }
  if (!profile.emailVerified) return jsonError(401, 'unauthorized');

  const ip = extractIp(req);
  const sql = db();

  // Check rate limit using the verified Google email and IP.
  const limit = await checkRateLimit(sql, { email: profile.email, ip });
  if (!limit.allowed) {
    return jsonError(
      429,
      'too_many_attempts',
      { reason: limit.reason },
      { 'Retry-After': String(limit.retryAfterSec ?? 300) },
    );
  }

  // Strict bind: only existing admins (by email OR google_sub) may sign in via Google.
  // No auto-provisioning. (Matches v1.1 strict-binding behaviour from c41247f.)
  const rows = (await sql`
    SELECT id, email, display_name, is_bootstrap
    FROM public.admins
    WHERE email = ${profile.email} OR google_sub = ${profile.sub}
    LIMIT 1
  `) as AdminRow[];
  const admin = rows[0];
  if (!admin) {
    await logAttempt(sql, { email: profile.email, ip, outcome: 'failed' });
    return jsonError(401, 'unauthorized');
  }

  // Bind google_sub on first successful sign-in if missing.
  await sql`
    UPDATE public.admins
       SET google_sub = ${profile.sub}, updated_at = now()
     WHERE id = ${admin.id} AND google_sub IS DISTINCT FROM ${profile.sub}
  `;

  await logAttempt(sql, { email: profile.email, ip, outcome: 'success' });
  const token = await mintSession({ sub: admin.id, email: admin.email });
  return jsonOk(
    { admin },
    { headers: { 'Set-Cookie': cookieHeader(token) } },
  );
};
