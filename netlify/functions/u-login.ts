// POST /api/u-login?client=<slug>  body: { email, password }
//
// Verifies bucket-user credentials and sets the bu_session cookie. Constant-
// timing semantics inherited from verifyPassword(plain, null): when the
// credential row doesn't exist we still run an argon2 verify against a
// dummy hash so latency doesn't leak account existence per client.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyPassword } from './_shared/argon';
import { mintBucketUserSession, buCookieHeader } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { checkRateLimit, logAttempt, extractIp } from './_shared/rate-limit';
import { rejectCrossSiteMutation } from './_shared/csrf';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface CredentialRow {
  id: string;
  client_id: string;
  user_node_id: string;
  email: string;
  password_hash: string;
  must_change_password: boolean;
  disabled_at: string | null;
  locked_until: string | null;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  const slug = new URL(req.url).searchParams.get('client');
  if (!slug) return jsonError(400, 'validation_failed', 'client query param required');

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const ip = extractIp(req);
  const sql = db();
  const limit = await checkRateLimit(sql, { email: parsed.data.email, ip });
  if (!limit.allowed) {
    return jsonError(429, 'too_many_attempts', { retry_after_sec: limit.retryAfterSec });
  }

  const clientRows = (await sql`
    SELECT id, name, timezone FROM public.clients WHERE slug = ${slug} LIMIT 1
  `) as { id: string; name: string; timezone: string }[];
  const client = clientRows[0];
  if (!client) {
    await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
    return jsonError(404, 'client_not_found');
  }

  const credRows = (await sql`
    SELECT id, client_id, user_node_id, email, password_hash, must_change_password, disabled_at, locked_until
    FROM public.user_node_credentials
    WHERE client_id = ${client.id}::uuid AND email = ${parsed.data.email}
    LIMIT 1
  `) as CredentialRow[];
  const credential = credRows[0];

  const ok = await verifyPassword(parsed.data.password, credential?.password_hash ?? null);
  if (!ok || !credential) {
    if (credential) await sql`UPDATE public.user_node_credentials SET last_failed_login_at = now() WHERE id = ${credential.id}::uuid`;
    await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
    return jsonError(401, 'unauthorized');
  }
  if (credential.disabled_at || (credential.locked_until && new Date(credential.locked_until).getTime() > Date.now())) {
    await sql`UPDATE public.user_node_credentials SET last_failed_login_at = now() WHERE id = ${credential.id}::uuid`;
    await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'failed' });
    return jsonError(401, 'unauthorized');
  }

  await sql`UPDATE public.user_node_credentials SET last_login_at = now() WHERE id = ${credential.id}`;
  await logAttempt(sql, { email: parsed.data.email, ip, outcome: 'success' });

  const token = await mintBucketUserSession({
    sub: credential.user_node_id,
    email: credential.email,
    client_id: client.id,
  }, { ip, userAgent: req.headers.get('user-agent') });

  return jsonOk(
    {
      user: {
        id: credential.user_node_id,
        email: credential.email,
        must_change_password: credential.must_change_password,
      },
      client: { id: client.id, slug, name: client.name, timezone: client.timezone },
    },
    { headers: { 'Set-Cookie': buCookieHeader(token) } },
  );
};
