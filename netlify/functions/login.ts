// POST /api/login
//   Body (password flow):  { email, password, client?: <slug> }
//   Body (Google flow):    { idToken, client?: <slug> }
//
// Tries admin auth first (admin always wins). Falls through to bucket-user
// credential lookup. Returns one of:
//   - { kind: 'admin', admin: {...} }     + Set-Cookie: session=<admin JWT>
//   - { kind: 'bucket_user', user, client } + Set-Cookie: bu_session=<JWT>
//   - { kind: 'choice', clients: [...] }    (no cookie; UI shows picker)
//
// Disambiguation: pass `client: <slug>` in body to narrow a multi-match.
//
// Strict bind on the Google flow: never auto-provisions. The admin/email
// must already exist with matching `email` OR `google_sub`. First-bind
// only — never overwrites a different existing `google_sub` value.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyPassword } from './_shared/argon';
import { verifyGoogleIdToken } from './_shared/google-verifier';
import {
  mintSession, cookieHeader,
  mintBucketUserSession, buCookieHeader,
} from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { checkRateLimit, logAttempt, extractIp } from './_shared/rate-limit';
import { rejectCrossSiteMutation } from './_shared/csrf';
import { adminMfaEnabled, createAdminMfaChallenge } from './_shared/mfa';

// Body is one of two shapes — password OR Google ID token. Zod union.
const PasswordBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  client: z.string().min(1).max(80).optional(),
});
const GoogleBody = z.object({
  idToken: z.string().min(10),
  client: z.string().min(1).max(80).optional(),
});
const Body = z.union([PasswordBody, GoogleBody]);
const isGoogleBody = (b: z.infer<typeof Body>): b is z.infer<typeof GoogleBody> =>
  'idToken' in b;

interface AdminRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  is_bootstrap: boolean;
  disabled_at: string | null;
  locked_until: string | null;
}

interface BUCredRow {
  id: string;
  client_id: string;
  user_node_id: string;
  email: string;
  password_hash: string;
  must_change_password: boolean;
  disabled_at: string | null;
  locked_until: string | null;
}

interface ClientRow {
  id: string;
  slug: string;
  name: string;
}

