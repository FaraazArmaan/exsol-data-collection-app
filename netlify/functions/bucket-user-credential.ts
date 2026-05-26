// Admin-facing endpoint for managing a bucket-user's login credential.
//
//   GET    ?client=&role=&user=  → { has_credential, must_change_password,
//                                    last_login_at, temp_password_plain?,
//                                    temp_password_views_left? }
//     The GET counts as a "reveal" — if temp_password_plain is non-null AND
//     views_left > 0, returns the plaintext and decrements views_left. When
//     views_left reaches 0, plaintext is wiped on the same update.
//
//   POST   ?client=&role=&user=  body: { temp_password }
//     Resets credential: replaces password_hash, sets must_change_password=true,
//     stores new plaintext, resets views_left=3. Used both to issue first
//     credentials AND to reset later. Creates row if absent.
//
//   DELETE ?client=&role=&user=  → removes the credential (bucket-user row stays).

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { hashPassword } from './_shared/argon';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { TEMPLATES } from './_shared/templates';
import { isValidIdentifier, isValidSchemaName, assertUuid } from './_shared/identifier';

const ResetBody = z.object({ temp_password: z.string().min(8).max(200) });

interface CredentialFullRow {
  id: string;
  email: string;
  must_change_password: boolean;
  temp_password_plain: string | null;
  temp_password_views_left: number | null;
  last_login_at: string | null;
}

export default async (req: Request, _ctx: Context) => {
  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client');
  const roleKey = url.searchParams.get('role');
  const userId = url.searchParams.get('user');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  if (!roleKey || !isValidIdentifier(roleKey)) return jsonError(400, 'validation_failed', 'role required');
  if (!userId) return jsonError(400, 'validation_failed', 'user required');
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }
  try { assertUuid(userId, 'user'); } catch { return jsonError(400, 'validation_failed', 'user must be uuid'); }

  const sql = db();
  const clientRows = (await sql`
    SELECT id, schema_name, template_key FROM public.clients
    WHERE id = ${clientId}::uuid LIMIT 1
  `) as { id: string; schema_name: string; template_key: string }[];
  const client = clientRows[0];
  if (!client) return jsonError(404, 'client_not_found');
  if (!isValidSchemaName(client.schema_name)) return jsonError(500, 'bad_schema_name');
  const template = TEMPLATES[client.template_key];
  if (!template) return jsonError(500, 'template_missing');
  if (!template.roles.find((r) => r.key === roleKey)) return jsonError(404, 'role_not_found');

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT id, email, must_change_password, temp_password_plain,
             temp_password_views_left, last_login_at
      FROM public.bucket_user_credentials
      WHERE client_id = ${clientId}::uuid AND role_key = ${roleKey} AND bucket_user_id = ${userId}::uuid
      LIMIT 1
    `) as CredentialFullRow[];
    const cred = rows[0];
    if (!cred) return jsonOk({ has_credential: false });

    let plain = cred.temp_password_plain;
    let viewsLeft = cred.temp_password_views_left;

    if (plain && typeof viewsLeft === 'number' && viewsLeft > 0) {
      const newViews = viewsLeft - 1;
      if (newViews <= 0) {
        await sql`
          UPDATE public.bucket_user_credentials
          SET temp_password_plain = NULL, temp_password_views_left = NULL
          WHERE id = ${cred.id}
        `;
        viewsLeft = 0;
      } else {
        await sql`
          UPDATE public.bucket_user_credentials
          SET temp_password_views_left = ${newViews}
          WHERE id = ${cred.id}
        `;
        viewsLeft = newViews;
      }
    } else {
      plain = null;
    }

    return jsonOk({
      has_credential: true,
      email: cred.email,
      must_change_password: cred.must_change_password,
      last_login_at: cred.last_login_at,
      temp_password_plain: plain,
      temp_password_views_left: viewsLeft,
    });
  }

  if (req.method === 'POST') {
    const parsed = ResetBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

    // Look up the bucket-user row's email so we can populate the credential
    // even if it doesn't exist yet (first-time create after the bucket user
    // was created without create_login).
    const bucketSchema = client.schema_name;
    const bucketRows = (await sql(
      `SELECT email FROM "${bucketSchema}"."${roleKey}" WHERE id = $1 LIMIT 1`,
      [userId],
    )) as unknown as { email: string | null }[];
    const bucketUser = bucketRows[0];
    if (!bucketUser) return jsonError(404, 'bucket_user_not_found');
    if (!bucketUser.email) return jsonError(400, 'bucket_user_email_missing');

    const pwdHash = await hashPassword(parsed.data.temp_password);

    try {
      await sql`
        INSERT INTO public.bucket_user_credentials (
          client_id, role_key, bucket_user_id, email,
          password_hash, must_change_password,
          temp_password_plain, temp_password_views_left,
          created_by_admin
        ) VALUES (
          ${clientId}::uuid, ${roleKey}, ${userId}::uuid, ${bucketUser.email},
          ${pwdHash}, true,
          ${parsed.data.temp_password}, 3,
          ${actor.admin.id}::uuid
        )
        ON CONFLICT (client_id, role_key, bucket_user_id) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            must_change_password = true,
            temp_password_plain = EXCLUDED.temp_password_plain,
            temp_password_views_left = 3,
            email = EXCLUDED.email
      `;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === '23505') return jsonError(409, 'email_already_has_login_in_this_client');
      throw e;
    }
    return jsonOk({ ok: true });
  }

  if (req.method === 'DELETE') {
    await sql`
      DELETE FROM public.bucket_user_credentials
      WHERE client_id = ${clientId}::uuid AND role_key = ${roleKey} AND bucket_user_id = ${userId}::uuid
    `;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
