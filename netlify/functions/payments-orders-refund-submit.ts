// Payments owns the provider command. Orders supplies only an approved refund request.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requirePayments } from './_payments-authz';
import { createRazorpayRefund, getRazorpayTestConnection, RazorpayProviderError } from './_payments-razorpay';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';

export const config = { path: '/api/payments/orders-refunds/:id/submit', method: 'POST' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2] ?? '';
  if (!UUID.test(id)) return jsonError(404, 'not_found');
  const a = await requirePayments(req, ['payments.customers.edit']);
  if (!a.ok) return a.res;
  const connection = await getRazorpayTestConnection(a.ctx.clientId);
  if (!connection) return jsonError(409, 'razorpay_not_configured');
  const sql = db();
  const rows = await sql`
    WITH refund AS (
      SELECT id, client_id, sale_id, amount_cents
      FROM public.orders_refunds
      WHERE id=${id}::uuid AND client_id=${a.ctx.clientId}::uuid AND state='requested'::refund_state
      FOR UPDATE
    ), capture AS (
      SELECT t.id, t.provider, t.provider_transaction_id, t.currency
      FROM public.payment_transactions t
      JOIN public.payment_allocations allocation ON allocation.transaction_id=t.id
      JOIN public.payment_requests request ON request.id=allocation.request_id
      JOIN refund r ON r.sale_id=request.source_id
      LEFT JOIN public.payment_transactions prior
        ON prior.refund_of_transaction_id=t.id
        AND prior.kind='provider_refunded'
        AND prior.status IN ('pending','succeeded')
      WHERE request.source_type='sale'
        AND t.client_id=r.client_id
        AND t.kind='provider_captured'
        AND t.status='succeeded'
        AND t.provider='razorpay'
        AND t.provider_transaction_id IS NOT NULL
      GROUP BY t.id, t.provider, t.provider_transaction_id, t.currency, t.amount_minor, r.amount_cents
      HAVING t.amount_minor-COALESCE(SUM(prior.amount_minor),0)::bigint >= r.amount_cents
      ORDER BY t.id
      LIMIT 1
    ), ledger AS (
      INSERT INTO public.payment_transactions (client_id,kind,status,amount_minor,currency,provider,orders_refund_id,refund_of_transaction_id)
      SELECT r.client_id,'provider_refunded','pending',r.amount_cents,c.currency,c.provider,r.id,c.id
      FROM refund r CROSS JOIN capture c
      RETURNING id,amount_minor,currency,refund_of_transaction_id
    ), approved AS (
      UPDATE public.orders_refunds r SET state='approved'::refund_state
      FROM ledger WHERE r.id=${id}::uuid AND r.state='requested'::refund_state
      RETURNING r.sale_id
    )
    SELECT l.id,l.amount_minor,l.currency,c.provider_transaction_id,a.sale_id
    FROM ledger l JOIN capture c ON c.id=l.refund_of_transaction_id CROSS JOIN approved a
  ` as Array<{id:string;amount_minor:string;currency:string;provider_transaction_id:string;sale_id:string}>;
  const row = rows[0];
  if (!row) return jsonError(409, 'refund_requires_captured_payment');
  try {
    const provider = await createRazorpayRefund({ connection, paymentId: row.provider_transaction_id, amountMinor: Number(row.amount_minor), receipt: `refund_${id.replace(/-/g, '')}`, notes: { orders_refund_id:id, sale_id:row.sale_id } });
    await sql`UPDATE public.payment_transactions SET provider_transaction_id=${provider.id} WHERE id=${row.id}::uuid AND status='pending'`;
    if (provider.amount !== Number(row.amount_minor) || provider.currency !== row.currency) return jsonError(502, 'razorpay_refund_response_invalid');
    if (provider.status === 'failed') {
      await resetRejectedRefund(sql, row.id);
      return jsonError(409, 'razorpay_refund_rejected');
    }
    await logAudit(sql, { session: { kind:'bucket_user', user_node_id:a.ctx.userNodeId, client_id:a.ctx.clientId, level_number:a.ctx.levelNumber }, op:'payments.orders_refund.submitted', clientId:a.ctx.clientId, targetType:'refund', targetId:id, detail:{ transaction_id:row.id, provider_refund_id:provider.id } });
    return jsonOk({ id, state:'approved', provider_pending:true });
  } catch (error) {
    if (error instanceof RazorpayProviderError && error.outcomeKnown) {
      await resetRejectedRefund(sql, row.id);
      return jsonError(409, 'razorpay_refund_rejected');
    }
    await logAudit(sql, { session: { kind:'bucket_user', user_node_id:a.ctx.userNodeId, client_id:a.ctx.clientId, level_number:a.ctx.levelNumber }, op:'payments.orders_refund.provider_outcome_unknown', clientId:a.ctx.clientId, targetType:'refund', targetId:id, detail:{ transaction_id:row.id } });
    return jsonError(502, 'razorpay_refund_outcome_unknown');
  }
}

async function resetRejectedRefund(sql: ReturnType<typeof db>, transactionId: string) {
  await sql`
    WITH failed AS (
      UPDATE public.payment_transactions SET status='failed'
      WHERE id=${transactionId}::uuid AND status='pending'
      RETURNING orders_refund_id
    )
    UPDATE public.orders_refunds r SET state='requested'::refund_state
    FROM failed WHERE r.id=failed.orders_refund_id AND r.state='approved'::refund_state
  `;
}
