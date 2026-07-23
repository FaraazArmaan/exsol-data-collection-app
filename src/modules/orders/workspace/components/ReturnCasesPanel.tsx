import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState, PermissionState } from '../../../../components/ui/Feedback';
import { StatusBadge } from '../../../../components/ui/StatusBadge';
import { TableFrame } from '../../../../components/ui/Table';
import { OrdersApiError, ordersApi } from '../../shared/api';
import type { ReturnCaseLine, ReturnCaseRow, ReturnCaseStatus } from '../../shared/types';

interface Props { perms: ReadonlySet<string>; }

const CASE_LABEL: Record<ReturnCaseStatus, string> = {
  requested: 'Awaiting authorisation',
  authorized: 'Authorised',
  refused: 'Refused',
  awaiting_receipt: 'Awaiting receipt',
  closed: 'Closed',
};

function caseTone(status: ReturnCaseStatus): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (status === 'authorized' || status === 'closed') return 'success';
  if (status === 'refused') return 'danger';
  if (status === 'requested' || status === 'awaiting_receipt') return 'warning';
  return 'neutral';
}

function returnError(error: unknown): string {
  if (error instanceof OrdersApiError) {
    if (error.status === 412) return 'The Orders module is not enabled for this workspace.';
    if (error.status === 403) return 'You do not have permission for that return action.';
    if (error.code === 'return_not_decidable') return 'This request changed before your decision. Refresh and review its current state.';
    if (error.code === 'refund_not_requestable') return 'A receipt must be recorded by Inventory before a refund intent can be created.';
  }
  return 'The return case could not be updated. Nothing was changed; try again.';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function refundLabel(line: ReturnCaseLine): string {
  if (!line.refund_id) return 'Refund not requested';
  if (line.provider_refund_status === 'failed') return 'Provider refund failed — review in Payments';
  if (line.refund_state === 'completed' || line.provider_refund_status === 'succeeded') return 'Refund completed';
  if (line.provider_refund_status === 'pending') return 'Refund pending with Payments';
  if (line.refund_state === 'rejected') return 'Refund request rejected';
  return 'Refund intent created';
}

export default function ReturnCasesPanel({ perms }: Props) {
  const canView = perms.has('orders.business.view') || perms.has('orders.business.create');
  const canEdit = perms.has('orders.business.edit');
  const canCreate = perms.has('orders.business.create');
  const [cases, setCases] = useState<ReturnCaseRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusalOpen, setRefusalOpen] = useState(false);
  const [refusalReason, setRefusalReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    ordersApi.listReturnCases()
      .then((next) => {
        setCases(next);
        setSelectedId((current) => next.some((row) => row.id === current) ? current : next[0]?.id ?? null);
      })
      .catch((nextError) => setError(returnError(nextError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = cases.find((row) => row.id === selectedId) ?? null;

  async function decide(to: 'authorized' | 'refused') {
    if (!selected) return;
    if (to === 'refused' && !refusalReason.trim()) {
      setNotice('Add a short refusal reason before refusing this request.');
      return;
    }
    setBusy(to);
    setNotice(null);
    try {
      await ordersApi.advanceReturnCase(selected.id, to, to === 'refused' ? refusalReason.trim() : undefined);
      setNotice(to === 'authorized' ? 'Return authorised. Inventory can now record the physical receipt.' : 'Return refused and recorded in the case history.');
      setRefusalOpen(false);
      setRefusalReason('');
      load();
    } catch (nextError) {
      setNotice(returnError(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function requestRefund(line: ReturnCaseLine) {
    if (!selected) return;
    setBusy(`refund-${line.id}`);
    setNotice(null);
    try {
      await ordersApi.requestReturnRefund(selected.id, line.id, line.reason ?? undefined);
      setNotice('Refund intent recorded. Payments now owns provider submission and final money evidence.');
      load();
    } catch (nextError) {
      setNotice(returnError(nextError));
    } finally {
      setBusy(null);
    }
  }

  if (!canView) return <div className="ord-shell"><PermissionState /></div>;

  return (
    <section className="ord-returns" aria-label="Return case operations">
      <div className="ord-queue__heading">
        <div>
          <h2 className="ord-section-title">Return cases</h2>
          <p className="ord-muted">Orders authorises the customer promise. Inventory and Payments remain the source of physical and money evidence.</p>
        </div>
        <Button variant="secondary" onClick={load} loading={loading} loadingLabel="Refreshing…">Refresh</Button>
      </div>

      {notice && <p className="ord-returns__notice" role="status">{notice}</p>}
      {loading && <LoadingState title="Loading return cases" />}
      {!loading && error && <ErrorState title="Return cases could not load" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</ErrorState>}
      {!loading && !error && cases.length === 0 && <EmptyState title="No return cases yet.">Customer-facing return initiation will appear here once POS and Storefront publish a request.</EmptyState>}

      {!loading && !error && cases.length > 0 && (
        <div className="ord-returns__layout">
          <TableFrame caption="Orders return cases" density="compact">
            <thead><tr><th>Order</th><th>Customer</th><th>Case state</th><th>Requested</th><th><span className="ord-sr-only">Open case</span></th></tr></thead>
            <tbody>{cases.map((row) => <tr key={row.id} className={row.id === selectedId ? 'ord-queue__row--selected' : undefined}>
              <td data-label="Order"><strong>#{row.order_no}</strong></td>
              <td data-label="Customer">{row.customer_name}</td>
              <td data-label="Case state"><StatusBadge icon="•" label={CASE_LABEL[row.status]} tone={caseTone(row.status)} /></td>
              <td data-label="Requested">{formatDate(row.created_at)}</td>
              <td data-label=""><Button variant="quiet" size="compact" onClick={() => { setSelectedId(row.id); setRefusalOpen(false); }}>Review</Button></td>
            </tr>)}</tbody>
          </TableFrame>

          {selected && <aside className="ord-returns__detail" aria-label={`Return case for order ${selected.order_no}`}>
            <div className="ord-queue__detail-heading"><div><p className="ord-queue__eyebrow">Return case</p><h3>Order #{selected.order_no}</h3></div><StatusBadge icon="•" label={CASE_LABEL[selected.status]} tone={caseTone(selected.status)} /></div>
            <dl className="ord-queue__facts"><div><dt>Customer</dt><dd>{selected.customer_name}</dd></div><div><dt>Request reason</dt><dd>{selected.request_reason ?? 'No reason recorded'}</dd></div>{selected.refusal_reason && <div><dt>Refusal reason</dt><dd>{selected.refusal_reason}</dd></div>}</dl>

            {selected.status === 'requested' && canEdit && <div className="ord-returns__decision">
              <p>Review the request before changing the customer promise. Authorising does not restock anything and does not issue money.</p>
              <div className="ord-returns__actions"><Button onClick={() => decide('authorized')} loading={busy === 'authorized'} loadingLabel="Authorising…">Authorise return</Button><Button variant="danger" onClick={() => setRefusalOpen((open) => !open)}>Refuse return</Button></div>
              {refusalOpen && <form className="ord-returns__refusal" onSubmit={(event) => { event.preventDefault(); decide('refused'); }}><label htmlFor="return-refusal-reason">Reason for refusal</label><input id="return-refusal-reason" className="ord-input" value={refusalReason} onChange={(event) => setRefusalReason(event.target.value)} autoFocus /><div className="ord-returns__actions"><Button type="submit" variant="danger" loading={busy === 'refused'} loadingLabel="Refusing…">Confirm refusal</Button><Button type="button" variant="quiet" onClick={() => setRefusalOpen(false)}>Keep request open</Button></div></form>}
            </div>}

            <div className="ord-returns__lines"><h4>Line resolution</h4>{selected.lines.map((line) => <article className="ord-returns__line" key={line.id}><div><strong>{line.qty} item{line.qty === 1 ? '' : 's'} requested</strong><p>{line.reason ?? 'No line reason recorded'}</p></div><dl><div><dt>Inventory</dt><dd>{line.inventory_return_id ? 'Receipt recorded by Inventory' : 'Awaiting Inventory receipt'}</dd></div><div><dt>Payments</dt><dd>{refundLabel(line)}</dd></div></dl>{selected.status === 'authorized' && line.inventory_return_id && !line.refund_id && canCreate && <Button size="compact" onClick={() => requestRefund(line)} loading={busy === `refund-${line.id}`} loadingLabel="Requesting…">Request refund intent</Button>}{selected.status === 'authorized' && !line.inventory_return_id && <p className="ord-muted">Inventory must record the physical receipt before Orders can request a refund.</p>}</article>)}</div>
          </aside>}
        </div>
      )}
    </section>
  );
}
