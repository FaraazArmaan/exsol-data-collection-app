import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import {
  authenticateForPermission, resolveClientIdOrRespond,
} from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { loadStructure } from './_shared/user-tree';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, '_platform.users.view');
  if (auth instanceof Response) return auth;
  const session = auth;

  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const clientId = scope.clientId;
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const sql = db();
  const exists = (await sql`SELECT 1 FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1`) as unknown[];
  if (exists.length === 0) return jsonError(404, 'not_found');

  const structure = await loadStructure(sql, clientId);
  return jsonOk(structure as unknown as Record<string, unknown>);
};
