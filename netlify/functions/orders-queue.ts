// GET /api/orders/queue — Orders-owned operational projection of post-sale work.
//
// This deliberately reads POS sale snapshots rather than duplicating or mutating
// them. Fulfillment/cancellation quantities are derived from their durable Orders
// records; the displayed operational state is therefore a label, not another sale
// status column.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders } from './_orders-authz';

export const config = { path: '/api/orders/queue', method: 'GET' };

const SALE_STATUSES = new Set(['pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded']);
const CHANNELS = new Set(['online', 'pickup']);

type QueueRow = {
  id: string;
  order_no: string | number;
  status: string;
  channel: string;
  customer_name: string;
  total_cents: string | number;
  created_at: string;
  paid_at: string | null;
  ordered_qty: string | number;
  fulfilled_qty: string | number;
  cancelled_qty: string | number;
  active_fulfillments: string | number;
  refund_state: string | null;
};

function operationalState(row: { status: string; orderedQty: number; fulfilledQty: number; cancelledQty: number; activeFulfillments: number }): string {
  if (row.cancelledQty > 0) return row.fulfilledQty > 0 ? 'remaining_cancelled' : 'cancelled';
  if (row.orderedQty > 0 && row.fulfilledQty >= row.orderedQty) return 'fulfilled';
  if (row.fulfilledQty > 0) return 'partially_fulfilled';
  if (row.activeFulfillments > 0) return 'fulfilment_in_progress';
  return row.status === 'pending_payment' ? 'awaiting_payment' : 'ready_for_fulfilment';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireOrders(req, ['orders.business.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? '';
  const channel = url.searchParams.get('channel') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim();
  const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
  if ((status && !SALE_STATUSES.has(status)) || (channel && !CHANNELS.has(channel)) || q.length > 120 || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    return jsonError(400, 'invalid_query');
  }

  const sql = db();
  const search = `%${q}%`;
  const rows = (await sql`
    SELECT
      sale.id,
      sale.order_no,
      sale.status,
      sale.channel,
      sale.customer_name,
      sale.total_cents,
      sale.created_at,
      sale.paid_at,
      COALESCE((
        SELECT SUM(line.qty)::int
        FROM public.sale_lines AS line
        WHERE line.sale_id = sale.id
      ), 0)::int AS ordered_qty,
      COALESCE((
        SELECT SUM(fulfillment_line.qty)::int
        FROM public.orders_fulfillment_lines AS fulfillment_line
        JOIN public.orders_fulfillments AS fulfillment ON fulfillment.id = fulfillment_line.fulfillment_id
        WHERE fulfillment.sale_id = sale.id
          AND fulfillment.status IN ('shipped'::fulfillment_status, 'fulfilled'::fulfillment_status)
      ), 0)::int AS fulfilled_qty,
      COALESCE((
        SELECT SUM(cancellation_line.qty)::int
        FROM public.orders_fulfillment_cancellation_lines AS cancellation_line
        JOIN public.orders_fulfillment_cancellations AS cancellation ON cancellation.id = cancellation_line.cancellation_id
        WHERE cancellation.sale_id = sale.id
      ), 0)::int AS cancelled_qty,
      COALESCE((
        SELECT COUNT(*)::int
        FROM public.orders_fulfillments AS fulfillment
        WHERE fulfillment.sale_id = sale.id
          AND fulfillment.status IN ('pending'::fulfillment_status, 'picked'::fulfillment_status, 'packed'::fulfillment_status)
      ), 0)::int AS active_fulfillments,
      (
        SELECT refund.state::text
        FROM public.orders_refunds AS refund
        WHERE refund.sale_id = sale.id
        ORDER BY refund.created_at DESC
        LIMIT 1
      ) AS refund_state
    FROM public.sales AS sale
    WHERE sale.bucket_id = ${a.ctx.clientId}::uuid
      AND sale.channel IN ('online'::sale_channel, 'pickup'::sale_channel)
      AND (${status === ''}::boolean OR sale.status::text = ${status})
      AND (${channel === ''}::boolean OR sale.channel::text = ${channel})
      AND (
        ${q === ''}::boolean
        OR sale.customer_name ILIKE ${search}
        OR sale.customer_phone ILIKE ${search}
        OR sale.order_no::text = ${q}
      )
    ORDER BY
      CASE sale.status WHEN 'paid'::sale_status THEN 0 WHEN 'pending_payment'::sale_status THEN 1 ELSE 2 END,
      sale.created_at ASC
    LIMIT ${requestedLimit}
  `) as QueueRow[];

  const currencyRows = (await sql`
    SELECT base_currency FROM public.clients WHERE id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as Array<{ base_currency: string }>;

  return jsonOk({
    base_currency: currencyRows[0]?.base_currency ?? 'USD',
    orders: rows.map((row) => {
      const orderedQty = Number(row.ordered_qty);
      const fulfilledQty = Number(row.fulfilled_qty);
      const cancelledQty = Number(row.cancelled_qty);
      return {
        id: row.id,
        order_no: Number(row.order_no),
        sale_status: row.status,
        channel: row.channel,
        customer_name: row.customer_name,
        total_cents: Number(row.total_cents),
        created_at: row.created_at,
        paid_at: row.paid_at,
        ordered_qty: orderedQty,
        fulfilled_qty: fulfilledQty,
        cancelled_qty: cancelledQty,
        remaining_qty: Math.max(0, orderedQty - fulfilledQty - cancelledQty),
        operational_state: operationalState({ status: row.status, orderedQty, fulfilledQty, cancelledQty, activeFulfillments: Number(row.active_fulfillments) }),
        refund_state: row.refund_state,
      };
    }),
  });
}
