// /api/procurement/suppliers — list (GET) + create (POST).
// Bucket-scoped supplier contact list. Soft-deleted rows are hidden.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/suppliers', method: ['GET', 'POST'] };

interface SupplierBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  notes?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireProcurement(req, ['procurement.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT id, name, phone, email, notes
      FROM public.suppliers
      WHERE client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
      ORDER BY name ASC
    `) as unknown[];
    return jsonOk({ suppliers: rows });
  }

  if (req.method === 'POST') {
    const a = await requireProcurement(req, ['procurement.products.create']);
    if (!a.ok) return a.res;
    let body: SupplierBody;
    try {
      body = (await req.json()) as SupplierBody;
    } catch {
      return jsonError(400, 'invalid_json');
    }
    const name = str(body.name);
    if (!name) return jsonError(400, 'name_required');
    if (name.length > 160) return jsonError(400, 'name_too_long');

    const sql = db();
    const rows = (await sql`
      INSERT INTO public.suppliers (client_id, name, phone, email, notes)
      VALUES (${a.ctx.clientId}::uuid, ${name}, ${strOrNull(body.phone)}, ${strOrNull(body.email)}, ${strOrNull(body.notes)})
      RETURNING id, name, phone, email, notes
    `) as unknown[];
    return jsonOk({ supplier: rows[0] }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
