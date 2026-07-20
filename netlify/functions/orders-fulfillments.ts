// GET /api/orders/fulfillments — list fulfillments for a client.
//
// Query params:
//   ?sale_id=<uuid>  (optional) — filter to a specific sale
//
// Permission: orders.business.view
//
// Returns: array of fulfillments, each with their lines (joined with sale_lines for
//          product_name_snap and qty). All results scoped to the authenticated client.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders } from './_orders-authz';

export const config = { path: '/api/orders/fulfillments', method: 'GET' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, ['orders.business.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const saleIdParam = url.searchParams.get('sale_id');
  const filterBySale = saleIdParam && UUID_RE.test(saleIdParam);

  const sql = db();

  // Load fulfillments scoped to client, optionally filtered by sale_id.
  const fulfillmentRows = filterBySale
    ? (await sql`
        SELECT id, sale_id, label, status, created_at, updated_at, fulfilled_at
        FROM public.orders_fulfillments
        WHERE client_id = ${a.ctx.clientId}::uuid AND sale_id = ${saleIdParam}::uuid
        ORDER BY created_at DESC
      `) as Array<{ id: string; sale_id: string; label: string; status: string; created_at: string; updated_at: string; fulfilled_at: string | null }>
    : (await sql`
        SELECT id, sale_id, label, status, created_at, updated_at, fulfilled_at
        FROM public.orders_fulfillments
        WHERE client_id = ${a.ctx.clientId}::uuid
        ORDER BY created_at DESC
      `) as Array<{ id: string; sale_id: string; label: string; status: string; created_at: string; updated_at: string; fulfilled_at: string | null }>;

  if (fulfillmentRows.length === 0) return jsonOk([]);

  // Load all fulfillment_lines for the returned fulfillments, joining sale_lines for metadata.
  const fulfillmentIds = fulfillmentRows.map((f) => f.id);
  const lineRows = (await sql`
    SELECT
      fl.id,
      fl.fulfillment_id,
      fl.sale_line_id,
      fl.qty,
      sl.variant_id,
      sl.product_name_snap,
      sl.variant_name_snap,
      sl.variant_sku_snap,
      sl.unit_price_cents,
      sl.qty AS line_qty
    FROM public.orders_fulfillment_lines fl
    JOIN public.sale_lines sl ON sl.id = fl.sale_line_id
    WHERE fl.fulfillment_id = ANY(${fulfillmentIds}::uuid[])
    ORDER BY fl.fulfillment_id, fl.id
  `) as Array<{
    id: string;
    fulfillment_id: string;
    sale_line_id: string;
    qty: number;
    variant_id: string | null;
    product_name_snap: string;
    variant_name_snap: string | null;
    variant_sku_snap: string | null;
    unit_price_cents: number;
    line_qty: number;
  }>;

  // Group lines by fulfillment_id.
  const linesByFulfillment = new Map<string, typeof lineRows>();
  for (const l of lineRows) {
    const arr = linesByFulfillment.get(l.fulfillment_id) ?? [];
    arr.push(l);
    linesByFulfillment.set(l.fulfillment_id, arr);
  }

  const result = fulfillmentRows.map((f) => ({
    ...f,
    lines: (linesByFulfillment.get(f.id) ?? []).map((l) => ({
      id: l.id,
      sale_line_id: l.sale_line_id,
      qty: l.qty,
      variant_id: l.variant_id,
      product_name_snap: l.product_name_snap,
      variant_name_snap: l.variant_name_snap,
      variant_sku_snap: l.variant_sku_snap,
      unit_price_cents: Number(l.unit_price_cents),
      line_qty: l.line_qty,
    })),
  }));

  return jsonOk(result);
}
