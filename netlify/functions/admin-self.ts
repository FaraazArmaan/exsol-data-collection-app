// PATCH only — body: { display_name?, password? }. Updates the authenticated
// admin's own row. Password is hashed via argon2 before storage.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { hashPassword } from './_shared/argon';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { rejectCrossSiteMutation } from './_shared/csrf';

const Body = z.object({
  display_name: z.string().min(1).max(200).optional(),
  password: z.string().min(8).max(200).optional(),
}).refine((d) => d.display_name !== undefined || d.password !== undefined, {
  message: 'at_least_one_field_required',
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'PATCH') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();
  const newHash = parsed.data.password ? await hashPassword(parsed.data.password) : null;

  // COALESCE keeps current value when the field isn't provided. Casting NULL
  // sentinels to text/text avoids "could not determine data type" from Neon.
  const rows = (await sql`
    UPDATE public.admins
    SET display_name  = COALESCE(${parsed.data.display_name ?? null}::text, display_name),
        password_hash = COALESCE(${newHash}::text, password_hash)
    WHERE id = ${actor.admin.id}
    RETURNING id, email, display_name, is_bootstrap
  `) as { id: string; email: string; display_name: string; is_bootstrap: boolean }[];

  const admin = rows[0];
  if (!admin) return jsonError(404, 'not_found');
  return jsonOk({ admin });
};
