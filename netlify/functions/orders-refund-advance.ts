// POST /api/orders/refund-advance/:id — advance refund state machine.
//
// Legal transitions:
//   requested → approved | rejected
//   approved  → completed
//
// On completed + full amount: guarded UPDATE to sales.status='refunded'
// via ALLOWED_FROM['refund'] = ['paid','fulfilled']. If the sale is not in
// one of those states (e.g. pending_payment), the refund still completes
// but sale_refunded=false is returned — no rollback, no 409.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';
import { ALLOWED_FROM } from './_pos-fsm';

export const config = { path: '/api/orders/refund-advance/:id', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string {
  return new URL(req.url).pathname.split('/').pop() ?? '';
}

// Legal next-states per current state
const LEGAL: Readonly<Record<string, readonly string[]>> = {
  requested: ['approved', 'rejected'],
  approved: ['completed'],
};

type RefundRow = {
  id: string;
  state: string;
  amount_cents: string; // BIGINT → string from Neon
  sale_id: string;
  total_cents: string;  // BIGINT → string from Neon
};

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;
  const { clientId } = a.ctx;

  let body: { to?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }

  const { to } = body;
  if (typeof to !== 'string') return jsonError(400, 'invalid_body');

  const sql = db();

  // Load refund + sale, scoped by client
  const rows = (await sql`
    SELECT r.id, r.state, r.amount_cents, r.sale_id, s.total_cents
    FROM public.orders_refunds r
    JOIN public.sales s ON s.id = r.sale_id
    WHERE r.id = ${id}::uuid AND r.client_id = ${clientId}::uuid
    LIMIT 1
  `) as RefundRow[];

  if (!rows[0]) return jsonError(404, 'not_found');

  const refund = rows[0];
  const legalNext = LEGAL[refund.state] ?? [];

  if (!legalNext.includes(to)) return jsonError(409, 'illegal_transition');

  let saleRefunded = false;

  if (to === 'completed') {
    // Build transaction: refund UPDATE always first; sale UPDATE appended when full-refund.
    // Using sql.transaction([...]) array form so a DB error on the sale UPDATE cannot leave
    // the refund marked completed while the sale is untouched.
    const fullRefund = Number(refund.amount_cents) === Number(refund.total_cents);
    const canRefund = ALLOWED_FROM['refund']; // ['paid', 'fulfilled']
    const queries = [
      sql`
        UPDATE public.orders_refunds
        SET state = 'completed', completed_at = now(), updated_at = now()
        WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      `,
    ];
    let saleIdx = -1;
    if (fullRefund) {
      saleIdx = queries.length;
      queries.push(
        sql`
          UPDATE public.sales
          SET status = 'refunded', refunded_at = now()
          WHERE id = ${refund.sale_id}::uuid
            AND bucket_id = ${clientId}::uuid
            AND status = ANY(${canRefund as string[]}::sale_status[])
          RETURNING id
        `,
      );
    }
    const results = await sql.transaction(queries);
    // 0-row sale UPDATE means sale was not in paid/fulfilled; refund still completes.
    saleRefunded = saleIdx >= 0 ? (results[saleIdx] as unknown[]).length > 0 : false;
  } else {
    await sql`
      UPDATE public.orders_refunds
      SET state = ${to}
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
    `;
  }

  await logAudit(sql, {
    session: ordersAuditSession(a.ctx),
    op: `orders.refund.${to}`,
    clientId,
    targetType: 'refund',
    targetId: id,
    detail: { to, sale_refunded: saleRefunded },
  });

  return jsonOk({ id, state: to, sale_refunded: saleRefunded });
}
