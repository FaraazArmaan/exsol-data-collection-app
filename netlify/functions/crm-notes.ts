import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { jsonError } from './_shared/http';

export const config = { path: '/api/crm/notes', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireCrm(req, ['crm.customers.create']);
  if (!a.ok) return a.res;
  const sql = db();
  const body = (await req.json().catch(() => ({}))) as { customer_id?: string; body?: string };
  if (!body.customer_id || !body.body?.trim()) return jsonError(400, 'invalid_input');

  const owned = (await sql`SELECT id FROM public.crm_customers WHERE id = ${body.customer_id}::uuid AND client_id = ${a.ctx.clientId}::uuid`) as any[];
  if (!owned[0]) return jsonError(404, 'not_found');

  const rows = (await sql`
    INSERT INTO public.crm_notes (client_id, customer_id, body, created_by_user_node)
    VALUES (${a.ctx.clientId}::uuid, ${body.customer_id}::uuid, ${body.body.trim()}, ${a.ctx.userNodeId}::uuid)
    RETURNING id, body, created_by_user_node, created_at, updated_at
  `) as any[];
  return new Response(JSON.stringify({ note: rows[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
