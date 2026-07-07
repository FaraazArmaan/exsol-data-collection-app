// GET|POST /api/orders/refunds — list and create refund requests.
//
// GET (perm view): list all refunds for the caller's client, joined with
//   the sale's order_no and customer_name for display.
// POST (perm create): validate sale ownership + amount, insert a new
//   orders_refunds row in state='requested', and log an audit event.
//
// The amount/sale coupling and state machine are enforced in
// orders-refund-advance.ts.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/refunds', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireOrders(req, ['orders.business.view']);
    if (!a.ok) return a.res;
    const { clientId } = a.ctx;
    const sql = db();

    const rows = (await sql`
      SELECT r.id, r.sale_id, r.amount_cents, r.reason, r.state,
             r.requested_by, r.created_at, r.updated_at, r.completed_at,
             s.order_no, s.customer_name
      FROM public.orders_refunds r
      JOIN public.sales s ON s.id = r.sale_id
      WHERE r.client_id = ${clientId}::uuid
      ORDER BY r.created_at DESC
    `) as Array<Record<string, unknown>>;

    return jsonOk(
      rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents) })),
    );
  }

  if (req.method === 'POST') {
    const a = await requireOrders(req, ['orders.business.create']);
    if (!a.ok) return a.res;
    const { clientId, userNodeId } = a.ctx;
    const sql = db();

    let body: { sale_id?: unknown; amount_cents?: unknown; reason?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_body');
    }

    const { sale_id, amount_cents, reason } = body;

    // Validate sale_id is a UUID string
    if (typeof sale_id !== 'string' || !UUID_RE.test(sale_id)) {
      return jsonError(404, 'sale_not_found');
    }

    // Validate amount_cents is a positive integer
    if (
      typeof amount_cents !== 'number' ||
      !Number.isInteger(amount_cents) ||
      amount_cents <= 0
    ) {
      return jsonError(400, 'amount_invalid');
    }

    // Fetch the sale scoped by client (bucket_id = clientId)
    const sales = (await sql`
      SELECT id, total_cents FROM public.sales
      WHERE id = ${sale_id}::uuid AND bucket_id = ${clientId}::uuid
      LIMIT 1
    `) as Array<{ id: string; total_cents: string }>;

    if (!sales[0]) return jsonError(404, 'sale_not_found');

    const totalCents = Number(sales[0].total_cents);
    if (amount_cents > totalCents) return jsonError(400, 'amount_invalid');

    // Aggregate cap: the sum of all non-rejected refunds for this sale must
    // not exceed the sale total. Checked before insert to prevent over-refund.
    const capRows = (await sql`
      SELECT COALESCE(SUM(amount_cents), 0)::bigint AS refunded
      FROM public.orders_refunds
      WHERE client_id = ${clientId}::uuid AND sale_id = ${sale_id}::uuid AND state <> 'rejected'
    `) as Array<{ refunded: string }>;
    const alreadyRefunded = Number(capRows[0]!.refunded);
    if (alreadyRefunded + amount_cents > totalCents) {
      return jsonError(400, 'refund_exceeds_total', {
        already: alreadyRefunded,
        total: totalCents,
        requested: amount_cents,
      });
    }

    const reasonVal = typeof reason === 'string' ? reason : null;

    const inserted = (await sql`
      INSERT INTO public.orders_refunds
        (client_id, sale_id, amount_cents, reason, state, requested_by)
      VALUES
        (${clientId}::uuid, ${sale_id}::uuid, ${amount_cents},
         ${reasonVal}, 'requested', ${userNodeId}::uuid)
      RETURNING id, state
    `) as Array<{ id: string; state: string }>;

    const newRefund = inserted[0]!;

    await logAudit(sql, {
      session: ordersAuditSession(a.ctx),
      op: 'orders.refund.requested',
      clientId,
      targetType: 'sale',
      targetId: sale_id,
      detail: { amount_cents },
    });

    return jsonOk({ id: newRefund.id, state: newRefund.state }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
