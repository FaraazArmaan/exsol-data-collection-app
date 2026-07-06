import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProcurementApiError, procurementApi } from '../../shared/api';
import type { POAction, PurchaseOrderDetail, PurchaseOrderItem } from '../../shared/types';
import { formatMoney, STATUS_LABEL, STATUS_VARIANT } from '../../shared/format';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// PO detail + FSM actions. Receiving is the golden-flow payoff: it increments
// Inventory stock and stamps the PO received. Every state handled: loading,
// not-found, error, and terminal (received/cancelled) with no actions.
export default function PurchaseOrderDetailPage({ slug, perms }: Props) {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<POAction | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const canEdit = perms.has('procurement.products.edit');
  const canDelete = perms.has('procurement.products.delete');

  const load = useCallback(() => {
    if (!id) return;
    setError(null);
    procurementApi.getOrder(id)
      .then((r) => { setOrder(r.order); setItems(r.items); })
      .catch((e) => {
        if (e instanceof ProcurementApiError && e.status === 404) setNotFound(true);
        else setError(e instanceof Error ? e.message : String(e));
      });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (action: POAction) => {
    if (!id || busy) return;
    setBusy(action);
    setError(null);
    setFlash(null);
    try {
      await procurementApi.transition(id, action);
      if (action === 'receive') setFlash('Received — inventory stock updated.');
      setOrder(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (notFound) {
    return (
      <div className="proc-shell">
        <p className="proc-empty">
          Purchase order not found.{' '}
          <button type="button" className="proc-link" onClick={() => nav(`/c/${slug}/procurement`)}>Back to list</button>
        </p>
      </div>
    );
  }

  const total = items.reduce((sum, it) => sum + Number(it.unit_cost_cents) * it.qty, 0);
  const canReceive = order && (order.status === 'draft' || order.status === 'ordered');
  const canOrder = order && order.status === 'draft';
  const canCancel = order && (order.status === 'draft' || order.status === 'ordered');

  return (
    <div className="proc-shell">
      <div className="proc-header">
        <button type="button" className="proc-link" onClick={() => nav(`/c/${slug}/procurement`)}>← Purchase orders</button>
      </div>

      {error && (
        <div className="proc-error" role="alert">
          {error} <button type="button" className="proc-link" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}
      {flash && <div className="proc-flash" role="status">{flash}</div>}

      {order === null ? (
        <p className="proc-muted">Loading…</p>
      ) : (
        <>
          <div className="proc-po-head">
            <div>
              <h1 className="proc-title">PO — {order.supplier_name}</h1>
              <p className="proc-muted">
                <span className={`proc-badge proc-badge-${STATUS_VARIANT[order.status]}`}>{STATUS_LABEL[order.status]}</span>
                {order.expected_on ? ` · expected ${order.expected_on}` : ''}
                {order.received_at ? ` · received ${new Date(order.received_at).toLocaleString()}` : ''}
              </p>
            </div>
            <div className="proc-po-actions">
              {canEdit && canOrder && (
                <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => doAction('order')}>
                  {busy === 'order' ? '…' : 'Mark ordered'}
                </button>
              )}
              {canEdit && canReceive && (
                <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => doAction('receive')}>
                  {busy === 'receive' ? 'Receiving…' : 'Receive'}
                </button>
              )}
              {canDelete && canCancel && (
                <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => doAction('cancel')}>
                  {busy === 'cancel' ? '…' : 'Cancel'}
                </button>
              )}
            </div>
          </div>

          {items.length === 0 ? (
            <p className="proc-empty">This purchase order has no line items.</p>
          ) : (
            <table className="proc-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="proc-num">Qty</th>
                  <th className="proc-num">Unit cost</th>
                  <th className="proc-num">Line total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.product_name}</td>
                    <td className="proc-num">{it.qty}</td>
                    <td className="proc-num">{formatMoney(it.unit_cost_cents)}</td>
                    <td className="proc-num">{formatMoney(Number(it.unit_cost_cents) * it.qty)}</td>
                  </tr>
                ))}
                <tr className="proc-total-row">
                  <td colSpan={3} className="proc-num">Total</td>
                  <td className="proc-num">{formatMoney(total)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
