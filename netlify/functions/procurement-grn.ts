// /api/procurement/grn — goods-received notes for a PO (GET ?purchase_order_id= + POST).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/grn', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function poOwned(sql: ReturnType<typeof db>, poId: string, clientId: string): Promise<boolean> {
  const rows = (await sql`
    SELECT id FROM public.purchase_orders WHERE id = ${poId}::uuid AND client_id = ${clientId}::uuid LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireProcurement(req, ['procurement.products.view']);
    if (!a.ok) return a.res;
    const poId = (new URL(req.url).searchParams.get('purchase_order_id') ?? '').trim();
    if (!UUID_RE.test(poId)) return jsonError(400, 'purchase_order_id_required');
    const sql = db();
    if (!(await poOwned(sql, poId, a.ctx.clientId))) return jsonError(404, 'not_found');

    const grns = (await sql`
      SELECT id, to_char(received_on, 'YYYY-MM-DD') AS received_on, note, created_at
      FROM public.goods_receipts
      WHERE purchase_order_id = ${poId}::uuid AND client_id = ${a.ctx.clientId}::uuid
      ORDER BY created_at DESC
    `) as unknown[];
    const items = (await sql`
      SELECT gri.goods_receipt_id, gri.product_id, p.name AS product_name, gri.qty_received
      FROM public.goods_receipt_items gri
      JOIN public.goods_receipts gr ON gr.id = gri.goods_receipt_id
      JOIN public.products p ON p.id = gri.product_id
      WHERE gr.purchase_order_id = ${poId}::uuid AND gr.client_id = ${a.ctx.clientId}::uuid
      ORDER BY p.name ASC
    `) as unknown[];
    return jsonOk({ grns, items });
  }

  if (req.method === 'POST') {
    const a = await requireProcurement(req, ['procurement.products.edit']);
    if (!a.ok) return a.res;
    let body: { purchase_order_id?: unknown; received_on?: unknown; note?: unknown; items?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return jsonError(400, 'invalid_json');
    }
    const poId = typeof body.purchase_order_id === 'string' ? body.purchase_order_id.trim() : '';
    if (!UUID_RE.test(poId)) return jsonError(400, 'purchase_order_id_required');
    const receivedOn = typeof body.received_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.received_on) ? body.received_on : null;
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
    if (!Array.isArray(body.items) || body.items.length === 0) return jsonError(400, 'items_required');

    const items: Array<{ productId: string; qty: number }> = [];
    for (const raw of body.items) {
      const it = raw as { product_id?: unknown; qty_received?: unknown };
      const productId = typeof it.product_id === 'string' ? it.product_id.trim() : '';
      const qty = typeof it.qty_received === 'number' ? Math.trunc(it.qty_received) : NaN;
      if (!UUID_RE.test(productId)) return jsonError(400, 'invalid_item_product');
      if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'invalid_item_qty');
      items.push({ productId, qty });
    }

    const sql = db();
    if (!(await poOwned(sql, poId, a.ctx.clientId))) return jsonError(404, 'not_found');
    const productIds = [...new Set(items.map((i) => i.productId))];
    const owned = (await sql`
      SELECT id FROM public.products WHERE client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL AND id = ANY(${productIds}::uuid[])
    `) as unknown[];
    if (owned.length !== productIds.length) return jsonError(400, 'invalid_item_product');

    const grn = (await sql`
      INSERT INTO public.goods_receipts (client_id, purchase_order_id, received_on, note, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${poId}::uuid, COALESCE(${receivedOn}::date, current_date), ${note}, ${a.ctx.userNodeId}::uuid)
      RETURNING id
    `) as Array<{ id: string }>;
    const grnId = grn[0]!.id;
    for (const it of items) {
      await sql`
        INSERT INTO public.goods_receipt_items (goods_receipt_id, product_id, qty_received)
        VALUES (${grnId}::uuid, ${it.productId}::uuid, ${it.qty}::int)
      `;
    }
    return jsonOk({ id: grnId }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