const MAX_CREDS_TO_VERIFY = 5;  // safety cap on argon2 verifies per request

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const ip = extractIp(req);
  const sql = db();

  // Google flow: branch off here. Different rate-limit handling (IP-first
  // because email isn't known until we verify the token).
  if (isGoogleBody(parsed.data)) {
    return await handleGoogleLogin(sql, ip, req.headers.get('user-agent'), parsed.data);
  }

  const limit = await checkRateLimit(sql, { email: parsed.data.email, ip });
  if (!limit.allowed) {
    return jsonError(429, 'too_many_attempts',
      { reason: limit.reason },
      { 'Retry-After': String(limit.retryAfterSec ?? 300) });
  }

  // Step 1: admin precedence.
  const adminRows = (await sql`
    SELECT id, email, password_hash, display_name, is_bootstrap, disabled_at, locked_until
    FROM public.admins WHERE email = ${parsed.data.email} LIMIT 1
  `) as AdminRow[];
  if (adminRows.length > 0) {
    const admin = adminRows[0]!;
    const ok = await verifyPassword(parsed.data.password, admin.password_hash);
    if (!ok) {
      await sql`UPDATE public.admins SET last_failed_login_at = now() WHERE id = ${admin.id}::uuid`;
      await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
      return jsonError(401, 'unauthorized');
    }
    if (admin.disabled_at || (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now())) {
      await sql`UPDATE public.admins SET last_failed_login_at = now() WHERE id = ${admin.id}::uuid`;
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
      return jsonOk({ kind: 'mfa_required', challenge_id: challengeId, admin: adminBody });
    }
    const token = await mintSession(
      { sub: admin.id, email: admin.email },
      { ip, userAgent: req.headers.get('user-agent') },
    );
    return jsonOk(
      { kind: 'admin', admin: adminBody },
      { headers: { 'Set-Cookie': cookieHeader(token) } },
    );
  }

  // Step 2: bucket-user credentials. Optionally narrowed by `client` slug.
  let credRows: BUCredRow[];
  let clientRowsForChoice: ClientRow[] = [];

  if (parsed.data.client) {
    // Disambiguation call — narrow to the picked client.
    const c = (await sql`SELECT id, slug, name FROM public.clients WHERE slug = ${parsed.data.client} LIMIT 1`) as ClientRow[];
    if (c.length === 0) {
      // Equalize timing then 401.
      await verifyPassword(parsed.data.password, null);
      await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
      return jsonError(401, 'unauthorized');
    }
    credRows = (await sql`
      SELECT id, client_id, user_node_id, email, password_hash, must_change_password,
             disabled_at, locked_until
      FROM public.user_node_credentials
      WHERE email = ${parsed.data.email} AND client_id = ${c[0]!.id}::uuid
      LIMIT 1
    `) as BUCredRow[];
    clientRowsForChoice = c;
  } else {
    // Open lookup across ALL clients for this email.
    credRows = (await sql`
      SELECT id, client_id, user_node_id, email, password_hash, must_change_password,
             disabled_at, locked_until
      FROM public.user_node_credentials
      WHERE email = ${parsed.data.email}
      ORDER BY created_at
      LIMIT ${MAX_CREDS_TO_VERIFY}
    `) as BUCredRow[];
  }

  if (credRows.length === 0) {
    // Equalize timing then 401.
    await verifyPassword(parsed.data.password, null);
    await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
    return jsonError(401, 'unauthorized');
  }

  // Verify password against each candidate credential.
  const verified: BUCredRow[] = [];
  for (const cred of credRows) {
    if (await verifyPassword(parsed.data.password, cred.password_hash)) {
      if (cred.disabled_at || (cred.locked_until && new Date(cred.locked_until).getTime() > Date.now())) {
        await sql`UPDATE public.user_node_credentials SET last_failed_login_at = now() WHERE id = ${cred.id}::uuid`;
        await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
        return jsonError(401, 'unauthorized');
      }
      verified.push(cred);
    }
  }

  if (verified.length === 0) {
    await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
    return jsonError(401, 'unauthorized');
  }

  await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'success' });

  if (verified.length === 1) {
    const cred = verified[0]!;
    const c = clientRowsForChoice.length > 0
      ? clientRowsForChoice[0]!
      : ((await sql`SELECT id, slug, name FROM public.clients WHERE id = ${cred.client_id}::uuid LIMIT 1`) as ClientRow[])[0]!;
    await sql`UPDATE public.user_node_credentials SET last_login_at = now() WHERE id = ${cred.id}`;
    const token = await mintBucketUserSession({
      sub: cred.user_node_id, email: cred.email, client_id: cred.client_id,
    }, { ip, userAgent: req.headers.get('user-agent') });
    return jsonOk(
      {
        kind: 'bucket_user',
        user: { id: cred.user_node_id, email: cred.email, must_change_password: cred.must_change_password },
        client: { id: c.id, slug: c.slug, name: c.name },
      },
      { headers: { 'Set-Cookie': buCookieHeader(token) } },
    );
  }

  // Multi-match → return choice. No cookie set.
  const clientIds = verified.map((v) => v.client_id);
  const clients = (await sql`
    SELECT id, slug, name FROM public.clients WHERE id = ANY(${clientIds}::uuid[])
    ORDER BY name
  `) as ClientRow[];
  return jsonOk({ kind: 'choice', clients });
};

// ─── Google flow ────────────────────────────────────────────────────
//
// Verifies the Google ID token, then:
//   1. Admin precedence: if an admin row matches the verified email OR has
//      a matching google_sub → mint admin session (first-bind google_sub).
//   2. Else: look up user_node_credentials by google_sub OR email. Single
//      match → mint bu_session (first-bind google_sub). Multi-match →
//      return kind:'choice'. The disambiguation re-POST passes
//      { idToken, client: <slug> } which narrows to that client.
//   3. No match → 401.
//
// Strict bind, no auto-provisioning. Admins / bucket-users must already
// exist with an email or google_sub the verifier can match.

