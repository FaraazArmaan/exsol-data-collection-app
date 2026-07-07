// /api/procurement/supplier-contacts — list (GET ?supplier_id=) + create (POST).
// Named contacts under a supplier. Client-scoped via the parent supplier.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/supplier-contacts', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const strOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireProcurement(req, ['procurement.products.view']);
    if (!a.ok) return a.res;
    const supplierId = (new URL(req.url).searchParams.get('supplier_id') ?? '').trim();
    if (!UUID_RE.test(supplierId)) return jsonError(400, 'supplier_id_required');
    const sql = db();
    const rows = (await sql`
      SELECT c.id, c.name, c.role, c.phone, c.email
      FROM public.supplier_contacts c
      JOIN public.suppliers s ON s.id = c.supplier_id
      WHERE c.supplier_id = ${supplierId}::uuid AND s.client_id = ${a.ctx.clientId}::uuid
      ORDER BY c.created_at ASC
    `) as unknown[];
    return jsonOk({ contacts: rows });
  }

  if (req.method === 'POST') {
    const a = await requireProcurement(req, ['procurement.products.edit']);
    if (!a.ok) return a.res;
    let body: { supplier_id?: unknown; name?: unknown; role?: unknown; phone?: unknown; email?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return jsonError(400, 'invalid_json');
    }
    const supplierId = typeof body.supplier_id === 'string' ? body.supplier_id.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!UUID_RE.test(supplierId)) return jsonError(400, 'supplier_id_required');
    if (!name) return jsonError(400, 'name_required');
    if (name.length > 160) return jsonError(400, 'name_too_long');

    const sql = db();
    const owned = (await sql`
      SELECT id FROM public.suppliers
      WHERE id = ${supplierId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL LIMIT 1
    `) as unknown[];
    if (owned.length === 0) return jsonError(404, 'supplier_not_found');

    const rows = (await sql`
      INSERT INTO public.supplier_contacts (client_id, supplier_id, name, role, phone, email)
      VALUES (${a.ctx.clientId}::uuid, ${supplierId}::uuid, ${name}, ${strOrNull(body.role)}, ${strOrNull(body.phone)}, ${strOrNull(body.email)})
      RETURNING id, name, role, phone, email
    `) as unknown[];
    return jsonOk({ contact: rows[0] }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
