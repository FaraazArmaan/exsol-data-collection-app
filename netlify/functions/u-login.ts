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

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface CredentialRow {
  id: string;
  client_id: string;
  role_key: string;
  bucket_user_id: string;
  email: string;
  password_hash: string;
  must_change_password: boolean;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const slug = new URL(req.url).searchParams.get('client');
  if (!slug) return jsonError(400, 'validation_failed', 'client query param required');

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();
  const clientRows = (await sql`
    SELECT id, name FROM public.clients WHERE slug = ${slug} LIMIT 1
  `) as { id: string; name: string }[];
  const client = clientRows[0];
  if (!client) return jsonError(404, 'client_not_found');

  const credRows = (await sql`
    SELECT id, client_id, role_key, bucket_user_id, email, password_hash, must_change_password
    FROM public.bucket_user_credentials
    WHERE client_id = ${client.id} AND email = ${parsed.data.email}
    LIMIT 1
  `) as CredentialRow[];
  const credential = credRows[0];

  const ok = await verifyPassword(parsed.data.password, credential?.password_hash ?? null);
  if (!ok || !credential) return jsonError(401, 'unauthorized');

  await sql`
    UPDATE public.bucket_user_credentials
    SET last_login_at = now()
    WHERE id = ${credential.id}
  `;

  // Pull the bucket user row for display_name. The schema name is derived
  // from the client; rather than re-querying that, we accept the small cost
  // of returning what the UI already has from /api/u-me on next refresh.
  // For the login response we only need the minimal user shape.

  const token = await mintBucketUserSession({
    sub: credential.bucket_user_id,
    email: credential.email,
    client_id: client.id,
    role_key: credential.role_key,
  });

  return jsonOk(
    {
      user: {
        id: credential.bucket_user_id,
        email: credential.email,
        role_key: credential.role_key,
        must_change_password: credential.must_change_password,
      },
      client: { id: client.id, slug, name: client.name },
    },
    { headers: { 'Set-Cookie': buCookieHeader(token) } },
  );
};
