// DELETE ?id=  → removes an admin. Refuses to delete the bootstrap admin
// (returns 409 `cannot_delete_bootstrap`) and refuses self-delete
// (returns 409 `cannot_delete_self`).

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { AdminCapabilityError, requireAdminCapability, UnauthorizedError } from './_shared/permissions';
import { assertUuid } from './_shared/identifier';
import { jsonError, jsonOk } from './_shared/http';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'DELETE') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  let actor;
  try { actor = await requireAdminCapability(req, 'admin.manage'); } catch (e) {
    if (e instanceof AdminCapabilityError) return jsonError(403, 'admin_role_forbidden', { capability: e.capability });
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(id, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const sql = db();
  const rows = (await sql`
    SELECT id, email, is_bootstrap FROM public.admins WHERE id = ${id} LIMIT 1
  `) as { id: string; email: string; is_bootstrap: boolean }[];
  const target = rows[0];
  if (!target) return jsonError(404, 'not_found');

  // Bootstrap-first ordering: when the bootstrap admin is also the actor,
  // the more specific "bootstrap" reason wins over "self" — matches the UI
  // which prefers the bootstrap tooltip in the same situation.
  if (target.is_bootstrap) return jsonError(409, 'cannot_delete_bootstrap');
  if (id === actor.admin.id) return jsonError(409, 'cannot_delete_self');

  await sql`DELETE FROM public.admins WHERE id = ${id}`;
  await logAudit(sql, {
    session: { kind: 'admin', admin: { id: actor.admin.id, email: '' } },
    op: 'admin.deleted',
    clientId: null,
    targetType: 'admin',
    targetId: id,
    detail: { email: target.email },
  });
  return jsonOk({ ok: true });
};
