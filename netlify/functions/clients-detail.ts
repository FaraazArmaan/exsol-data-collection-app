import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

export default async (req: Request, _ctx: Context) => {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(id, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const sql = db();
  const rows = (await sql`
    SELECT id, name, slug, created_at FROM public.clients WHERE id = ${id} LIMIT 1
  `) as { id: string; name: string; slug: string; created_at: string }[];
  const client = rows[0];
  if (!client) return jsonError(404, 'not_found');

  if (req.method === 'GET') return jsonOk({ client });

  if (req.method === 'DELETE') {
    // Cascades to client_roles, client_levels, user_nodes, etc. via FK.
    await sql`DELETE FROM public.clients WHERE id = ${id}`;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
