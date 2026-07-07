// POST /api/warehouse/asn-receive — record what physically arrived against an ASN.
// Body: { asn_id, lines: [{ line_id, received_qty }] }. Updates received_qty per line
// and flips the ASN to 'received'. Reconciliation only — does NOT touch
// inventory_stock (Procurement's PO receive owns the stock increment).
// (warehouse.products.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/asn-receive', method: 'POST' };

interface Line { line_id?: unknown; received_qty?: unknown }
interface Body { asn_id?: unknown; lines?: unknown }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.products.edit']);
  if (!a.ok) return a.res;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const asnId = typeof body.asn_id === 'string' ? body.asn_id.trim() : '';
  if (!asnId) return jsonError(400, 'asn_id_required');

  const sql = db();
  const asn = (await sql`
    SELECT id FROM public.inbound_asns
    WHERE id = ${asnId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as Array<{ id: string }>;
  if (asn.length === 0) return jsonError(404, 'asn_not_found');

  const lines = Array.isArray(body.lines) ? (body.lines as Line[]) : [];
  for (const raw of lines) {
    const lineId = typeof raw.line_id === 'string' ? raw.line_id.trim() : '';
    const qty = typeof raw.received_qty === 'number' ? Math.max(0, Math.trunc(raw.received_qty)) : NaN;
    if (!lineId || !Number.isFinite(qty)) return jsonError(400, 'invalid_line');
    // Scoped to this ASN, so a foreign line id simply updates nothing.
    await sql`
      UPDATE public.asn_lines SET received_qty = ${qty}::int
      WHERE id = ${lineId}::uuid AND asn_id = ${asnId}::uuid
    `;
  }

  await sql`
    UPDATE public.inbound_asns SET status = 'received', updated_at = now()
    WHERE id = ${asnId}::uuid
  `;

  return jsonOk({ asn_id: asnId, status: 'received' });
}
