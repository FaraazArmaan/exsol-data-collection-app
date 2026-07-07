// GET|POST /api/orders/shipments — list and create shipments.
//
// GET (perm view): list all shipments for the caller's client, joined with
//   the sale's order_no and customer_name.
// POST (perm create): validate sale ownership, insert shipment at
//   status='pending'.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders } from './_orders-authz';

export const config = { path: '/api/orders/shipments', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireOrders(req, ['orders.business.view']);
    if (!a.ok) return a.res;
    const { clientId } = a.ctx;
    const sql = db();

    const rows = (await sql`
      SELECT sh.id, sh.sale_id, sh.carrier, sh.tracking_ref, sh.status,
             sh.shipped_at, sh.delivered_at, sh.created_at, sh.updated_at,
             s.order_no, s.customer_name
      FROM public.orders_shipments sh
      JOIN public.sales s ON s.id = sh.sale_id
      WHERE sh.client_id = ${clientId}::uuid
      ORDER BY sh.created_at DESC
    `) as Array<Record<string, unknown>>;

    return jsonOk(rows);
  }

  if (req.method === 'POST') {
    const a = await requireOrders(req, ['orders.business.create']);
    if (!a.ok) return a.res;
    const { clientId } = a.ctx;
    const sql = db();

    let body: { sale_id?: unknown; carrier?: unknown; tracking_ref?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_body');
    }

    const { sale_id, carrier, tracking_ref } = body;

    if (typeof sale_id !== 'string' || !UUID_RE.test(sale_id)) {
      return jsonError(404, 'sale_not_found');
    }

    // Validate sale ownership
    const sales = (await sql`
      SELECT id FROM public.sales
      WHERE id = ${sale_id}::uuid AND bucket_id = ${clientId}::uuid
      LIMIT 1
    `) as Array<{ id: string }>;

    if (!sales[0]) return jsonError(404, 'sale_not_found');

    const carrierVal = typeof carrier === 'string' ? carrier : null;
    const trackingVal = typeof tracking_ref === 'string' ? tracking_ref : null;

    const inserted = (await sql`
      INSERT INTO public.orders_shipments
        (client_id, sale_id, carrier, tracking_ref, status)
      VALUES
        (${clientId}::uuid, ${sale_id}::uuid, ${carrierVal}, ${trackingVal}, 'pending')
      RETURNING id, sale_id, carrier, tracking_ref, status, created_at
    `) as Array<Record<string, unknown>>;

    return jsonOk(inserted[0]!, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
