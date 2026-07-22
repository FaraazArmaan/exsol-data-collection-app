import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { EmptyState, ErrorState, LoadingState } from '../../../../components/ui/Feedback';
import { StatusBadge } from '../../../../components/ui/StatusBadge';
import { TableFrame } from '../../../../components/ui/Table';
import { formatMoney } from '../../../../lib/currency';
import { OrdersApiError, ordersApi } from '../../shared/api';
import type { OrderQueueRow, OrdersQueueData, OrdersOperationalState } from '../../shared/types';

const OPERATIONAL_LABEL: Record<OrdersOperationalState, string> = {
  awaiting_payment: 'Awaiting payment',
  ready_for_fulfilment: 'Ready to fulfil',
  fulfilment_in_progress: 'Fulfilment in progress',
  partially_fulfilled: 'Partially fulfilled',
  remaining_cancelled: 'Remaining cancelled',
  cancelled: 'Cancelled',
  fulfilled: 'Fulfilled',
};

function toneFor(state: OrdersOperationalState): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (state === 'fulfilled') return 'success';
  if (state === 'remaining_cancelled' || state === 'cancelled') return 'warning';
  if (state === 'partially_fulfilled' || state === 'fulfilment_in_progress') return 'info';
  return 'neutral';
}

function queueError(error: unknown): string {
  if (error instanceof OrdersApiError && error.status === 403) return "You don't have permission to view the operations queue.";
  if (error instanceof OrdersApiError && error.status === 412) return 'The Orders module is not enabled for this workspace.';
  return 'The orders queue could not load. Try again.';
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function OrdersQueueTab() {
  const [data, setData] = useState<OrdersQueueData | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OrderQueueRow | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    ordersApi.listQueue({ q: appliedQ, status, channel })
      .then((next) => {
        setData(next);
        setSelected((current) => next.orders.find((row) => row.id === current?.id) ?? null);
      })
      .catch((nextError) => setError(queueError(nextError)))
      .finally(() => setLoading(false));
  }, [appliedQ, channel, status]);

  useEffect(() => { load(); }, [load]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedQ(q.trim());
  }

  function reset() {
    setQ('');
    setAppliedQ('');
    setStatus('');
    setChannel('');
  }

  return (
    <section className="ord-queue" aria-label="Order operations queue">
      <div className="ord-queue__heading">
        <div>
          <h2 className="ord-section-title">Operations queue</h2>
          <p className="ord-muted">Online and pickup sales only. In-store completion remains owned by POS.</p>
        </div>
        <Button variant="secondary" onClick={load} loading={loading} loadingLabel="Refreshing…">Refresh</Button>
      </div>

      <form className="ord-queue__filters" onSubmit={submit}>
        <Field label="Search orders">
          {(props) => <Input {...props} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Order number, customer or phone" />}
        </Field>
        <Field label="Sale status">
          {(props) => <Select {...props} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="paid">Paid</option><option value="pending_payment">Pending payment</option><option value="fulfilled">Fulfilled</option><option value="cancelled">Cancelled</option><option value="refunded">Refunded</option></Select>}
        </Field>
        <Field label="Channel">
          {(props) => <Select {...props} value={channel} onChange={(event) => setChannel(event.target.value)}><option value="">Online and pickup</option><option value="online">Online</option><option value="pickup">Pickup</option></Select>}
        </Field>
        <div className="ord-queue__filter-actions"><Button type="submit">Apply filters</Button><Button type="button" variant="quiet" onClick={reset}>Reset</Button></div>
      </form>

      {loading && <LoadingState title="Loading order operations queue" />}
      {!loading && error && <ErrorState title="Orders queue could not load" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</ErrorState>}
      {!loading && !error && data?.orders.length === 0 && <EmptyState title="No operational orders match these filters.">Completed in-store sales are available in POS history.</EmptyState>}

      {!loading && !error && data && data.orders.length > 0 && (
        <div className="ord-queue__layout">
          <TableFrame caption="Orders requiring operational review" density="compact">
            <thead><tr><th>Order</th><th>Customer</th><th>State</th><th>Progress</th><th className="ord-num">Total</th><th>Created</th><th><span className="ord-sr-only">Open details</span></th></tr></thead>
            <tbody>{data.orders.map((row) => <tr key={row.id} className={selected?.id === row.id ? 'ord-queue__row--selected' : undefined}>
              <td data-label="Order"><strong>#{row.order_no}</strong><span className="ord-queue__subline">{row.channel === 'pickup' ? 'Pickup' : 'Online'}</span></td>
              <td data-label="Customer">{row.customer_name}</td>
              <td data-label="State"><StatusBadge icon="•" label={OPERATIONAL_LABEL[row.operational_state]} tone={toneFor(row.operational_state)} />{row.refund_state && <span className="ord-queue__subline">Refund {row.refund_state}</span>}</td>
              <td data-label="Progress">{row.fulfilled_qty} fulfilled · {row.remaining_qty} remaining{row.cancelled_qty > 0 && ` · ${row.cancelled_qty} cancelled`}</td>
              <td data-label="Total" className="ord-num">{formatMoney(row.total_cents, data.base_currency)}</td>
              <td data-label="Created">{displayDate(row.created_at)}</td>
              <td data-label=""><Button variant="quiet" size="compact" onClick={() => setSelected(row)}>Review</Button></td>
            </tr>)}</tbody>
          </TableFrame>

          {selected && <aside className="ord-queue__detail" aria-label={`Order ${selected.order_no} details`}>
            <div className="ord-queue__detail-heading"><div><p className="ord-queue__eyebrow">Read-only order projection</p><h3>Order #{selected.order_no}</h3></div><Button variant="quiet" size="compact" onClick={() => setSelected(null)}>Close</Button></div>
            <dl className="ord-queue__facts"><div><dt>Customer</dt><dd>{selected.customer_name}</dd></div><div><dt>Channel</dt><dd>{selected.channel === 'pickup' ? 'Pickup' : 'Online'}</dd></div><div><dt>Sale status</dt><dd>{selected.sale_status.replace('_', ' ')}</dd></div><div><dt>Operational state</dt><dd>{OPERATIONAL_LABEL[selected.operational_state]}</dd></div><div><dt>Quantity</dt><dd>{selected.ordered_qty} ordered · {selected.fulfilled_qty} fulfilled · {selected.remaining_qty} remaining</dd></div>{selected.cancelled_qty > 0 && <div><dt>Cancelled remainder</dt><dd>{selected.cancelled_qty}</dd></div>}{selected.refund_state && <div><dt>Refund</dt><dd>{selected.refund_state}</dd></div>}</dl>
            <p className="ord-muted">This projection links to the existing Fulfillments and Returns &amp; Shipments workflows; it does not change sale, stock, or payment records.</p>
          </aside>}
        </div>
      )}
    </section>
  );
}
