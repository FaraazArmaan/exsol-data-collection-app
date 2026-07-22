// /api/workforce/sensitive-access — L1-only grants for sensitive Workforce data.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { SENSITIVE_SCOPES, type SensitiveDataScope } from './_workforce-privacy';

export const config = { path: '/api/workforce/sensitive-access' };

function requireOwner(levelNumber: number): Response | null {
  return levelNumber === 1 ? null : jsonError(403, 'sensitive_access_owner_only');
}

export default async function handler(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, req.method === 'GET' ? ['workforce.employees.view'] : ['workforce.employees.edit']);
  if (!a.ok) return a.res;
  const ownerOnly = requireOwner(a.ctx.levelNumber);
  if (ownerOnly) return ownerOnly;
  const sql = db();
  if (req.method === 'GET') {
    const grants = await sql`
      SELECT g.*, un.display_name AS user_name
      FROM public.workforce_sensitive_data_grants g
      JOIN public.user_nodes un ON un.id = g.user_node_id
      WHERE g.client_id = ${a.ctx.clientId}::uuid
      ORDER BY g.active DESC, un.display_name, g.data_scope
    ` as unknown[];
    return jsonOk({ grants });
  }
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return jsonError(400, 'invalid_json'); }
  const userNodeId = typeof body.user_node_id === 'string' ? body.user_node_id.trim() : '';
  const dataScope = typeof body.data_scope === 'string' ? body.data_scope : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const active = body.active !== false;
  if (!userNodeId || !SENSITIVE_SCOPES.includes(dataScope as SensitiveDataScope) || reason.length < 3) return jsonError(400, 'sensitive_access_grant_invalid');
  const member = await sql`SELECT id FROM public.user_nodes WHERE id = ${userNodeId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1` as unknown[];
  if (!member[0]) return jsonError(404, 'team_user_not_found');
  const rows = await sql`
    INSERT INTO public.workforce_sensitive_data_grants (client_id, user_node_id, data_scope, reason, active, granted_by, revoked_at, revoked_by)
    VALUES (${a.ctx.clientId}::uuid, ${userNodeId}::uuid, ${dataScope}::text, ${reason}::text, ${active}::boolean, ${a.ctx.userNodeId}::uuid, CASE WHEN ${active}::boolean THEN NULL ELSE now() END, CASE WHEN ${active}::boolean THEN NULL ELSE ${a.ctx.userNodeId}::uuid END)
    ON CONFLICT (client_id, user_node_id, data_scope)
    DO UPDATE SET reason = EXCLUDED.reason, active = EXCLUDED.active, granted_by = EXCLUDED.granted_by, revoked_at = CASE WHEN EXCLUDED.active THEN NULL ELSE now() END, revoked_by = CASE WHEN EXCLUDED.active THEN NULL ELSE ${a.ctx.userNodeId}::uuid END, updated_at = now()
    RETURNING *
  ` as Array<Record<string, unknown>>;
  return jsonOk({ grant: rows[0] });
}
