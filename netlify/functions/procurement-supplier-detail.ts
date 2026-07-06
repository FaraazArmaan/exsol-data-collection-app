// /api/procurement/suppliers/:id — update (PATCH) + soft-delete (DELETE).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/suppliers/:id', method: ['PATCH', 'DELETE'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFrom(req: Request): string {
  return new URL(req.url).pathname.split('/').pop() ?? '';
}

interface PatchBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  notes?: unknown;
}

const strOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  if (req.method === 'PATCH') {
    const a = await requireProcurement(req, ['procurement.products.edit']);
    if (!a.ok) return a.res;
    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return jsonError(400, 'invalid_json');
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return jsonError(400, 'name_required');
    if (name.length > 160) return jsonError(400, 'name_too_long');

    const sql = db();
    const rows = (await sql`
      UPDATE public.suppliers
      SET name = ${name}, phone = ${strOrNull(body.phone)}, email = ${strOrNull(body.email)}, notes = ${strOrNull(body.notes)}
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
      RETURNING id, name, phone, email, notes
    `) as unknown[];
    if (rows.length === 0) return jsonError(404, 'not_found');
    return jsonOk({ supplier: rows[0] });
  }

  if (req.method === 'DELETE') {
    const a = await requireProcurement(req, ['procurement.products.delete']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      UPDATE public.suppliers
      SET deleted_at = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
      RETURNING id
    `) as unknown[];
    if (rows.length === 0) return jsonError(404, 'not_found');
    return jsonOk({ ok: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
