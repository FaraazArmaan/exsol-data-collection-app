// /api/procurement/orders — list (GET) + create (POST).
// A PO is created in 'draft' with one or more line items against owned products.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/orders', method: ['GET', 'POST'] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CreateBody {
  supplier_id?: unknown;
  expected_on?: unknown;
  notes?: unknown;
  items?: unknown;
}

interface ParsedItem {
  productId: string;
  qty: number;
  unitCostCents: number;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireProcurement(req, ['procurement.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    // List POs with supplier name + line/total summary for the table view.
    const rows = (await sql`
      SELECT po.id, po.status,
             to_char(po.expected_on, 'YYYY-MM-DD') AS expected_on,
             po.received_at, po.created_at,
             s.name AS supplier_name,
             coalesce(agg.item_count, 0)::int AS item_count,
             coalesce(agg.total_cents, 0)     AS total_cents
      FROM public.purchase_orders po
      JOIN public.suppliers s ON s.id = po.supplier_id
      LEFT JOIN (
        SELECT purchase_order_id,
               count(*) AS item_count,
               sum(qty * unit_cost_cents) AS total_cents
        FROM public.purchase_order_items
        GROUP BY purchase_order_id
      ) agg ON agg.purchase_order_id = po.id
      WHERE po.client_id = ${a.ctx.clientId}::uuid
      ORDER BY po.created_at DESC
    `) as unknown[];
    return jsonOk({ orders: rows });
  }

  if (req.method === 'POST') {
    const a = await requireProcurement(req, ['procurement.products.create']);
    if (!a.ok) return a.res;
    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return jsonError(400, 'invalid_json');
    }

    const supplierId = typeof body.supplier_id === 'string' ? body.supplier_id.trim() : '';
    if (!UUID_RE.test(supplierId)) return jsonError(400, 'supplier_required');

    const expectedOn = typeof body.expected_on === 'string' && body.expected_on.trim() !== ''
      ? body.expected_on.trim() : null;
    if (expectedOn !== null && !DATE_RE.test(expectedOn)) return jsonError(400, 'invalid_expected_on');

    const notes = typeof body.notes === 'string' && body.notes.trim() !== '' ? body.notes.trim() : null;

    if (!Array.isArray(body.items) || body.items.length === 0) return jsonError(400, 'items_required');
    const items: ParsedItem[] = [];
    for (const raw of body.items) {
      const it = raw as { product_id?: unknown; qty?: unknown; unit_cost_cents?: unknown };
      const productId = typeof it.product_id === 'string' ? it.product_id.trim() : '';
      const qty = typeof it.qty === 'number' ? Math.trunc(it.qty) : NaN;
      const unitCostCents = typeof it.unit_cost_cents === 'number' ? Math.trunc(it.unit_cost_cents) : 0;
      if (!UUID_RE.test(productId)) return jsonError(400, 'invalid_item_product');
      if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'invalid_item_qty');
      if (!Number.isFinite(unitCostCents) || unitCostCents < 0) return jsonError(400, 'invalid_item_cost');
      items.push({ productId, qty, unitCostCents });
    }

    const sql = db();
    // Supplier must belong to this client and be live.
    const sup = (await sql`
      SELECT id FROM public.suppliers
      WHERE id = ${supplierId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `) as Array<{ id: string }>;
    if (sup.length === 0) return jsonError(404, 'supplier_not_found');

    // All item products must belong to this client and be live.
    const productIds = [...new Set(items.map((i) => i.productId))];
    const owned = (await sql`
      SELECT id FROM public.products
      WHERE client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
        AND id = ANY(${productIds}::uuid[])
    `) as Array<{ id: string }>;
    if (owned.length !== productIds.length) return jsonError(400, 'invalid_item_product');

    const poRows = (await sql`
      INSERT INTO public.purchase_orders (client_id, supplier_id, status, expected_on, notes, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${supplierId}::uuid, 'draft', ${expectedOn}::date, ${notes}, ${a.ctx.userNodeId}::uuid)
      RETURNING id
    `) as Array<{ id: string }>;
    const poId = poRows[0]!.id;

    for (const it of items) {
      await sql`
        INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
        VALUES (${poId}::uuid, ${it.productId}::uuid, ${it.qty}::int, ${it.unitCostCents}::bigint)
      `;
    }

    return jsonOk({ id: poId, status: 'draft' }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
