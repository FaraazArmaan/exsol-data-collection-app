import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { jsonError } from './_shared/http';

export const config = { path: '/api/crm/notes/:id', method: ['PATCH', 'DELETE'] };

export default async function handler(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split('/').pop()!;
  const isDelete = req.method === 'DELETE';
  const a = await requireCrm(req, [isDelete ? 'crm.customers.delete' : 'crm.customers.edit']);
  if (!a.ok) return a.res;
  const sql = db();

  if (isDelete) {
    const rows = (await sql`DELETE FROM public.crm_notes WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid RETURNING id`) as any[];
    if (!rows[0]) return jsonError(404, 'not_found');
    return new Response(null, { status: 204 });
  }

  const body = (await req.json().catch(() => ({}))) as { body?: string };
  if (!body.body?.trim()) return jsonError(400, 'invalid_input');
  const rows = (await sql`
    UPDATE public.crm_notes SET body = ${body.body.trim()}, updated_at = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id, body, created_by_user_node, created_at, updated_at
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  return new Response(JSON.stringify({ note: rows[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
