// POST /api/orders/refund-advance/:id — approve/reject an Orders refund request.
// Approval records a pending provider-refund ledger entry; only the signed provider
// webhook may complete the refund or change the sale to refunded.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';
import { createRazorpayRefund, getRazorpayTestConnection, RazorpayProviderError } from './_payments-razorpay';

export const config = { path: '/api/orders/refund-advance/:id', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string {
  return new URL(req.url).pathname.split('/').pop() ?? '';
}

type RefundRow = { id: string; state: string; sale_id: string };
type PendingRefund = { id: string; amount_minor: string; currency: string; provider_payment_id: string; sale_id: string };

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;
  const { clientId } = a.ctx;

  let body: { to?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
  if (typeof body.to !== 'string') return jsonError(400, 'invalid_body');
  if (body.to !== 'approved' && body.to !== 'rejected') return jsonError(409, 'illegal_transition');

  const sql = db();
  const refunds = (await sql`
    SELECT id, state, sale_id
    FROM public.orders_refunds
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
    LIMIT 1
  `) as RefundRow[];
  const refund = refunds[0];
  if (!refund) return jsonError(404, 'not_found');
  if (refund.state !== 'requested') return jsonError(409, 'illegal_transition');

  if (body.to === 'rejected') {
    await sql`
      UPDATE public.orders_refunds
      SET state = 'rejected'::refund_state
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid AND state = 'requested'::refund_state
    `;
    await logAudit(sql, {
      session: ordersAuditSession(a.ctx), op: 'orders.refund.rejected', clientId,
      targetType: 'refund', targetId: id, detail: { to: 'rejected' },
    });
    return jsonOk({ id, state: 'rejected', sale_refunded: false });
  }

  const connection = await getRazorpayTestConnection(clientId);
  if (!connection) return jsonError(409, 'razorpay_not_configured');

  const pending = (await sql`
    WITH refund AS (
      SELECT id, client_id, sale_id, amount_cents
      FROM public.orders_refunds
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid AND state = 'requested'::refund_state
      FOR UPDATE
    ), capture AS (
      SELECT t.id, t.provider, t.provider_transaction_id, t.currency
      FROM public.payment_transactions t
      JOIN public.payment_allocations a ON a.transaction_id = t.id
      JOIN public.payment_requests p ON p.id = a.request_id
      JOIN refund r ON r.sale_id = p.source_id
      LEFT JOIN public.payment_transactions prior
        ON prior.refund_of_transaction_id = t.id
        AND prior.kind = 'provider_refunded'
        AND prior.status IN ('pending', 'succeeded')
      WHERE p.source_type = 'sale'
        AND t.client_id = r.client_id
        AND t.kind = 'provider_captured'
        AND t.status = 'succeeded'
        AND t.provider = 'razorpay'
        AND t.provider_transaction_id IS NOT NULL
      GROUP BY t.id, t.provider, t.provider_transaction_id, t.currency, t.amount_minor, r.amount_cents
      HAVING t.amount_minor - COALESCE(SUM(prior.amount_minor), 0)::bigint >= r.amount_cents
      ORDER BY t.id
      LIMIT 1
    ), ledger AS (
      INSERT INTO public.payment_transactions
        (client_id, kind, status, amount_minor, currency, provider, orders_refund_id, refund_of_transaction_id)
      SELECT r.client_id, 'provider_refunded', 'pending', r.amount_cents, c.currency, c.provider, r.id, c.id
      FROM refund r CROSS JOIN capture c
      RETURNING id, amount_minor, currency, refund_of_transaction_id
    ), approved AS (
      UPDATE public.orders_refunds r
      SET state = 'approved'::refund_state
      FROM ledger
      WHERE r.id = ${id}::uuid AND r.state = 'requested'::refund_state
      RETURNING r.sale_id
    )
    SELECT l.id, l.amount_minor, l.currency, c.provider_transaction_id AS provider_payment_id, a.sale_id
    FROM ledger l
    JOIN capture c ON c.id = l.refund_of_transaction_id
    CROSS JOIN approved a
  `) as PendingRefund[];
  const ledger = pending[0];
  if (!ledger) return jsonError(409, 'refund_requires_captured_payment');

  let providerRefund: { id: string; amount: number; currency: string; status: string };
  try {
    providerRefund = await createRazorpayRefund({
      connection,
      paymentId: ledger.provider_payment_id,
      amountMinor: Number(ledger.amount_minor),
      receipt: `refund_${id.replace(/-/g, '')}`,
      notes: { orders_refund_id: id, sale_id: ledger.sale_id },
    });
  } catch (error) {
    if (error instanceof RazorpayProviderError && error.outcomeKnown) {
      await sql`
        WITH failed AS (
          UPDATE public.payment_transactions
          SET status = 'failed'
          WHERE id = ${ledger.id}::uuid AND status = 'pending'
          RETURNING orders_refund_id
        )
        UPDATE public.orders_refunds r
        SET state = 'requested'::refund_state
        FROM failed
        WHERE r.id = failed.orders_refund_id AND r.state = 'approved'::refund_state
      `;
      return jsonError(409, 'razorpay_refund_rejected');
    }
    await logAudit(sql, {
      session: ordersAuditSession(a.ctx), op: 'orders.refund.provider_outcome_unknown', clientId,
      targetType: 'refund', targetId: id, detail: { transaction_id: ledger.id },
    });
    return jsonError(502, 'razorpay_refund_outcome_unknown');
  }

  await sql`
    UPDATE public.payment_transactions
    SET provider_transaction_id = ${providerRefund.id}
    WHERE id = ${ledger.id}::uuid AND status = 'pending'
  `;
  if (providerRefund.amount !== Number(ledger.amount_minor) || providerRefund.currency !== ledger.currency) {
    return jsonError(502, 'razorpay_refund_response_invalid');
  }
  if (providerRefund.status === 'failed') {
    await sql`
      WITH failed AS (
        UPDATE public.payment_transactions
        SET status = 'failed'
        WHERE id = ${ledger.id}::uuid AND status = 'pending'
        RETURNING orders_refund_id
      )
      UPDATE public.orders_refunds r
      SET state = 'requested'::refund_state
      FROM failed
      WHERE r.id = failed.orders_refund_id AND r.state = 'approved'::refund_state
    `;
    return jsonError(409, 'razorpay_refund_rejected');
  }

  await logAudit(sql, {
    session: ordersAuditSession(a.ctx), op: 'orders.refund.approved', clientId,
    targetType: 'refund', targetId: id,
    detail: { transaction_id: ledger.id, provider_refund_id: providerRefund.id },
  });
  return jsonOk({ id, state: 'approved', provider_pending: true, sale_refunded: false });
}
