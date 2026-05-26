import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { dropClientSchema } from './_shared/schema-manager';

export default async (req: Request, _ctx: Context) => {
  let actor;
  try {
    actor = await requireAdmin(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');

  const sql = db();
  const rows = (await sql`
    SELECT id, name, schema_name, slug, template_key, created_at
    FROM public.clients WHERE id = ${id} LIMIT 1
  `) as { id: string; name: string; schema_name: string; slug: string; template_key: string; created_at: string }[];
  const client = rows[0];
  if (!client) return jsonError(404, 'not_found');

  if (req.method === 'GET') return jsonOk({ client });

  if (req.method === 'DELETE') {
    try {
      await dropClientSchema({
        schemaName: client.schema_name,
        clientId: client.id,
        actorAdminId: actor.admin.id,
      });
    } catch (e) {
      return jsonError(500, 'schema_op_failed', String(e));
    }
    // Only delete the client row once schema drop succeeded.
    await sql`DELETE FROM public.clients WHERE id = ${id}`;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
