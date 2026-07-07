// GET /api/warehouse/asn-detail/:id — one ASN with its lines (expected vs received
// + variance). Client-scoped. (warehouse.products.view)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/asn-detail/:id', method: 'GET' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/asn-detail\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  const a = await requireWarehouse(req, ['warehouse.products.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const asn = (await sql`
    SELECT id, reference, carrier, to_char(eta, 'YYYY-MM-DD') AS eta,
           status, purchase_order_id, notes, created_at
    FROM public.inbound_asns
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as Array<Record<string, unknown>>;
  if (asn.length === 0) return jsonError(404, 'not_found');

  const lines = (await sql`
    SELECT l.id, l.product_id, p.name AS product_name, p.sku,
           l.expected_qty, l.received_qty,
           (l.received_qty - l.expected_qty) AS variance
    FROM public.asn_lines l
    JOIN public.products p ON p.id = l.product_id
    WHERE l.asn_id = ${id}::uuid
    ORDER BY p.name ASC
  `) as unknown[];

  return jsonOk({ asn: asn[0], lines });
}
