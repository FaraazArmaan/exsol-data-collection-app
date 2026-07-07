// /api/procurement/invoices — supplier invoices for a PO (GET ?purchase_order_id= + POST).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/invoices', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireProcurement(req, ['procurement.products.view']);
    if (!a.ok) return a.res;
    const poId = (new URL(req.url).searchParams.get('purchase_order_id') ?? '').trim();
    if (!UUID_RE.test(poId)) return jsonError(400, 'purchase_order_id_required');
    const sql = db();
    const rows = (await sql`
      SELECT id, invoice_number, amount_cents, to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date
      FROM public.supplier_invoices
      WHERE purchase_order_id = ${poId}::uuid AND client_id = ${a.ctx.clientId}::uuid
      ORDER BY created_at DESC
    `) as unknown[];
    return jsonOk({ invoices: rows });
  }

  if (req.method === 'POST') {
    const a = await requireProcurement(req, ['procurement.products.edit']);
    if (!a.ok) return a.res;
    let body: { purchase_order_id?: unknown; invoice_number?: unknown; amount_cents?: unknown; invoice_date?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return jsonError(400, 'invalid_json');
    }
    const poId = typeof body.purchase_order_id === 'string' ? body.purchase_order_id.trim() : '';
    const invoiceNumber = typeof body.invoice_number === 'string' ? body.invoice_number.trim() : '';
    const amount = typeof body.amount_cents === 'number' ? Math.trunc(body.amount_cents) : NaN;
    const invoiceDate = typeof body.invoice_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.invoice_date) ? body.invoice_date : null;
    if (!UUID_RE.test(poId)) return jsonError(400, 'purchase_order_id_required');
    if (!invoiceNumber) return jsonError(400, 'invoice_number_required');
    if (!Number.isFinite(amount) || amount < 0) return jsonError(400, 'invalid_amount');

    const sql = db();
    const po = (await sql`
      SELECT id FROM public.purchase_orders WHERE id = ${poId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as unknown[];
    if (po.length === 0) return jsonError(404, 'not_found');

    const rows = (await sql`
      INSERT INTO public.supplier_invoices (client_id, purchase_order_id, invoice_number, amount_cents, invoice_date, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${poId}::uuid, ${invoiceNumber}, ${amount}::bigint, COALESCE(${invoiceDate}::date, current_date), ${a.ctx.userNodeId}::uuid)
      RETURNING id, invoice_number, amount_cents, to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date
    `) as unknown[];
    return jsonOk({ invoice: rows[0] }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
