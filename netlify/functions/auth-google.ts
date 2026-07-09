import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyGoogleIdToken } from './_shared/google-verifier';
import { mintSession, cookieHeader } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { checkRateLimit, logAttempt, extractIp } from './_shared/rate-limit';
import { rejectCrossSiteMutation } from './_shared/csrf';

const Body = z.object({ idToken: z.string().min(10) });

interface AdminRow {
  id: string;
  email: string;
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

  // IP-only rate-limit BEFORE the Google RPC. Email isn't known yet,
  // so we can only defend against per-IP token-spam (which would
  // otherwise cost a Google roundtrip per request and pressure our
  // OAuth client quota).
  const ipCheck = await checkRateLimit(sql, { email: null, ip });
  if (!ipCheck.allowed) {
    return jsonError(
      429,
      'too_many_attempts',
      { reason: ipCheck.reason },
      { 'Retry-After': String(ipCheck.retryAfterSec ?? 300) },
    );
  }

  let profile;
  try {
    profile = await verifyGoogleIdToken(parsed.data.idToken);
  } catch {
    return jsonError(401, 'unauthorized');
  }
  if (!profile.emailVerified) return jsonError(401, 'unauthorized');

  // Full rate-limit now that we have the verified email.
  const fullCheck = await checkRateLimit(sql, { email: profile.email, ip });
  if (!fullCheck.allowed) {
    return jsonError(
      429,
      'too_many_attempts',
      { reason: fullCheck.reason },
      { 'Retry-After': String(fullCheck.retryAfterSec ?? 300) },
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

  // First-bind only: never overwrite an existing google_sub. If a
  // different Google account ever needs to be bound (e.g., admin
  // changed Google accounts), that must go through an admin tool
  // that explicitly clears the binding first.
  // (updated_at is set automatically by admins_set_updated_at trigger.)
  await sql`
    UPDATE public.admins
       SET google_sub = ${profile.sub}
     WHERE id = ${admin.id} AND google_sub IS NULL
  `;

  await logAttempt(sql, { email: profile.email, ip, outcome: 'success' });
  const token = await mintSession({ sub: admin.id, email: admin.email });
  return jsonOk(
    { admin },
    { headers: { 'Set-Cookie': cookieHeader(token) } },
  );
};
