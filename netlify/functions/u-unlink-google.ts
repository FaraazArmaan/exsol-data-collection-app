// POST /api/u-unlink-google
//   Auth: bu_session cookie required
//
// Clears the google_sub binding from the authenticated bucket user's
// credential. Refuses if the credential has no password_hash (i.e. the user's
// only way to sign in is Google) — unlinking would lock them out.

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { rejectCrossSiteMutation } from './_shared/csrf';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  let actor;
  try { actor = await requireBucketUser(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const sql = db();
  const rows = (await sql`
    SELECT (password_hash IS NOT NULL) AS has_password, (google_sub IS NOT NULL) AS has_google
    FROM public.user_node_credentials WHERE id = ${actor.credential.id}
  `) as { has_password: boolean; has_google: boolean }[];
  const row = rows[0];
  if (!row || !row.has_google) return jsonOk({ ok: true, already_unlinked: true });
  if (!row.has_password) return jsonError(409, 'cannot_unlink_only_credential');

  await sql`
    UPDATE public.user_node_credentials
       SET google_sub = NULL
     WHERE id = ${actor.credential.id}
  `;
  return jsonOk({ ok: true });
};
