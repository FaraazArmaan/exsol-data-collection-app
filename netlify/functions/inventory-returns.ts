// /api/inventory/returns — customer return intake (RMA).
//   GET  → list returns for the client.
//   POST → log a return. disposition 'restock' adds the units back to stock via
//          a 'return' movement; 'writeoff' records a scrap via a 'writeoff'
//          movement (0 delta — the units never re-enter on-hand). Both write an
//          inventory_returns audit row, all in one transaction.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireInventory } from './_inventory-authz';

export const config = { path: '/api/inventory/returns', method: ['GET', 'POST'] };

interface ReturnBody {
  product_id?: unknown;
  qty?: unknown;
  disposition?: unknown;
  reason?: unknown;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireInventory(req, ['inventory.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT r.id, r.product_id, p.name AS product_name, p.sku,
             r.qty, r.disposition, r.reason, r.created_at
      FROM public.inventory_returns r
      JOIN public.products p ON p.id = r.product_id
      WHERE r.client_id = ${a.ctx.clientId}::uuid
      ORDER BY r.created_at DESC
      LIMIT 200
    `) as unknown[];
    return jsonOk({ returns: rows });
  }

  if (req.method === 'POST') {
    const a = await requireInventory(req, ['inventory.products.edit']);
    if (!a.ok) return a.res;

    let body: ReturnBody;
    try {
      body = (await req.json()) as ReturnBody;
    } catch {
      return jsonError(400, 'invalid_json');
    }
    const productId = typeof body.product_id === 'string' ? body.product_id.trim() : '';
    const qty = typeof body.qty === 'number' ? Math.trunc(body.qty) : NaN;
    const disposition = body.disposition === 'restock' || body.disposition === 'writeoff' ? body.disposition : '';
    const reason = typeof body.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim() : null;

    if (!productId) return jsonError(400, 'product_id_required');
    if (!Number.isFinite(qty) || qty <= 0) return jsonError(400, 'qty_required');
    if (!disposition) return jsonError(400, 'disposition_required');

    const sql = db();
    const owned = (await sql`
      SELECT id FROM public.products
      WHERE id = ${productId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `) as Array<{ id: string }>;
    if (owned.length === 0) return jsonError(404, 'product_not_found');

    const ref = reason ?? `RMA ${disposition}`;

    if (disposition === 'restock') {
      const results = await sql.transaction([
        sql`
          INSERT INTO public.inventory_returns (client_id, product_id, qty, disposition, reason, created_by)
          VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${qty}::int, 'restock', ${reason}, ${a.ctx.userNodeId}::uuid)
        `,
        sql`
          INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand)
          VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${qty}::int)
          ON CONFLICT (client_id, product_id)
          DO UPDATE SET qty_on_hand = public.inventory_stock.qty_on_hand + ${qty}::int, updated_at = now()
          RETURNING qty_on_hand
        `,
        sql`
          INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
          VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${qty}::int, 'return', ${ref}, ${a.ctx.userNodeId}::uuid)
        `,
      ]);
      const qtyOnHand = (results[1] as Array<{ qty_on_hand: number }>)[0]?.qty_on_hand ?? qty;
      return jsonOk({ ok: true, disposition, qty_on_hand: qtyOnHand }, { status: 201 });
    }

    // writeoff: audit-only, no on-hand change (units are scrapped, not restocked).
    await sql.transaction([
      sql`
        INSERT INTO public.inventory_returns (client_id, product_id, qty, disposition, reason, created_by)
        VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, ${qty}::int, 'writeoff', ${reason}, ${a.ctx.userNodeId}::uuid)
      `,
      sql`
        INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
        VALUES (${a.ctx.clientId}::uuid, ${productId}::uuid, 0, 'writeoff', ${ref}, ${a.ctx.userNodeId}::uuid)
      `,
    ]);
    return jsonOk({ ok: true, disposition }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
