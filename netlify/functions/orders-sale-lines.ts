// GET /api/orders/sale-lines/:saleId — return sale header + lines for the split allocator.
//
// Permission: orders.business.view
// `:saleId` must be a valid UUID; unknown or foreign saleId → 404.
//
// Returns:
//   { sale: { id, order_no, customer_name }, lines: [{ id, product_id, product_name_snap, qty }] }
//   lines are ordered by position (insertion order in the cart).
//
// order_no / qty come from Postgres as number-or-string depending on the column
// type (INT vs BIGINT) — Number() normalises both for safety.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders } from './_orders-authz';

export const config = { path: '/api/orders/sale-lines/:saleId', method: 'GET' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

export default async function handler(req: Request): Promise<Response> {
  const saleId = idFrom(req);
  if (!UUID_RE.test(saleId)) return jsonError(404, 'not_found');

  const a = await requireOrders(req, ['orders.business.view']);
  if (!a.ok) return a.res;

  const sql = db();

  // Load sale scoped by bucket_id = clientId (unknown/foreign → 404).
  const saleRows = (await sql`
    SELECT id, order_no, customer_name
    FROM public.sales
    WHERE id = ${saleId}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; order_no: string | number; customer_name: string }>;
  if (!saleRows[0]) return jsonError(404, 'not_found');
  const saleRow = saleRows[0];

  // Load all sale_lines for this sale ordered by position.
  const lineRows = (await sql`
    SELECT id, product_id, product_name_snap, qty
    FROM public.sale_lines
    WHERE sale_id = ${saleId}::uuid
    ORDER BY position
  `) as Array<{ id: string; product_id: string; product_name_snap: string; qty: string | number }>;

  return jsonOk({
    sale: {
      id: saleRow.id,
      order_no: Number(saleRow.order_no),
      customer_name: saleRow.customer_name,
    },
    lines: lineRows.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      product_name_snap: l.product_name_snap,
      qty: Number(l.qty),
    })),
  });
}
