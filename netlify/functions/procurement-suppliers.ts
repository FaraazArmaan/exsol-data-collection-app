// /api/procurement/suppliers — list (GET) + create (POST).
// Bucket-scoped supplier list with depth fields (payment_terms, rating).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/suppliers', method: ['GET', 'POST'] };

interface SupplierBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  notes?: unknown;
  payment_terms?: unknown;
  rating?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strOrNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

// rating: 1-5 or null; a present-but-invalid rating is a 400.
export function parseRating(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v == null || v === '') return { ok: true, value: null };
  const n = typeof v === 'number' ? Math.trunc(v) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false };
  return { ok: true, value: n };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireProcurement(req, ['procurement.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT id, name, phone, email, notes, payment_terms, rating
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
    const rating = parseRating(body.rating);
    if (!rating.ok) return jsonError(400, 'invalid_rating');

    const sql = db();
    const rows = (await sql`
      INSERT INTO public.suppliers (client_id, name, phone, email, notes, payment_terms, rating)
      VALUES (${a.ctx.clientId}::uuid, ${name}, ${strOrNull(body.phone)}, ${strOrNull(body.email)}, ${strOrNull(body.notes)}, ${strOrNull(body.payment_terms)}, ${rating.value})
      RETURNING id, name, phone, email, notes, payment_terms, rating
    `) as unknown[];
    return jsonOk({ supplier: rows[0] }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