async function handleGoogleLogin(
  sql: ReturnType<typeof db>,
  ip: string | null,
  userAgent: string | null,
  body: z.infer<typeof GoogleBody>,
): Promise<Response> {
  // IP-only rate-limit BEFORE the Google RPC (same defense as auth-google.ts).
  const ipCheck = await checkRateLimit(sql, { email: null, ip });
  if (!ipCheck.allowed) {
    return jsonError(429, 'too_many_attempts',
      { reason: ipCheck.reason },
      { 'Retry-After': String(ipCheck.retryAfterSec ?? 300) });
  }

  let profile;
  try {
    profile = await verifyGoogleIdToken(body.idToken);
  } catch {
    return jsonError(401, 'unauthorized');
  }
  if (!profile.emailVerified) return jsonError(401, 'unauthorized');

  // Full rate-limit with the verified email.
  const fullCheck = await checkRateLimit(sql, { email: profile.email, ip });
  if (!fullCheck.allowed) {
    return jsonError(429, 'too_many_attempts',
      { reason: fullCheck.reason },
      { 'Retry-After': String(fullCheck.retryAfterSec ?? 300) });
  }

  // Step 1: admin precedence (admin always wins).
  const adminRows = (await sql`
    SELECT id, email, display_name, is_bootstrap, disabled_at, locked_until
    FROM public.admins
    WHERE email = ${profile.email} OR google_sub = ${profile.sub}
    LIMIT 1
  `) as Array<Omit<AdminRow, 'password_hash'>>;
  if (adminRows.length > 0) {
    const admin = adminRows[0]!;
    if (admin.disabled_at || (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now())) {
      await sql`UPDATE public.admins SET last_failed_login_at = now() WHERE id = ${admin.id}::uuid`;
      await logAttempt(sql, { email: profile.email, ip, outcome: 'failed' });
      return jsonError(401, 'unauthorized');
    }
    // First-bind only: never overwrite an existing google_sub.
    await sql`
      UPDATE public.admins
         SET google_sub = ${profile.sub}
       WHERE id = ${admin.id} AND google_sub IS NULL
    `;
    await logAttempt(sql, { email: profile.email, ip, outcome: 'success' });
    if (await adminMfaEnabled(sql, admin.id)) {
      const challengeId = await createAdminMfaChallenge(sql, {
        adminId: admin.id,
        ip,
        userAgent,
      });
      return jsonOk({ kind: 'mfa_required', challenge_id: challengeId, admin });
    }
    const token = await mintSession(
      { sub: admin.id, email: admin.email },
      { ip, userAgent },
    );
    return jsonOk(
      { kind: 'admin', admin },
      { headers: { 'Set-Cookie': cookieHeader(token) } },
    );
  }

  // Step 2: bucket-user credentials. Optionally narrowed by `client` slug.
  let credRows: Array<BUCredRow & { google_sub: string | null }>;
  let scopedClient: ClientRow | null = null;

  if (body.client) {
    const c = (await sql`
      SELECT id, slug, name FROM public.clients WHERE slug = ${body.client} LIMIT 1
    `) as ClientRow[];
    if (c.length === 0) {
      await logAttempt(sql, { email: profile.email, ip, outcome: 'failed' });
      return jsonError(401, 'unauthorized');
    }
    scopedClient = c[0]!;
    credRows = (await sql`
      SELECT id, client_id, user_node_id, email, password_hash,
             must_change_password, disabled_at, locked_until, google_sub
      FROM public.user_node_credentials
      WHERE client_id = ${scopedClient.id}::uuid
        AND (google_sub = ${profile.sub} OR email = ${profile.email})
      LIMIT ${MAX_CREDS_TO_VERIFY}
    `) as Array<BUCredRow & { google_sub: string | null }>;
  } else {
    credRows = (await sql`
      SELECT id, client_id, user_node_id, email, password_hash,
             must_change_password, disabled_at, locked_until, google_sub
      FROM public.user_node_credentials
      WHERE google_sub = ${profile.sub} OR email = ${profile.email}
      ORDER BY created_at
      LIMIT ${MAX_CREDS_TO_VERIFY}
    `) as Array<BUCredRow & { google_sub: string | null }>;
  }

  if (credRows.length === 0) {
    await logAttempt(sql, { email: profile.email, ip, outcome: 'failed' });
    return jsonError(401, 'unauthorized');
  }
  const blockedCred = credRows.find((cred) =>
    cred.disabled_at || (cred.locked_until && new Date(cred.locked_until).getTime() > Date.now()));
  if (blockedCred) {
    await sql`UPDATE public.user_node_credentials SET last_failed_login_at = now() WHERE id = ${blockedCred.id}::uuid`;
    await logAttempt(sql, { email: profile.email, ip, outcome: 'failed' });
    return jsonError(401, 'unauthorized');
  }

  await logAttempt(sql, { email: profile.email, ip, outcome: 'success' });

  if (credRows.length === 1) {
    const cred = credRows[0]!;
    // First-bind only: never overwrite an existing google_sub.
    await sql`
      UPDATE public.user_node_credentials
         SET google_sub = ${profile.sub},
             last_login_at = now()
       WHERE id = ${cred.id} AND (google_sub IS NULL OR google_sub = ${profile.sub})
    `;
    const c = scopedClient ?? ((await sql`
      SELECT id, slug, name FROM public.clients WHERE id = ${cred.client_id}::uuid LIMIT 1
    `) as ClientRow[])[0]!;
    const token = await mintBucketUserSession({
      sub: cred.user_node_id, email: cred.email, client_id: cred.client_id,
    }, { ip, userAgent: null });
    return jsonOk(
      {
        kind: 'bucket_user',
        user: {
          id: cred.user_node_id,
          email: cred.email,
          must_change_password: cred.must_change_password,
        },
        client: { id: c.id, slug: c.slug, name: c.name },
      },
      { headers: { 'Set-Cookie': buCookieHeader(token) } },
    );
  }

  // Multi-match → return choice; UI re-POSTs with client slug to disambiguate.
  const clientIds = credRows.map((c) => c.client_id);
  const clients = (await sql`
    SELECT id, slug, name FROM public.clients WHERE id = ANY(${clientIds}::uuid[])
    ORDER BY name
  `) as ClientRow[];
  return jsonOk({ kind: 'choice', clients });
}
