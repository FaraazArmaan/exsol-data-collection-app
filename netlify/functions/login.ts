// POST /api/login
//   Body: { email, password, client?: <slug> }
//
// Tries admin auth first (admin always wins). Falls through to bucket-user
// credential lookup. Returns one of:
//   - { kind: 'admin', admin: {...} }     + Set-Cookie: session=<admin JWT>
//   - { kind: 'bucket_user', user, client } + Set-Cookie: bu_session=<JWT>
//   - { kind: 'choice', clients: [...] }    (no cookie; UI shows picker)
//
// Disambiguation: pass `client: <slug>` in body to narrow a multi-match.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyPassword } from './_shared/argon';
import {
  mintSession, cookieHeader,
  mintBucketUserSession, buCookieHeader,
} from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { checkRateLimit, logAttempt, extractIp } from './_shared/rate-limit';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  client: z.string().min(1).max(80).optional(),
});

interface AdminRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  is_bootstrap: boolean;
}

interface BUCredRow {
  id: string;
  client_id: string;
  user_node_id: string;
  email: string;
  password_hash: string;
  must_change_password: boolean;
}

interface ClientRow {
  id: string;
  slug: string;
  name: string;
}

const MAX_CREDS_TO_VERIFY = 5;  // safety cap on argon2 verifies per request

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const ip = extractIp(req);
  const sql = db();
  const limit = await checkRateLimit(sql, { email: parsed.data.email, ip });
  if (!limit.allowed) {
    return jsonError(429, 'too_many_attempts',
      { reason: limit.reason },
      { 'Retry-After': String(limit.retryAfterSec ?? 300) });
  }

  // Step 1: admin precedence.
  const adminRows = (await sql`
    SELECT id, email, password_hash, display_name, is_bootstrap
    FROM public.admins WHERE email = ${parsed.data.email} LIMIT 1
  `) as AdminRow[];
  if (adminRows.length > 0) {
    const admin = adminRows[0]!;
    const ok = await verifyPassword(parsed.data.password, admin.password_hash);
    if (!ok) {
      await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
      return jsonError(401, 'unauthorized');
    }
    await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'success' });
    const token = await mintSession({ sub: admin.id, email: admin.email });
    return jsonOk(
      { kind: 'admin', admin: { id: admin.id, email: admin.email, display_name: admin.display_name, is_bootstrap: admin.is_bootstrap } },
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
      SELECT id, client_id, user_node_id, email, password_hash, must_change_password
      FROM public.user_node_credentials
      WHERE email = ${parsed.data.email} AND client_id = ${c[0]!.id}::uuid
      LIMIT 1
    `) as BUCredRow[];
    clientRowsForChoice = c;
  } else {
    // Open lookup across ALL clients for this email.
    credRows = (await sql`
      SELECT id, client_id, user_node_id, email, password_hash, must_change_password
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
    });
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
