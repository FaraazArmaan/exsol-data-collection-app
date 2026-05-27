// POST /api/u-change-password  body: { current_password, new_password }
//
// Verifies the current password against the stored hash, then atomically:
//   - replaces password_hash
//   - clears must_change_password
//   - wipes temp_password_plain (and views_left)
// On any verify failure → 401, no state change.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { hashPassword, verifyPassword } from './_shared/argon';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';

const Body = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(200),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  let actor;
  try { actor = await requireBucketUser(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();
  const rows = (await sql`
    SELECT password_hash FROM public.user_node_credentials
    WHERE id = ${actor.credential.id} LIMIT 1
  `) as { password_hash: string }[];
  const cred = rows[0];
  if (!cred) return jsonError(401, 'unauthorized');

  const ok = await verifyPassword(parsed.data.current_password, cred.password_hash);
  if (!ok) return jsonError(401, 'current_password_incorrect');

  const newHash = await hashPassword(parsed.data.new_password);
  await sql`
    UPDATE public.user_node_credentials
    SET password_hash = ${newHash},
        must_change_password = false,
        temp_password_plain = NULL,
        temp_password_views_left = NULL
    WHERE id = ${actor.credential.id}
  `;

  return jsonOk({ ok: true });
};
