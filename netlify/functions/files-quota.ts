// /api/files-quota
//   GET   → { byte_limit, bytes_used } for the caller's workspace (bucket_user),
//           or for ?client_id=<uuid> (admin).
//   PATCH → admin-only: { client_id, byte_limit } sets a client's limit.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { getByteLimit, getQuota } from './_shared/files-quota';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleGet(req: Request): Promise<Response> {
  const auth = await authenticateForPermission(req, '_platform.files.view');
  if (auth instanceof Response) return auth;
  const session = auth;

  let clientId: string;
  if (session.kind === 'bucket_user') {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    clientId = scope.clientId;
  } else {
    const q = new URL(req.url).searchParams.get('client_id');
    if (!q || !UUID.test(q)) return jsonError(400, 'quota_target_required');
    clientId = q;
  }

  const sql = db();
  const quota = await getQuota(sql, clientId);
  return jsonOk(quota);
}

const PatchBody = z.object({
  client_id:  z.string().uuid(),
  byte_limit: z.number().int().positive().max(5_497_558_138_880), // 5 TB ceiling
});

async function handlePatch(req: Request): Promise<Response> {
  const auth = await authenticateForPermission(req, '_platform.files.view');
  if (auth instanceof Response) return auth;
  const session = auth;
  if (session.kind !== 'admin') return jsonError(403, 'admin_only');

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || !('client_id' in payload)) {
    return jsonError(400, 'quota_target_required');
  }
  const parsed = PatchBody.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const { client_id, byte_limit } = parsed.data;

  const sql = db();
  const oldLimit = await getByteLimit(sql, client_id);
  await sql`
    INSERT INTO public.workspace_storage_quota (client_id, byte_limit, updated_at)
    VALUES (${client_id}::uuid, ${byte_limit}, now())
    ON CONFLICT (client_id)
    DO UPDATE SET byte_limit = ${byte_limit}, updated_at = now()
  `;
  await logAudit(sql, {
    session, op: 'files.quota_changed', clientId: client_id,
    targetType: 'client', targetId: client_id,
    detail: { old_limit: oldLimit, new_limit: byte_limit },
  });
  return jsonOk({ ok: true });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === 'GET')   return handleGet(req);
  if (req.method === 'PATCH') return handlePatch(req);
  return jsonError(405, 'method_not_allowed');
};
