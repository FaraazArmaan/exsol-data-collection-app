// DELETE /api/procurement/supplier-contacts/:id — remove a supplier contact.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/supplier-contacts/:id', method: 'DELETE' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'DELETE') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireProcurement(req, ['procurement.products.edit']);
  if (!a.ok) return a.res;
  const id = new URL(req.url).pathname.split('/').pop() ?? '';
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const sql = db();
  const rows = (await sql`
    DELETE FROM public.supplier_contacts
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id
  `) as unknown[];
  if (rows.length === 0) return jsonError(404, 'not_found');
  return jsonOk({ ok: true });
}
