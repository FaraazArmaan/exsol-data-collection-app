// GET /api/orders/backorders — list all backorders for caller's client.
// POST /api/orders/backorders — create a new backorder linked to a sale + product.
//   Body: { sale_id, product_id, qty_ordered }
//   Validates sale + product both belong to caller's client. Snapshots product name.
//   Returns 201 with the created backorder row.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders } from './_orders-authz';

export const config = { path: '/api/orders/backorders', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireOrders(req, ['orders.business.view']);
    if (!a.ok) return a.res;
    const { clientId } = a.ctx;

    const sql = db();
    const rows = (await sql`
      SELECT ob.id, ob.sale_id, ob.product_id, ob.product_name_snap,
             ob.qty_ordered, ob.qty_fulfilled, ob.status,
             ob.created_at, ob.updated_at, ob.fulfilled_at
      FROM public.orders_backorders ob
      WHERE ob.client_id = ${clientId}::uuid
      ORDER BY ob.created_at DESC
    `) as Array<Record<string, unknown>>;

    return jsonOk(rows.map((r) => ({
      ...r,
      qty_ordered: Number(r.qty_ordered),
      qty_fulfilled: Number(r.qty_fulfilled),
    })));
  }

  if (req.method === 'POST') {
    const a = await requireOrders(req, ['orders.business.create']);
    if (!a.ok) return a.res;
    const { clientId } = a.ctx;

    let body: { sale_id?: unknown; product_id?: unknown; qty_ordered?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_json');
    }

    const { sale_id, product_id, qty_ordered } = body;
    if (
      typeof sale_id !== 'string' || !UUID_RE.test(sale_id) ||
      typeof product_id !== 'string' || !UUID_RE.test(product_id) ||
      typeof qty_ordered !== 'number' || !Number.isInteger(qty_ordered) || qty_ordered < 1
    ) {
      return jsonError(400, 'invalid_body');
    }

    const sql = db();

    // Validate sale belongs to this client (bucket_id = clientId for sales)
    const saleRows = (await sql`
      SELECT id FROM public.sales WHERE id = ${sale_id}::uuid AND bucket_id = ${clientId}::uuid LIMIT 1
    `) as Array<{ id: string }>;
    if (!saleRows[0]) return jsonError(404, 'sale_not_found');

    // Validate product belongs to this client and snapshot the name
    const productRows = (await sql`
      SELECT id, name FROM public.products WHERE id = ${product_id}::uuid AND client_id = ${clientId}::uuid LIMIT 1
    `) as Array<{ id: string; name: string }>;
    if (!productRows[0]) return jsonError(404, 'product_not_found');
    const productNameSnap = productRows[0].name;

    const inserted = (await sql`
      INSERT INTO public.orders_backorders
        (client_id, sale_id, product_id, product_name_snap, qty_ordered)
      VALUES
        (${clientId}::uuid, ${sale_id}::uuid, ${product_id}::uuid, ${productNameSnap}, ${qty_ordered}::int)
      RETURNING id, sale_id, product_id, product_name_snap, qty_ordered, qty_fulfilled, status, created_at, updated_at, fulfilled_at
    `) as Array<Record<string, unknown>>;

    const row = inserted[0]!;
    return new Response(
      JSON.stringify({
        ...row,
        qty_ordered: Number(row.qty_ordered),
        qty_fulfilled: Number(row.qty_fulfilled),
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response('Method Not Allowed', { status: 405 });
}
