// BackordersTab — Backorder queue management (Task 3).
// Lists active and fulfilled backorders, allows per-row qty input to fulfil stock.
// Surfaces insufficient-stock errors inline per row.
import { useEffect, useState } from 'react';
import { ordersApi, OrdersApiError } from '../../shared/api';
import type { BackorderRow, BackorderStatus } from '../../shared/types';

interface Props {
  perms: ReadonlySet<string>;
}

const STATUS_LABEL: Record<BackorderStatus, string> = {
  queued: 'Queued',
  partially_fulfilled: 'Partial',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

function humanError(e: unknown): string {
  if (e instanceof OrdersApiError) {
    if (e.status === 409 && e.code === 'insufficient_stock') {
      const details = (e.detail as { error?: { details?: { have?: number; need?: number } } })?.error?.details;
      if (details) return `Insufficient stock — have ${details.have ?? '?'}, need ${details.need ?? '?'}.`;
      return 'Insufficient stock.';
    }
    if (e.status === 400 && e.code === 'qty_exceeds_remaining') return 'Qty exceeds remaining to fulfil.';
    if (e.status === 412) return 'Orders module not enabled.';
    if (e.status === 403) return 'Permission denied.';
    return `Error: ${e.code}`;
  }
  return 'Network error — please try again.';
}

interface RowState {
  qty: string;
  submitting: boolean;
  error: string | null;
}

export default function BackordersTab({ perms }: Props) {
  const canView   = perms.has('orders.business.view') || perms.has('orders.business.create');
  const canCreate = perms.has('orders.business.create');
  const canEdit   = perms.has('orders.business.edit');

  const [backorders, setBackorders] = useState<BackorderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  // Create form state
  const [newSaleId, setNewSaleId] = useState('');
  const [newProductId, setNewProductId] = useState('');
  const [newQty, setNewQty] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function loadBackorders() {
    setLoading(true);
    ordersApi
      .listBackorders()
      .then((data) => {
        setBackorders(data);
        setError(null);
      })
      .catch((e) => setError(humanError(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadBackorders(); }, []);

  function rowQty(id: string): string { return rowState[id]?.qty ?? ''; }
  function setRowQty(id: string, qty: string) {
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id] ?? { submitting: false, error: null }, qty } }));
  }
  function setRowSubmitting(id: string, submitting: boolean) {
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id] ?? { qty: '', error: null }, submitting } }));
  }
  function setRowError(id: string, err: string | null) {
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id] ?? { qty: '', submitting: false }, error: err } }));
  }

  async function handleFulfil(bo: BackorderRow) {
    const qty = parseInt(rowQty(bo.id), 10);
    if (isNaN(qty) || qty < 1) {
      setRowError(bo.id, 'Enter a positive integer qty.');
      return;
    }
    setRowError(bo.id, null);
    setRowSubmitting(bo.id, true);
    try {
      await ordersApi.fulfillBackorder(bo.id, qty);
      setRowQty(bo.id, '');
      loadBackorders();
    } catch (e) {
      setRowError(bo.id, humanError(e));
    } finally {
      setRowSubmitting(bo.id, false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    const qty = parseInt(newQty, 10);
    if (!newSaleId.trim() || !newProductId.trim() || isNaN(qty) || qty < 1) {
      setCreateError('Sale UUID, Product UUID, and a positive qty are required.');
      return;
    }
    setCreating(true);
    try {
      await ordersApi.createBackorder({ sale_id: newSaleId.trim(), product_id: newProductId.trim(), qty_ordered: qty });
      setNewSaleId('');
      setNewProductId('');
      setNewQty('');
      loadBackorders();
    } catch (e) {
      setCreateError(humanError(e));
    } finally {
      setCreating(false);
    }
  }

  if (!canView) {
    return (
      <div className="ord-shell">
        <p className="ord-muted">You don&rsquo;t have permission to view this section.</p>
      </div>
    );
  }

  return (
    <div className="ord-shell">
      <section className="ord-section">
        <h2 className="ord-section-title">Backorder Queue</h2>

        {canCreate && (
          <form className="ord-form" onSubmit={handleCreate}>
            <div className="ord-form-row">
              <input
                className="ord-input"
                placeholder="Sale UUID"
                value={newSaleId}
                onChange={(e) => setNewSaleId(e.target.value)}
                required
              />
              <input
                className="ord-input"
                placeholder="Product UUID"
                value={newProductId}
                onChange={(e) => setNewProductId(e.target.value)}
                required
              />
              <input
                className="ord-input"
                type="number"
                placeholder="Qty ordered"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                min={1}
                required
              />
              <button className="ord-btn ord-btn-primary" type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create Backorder'}
              </button>
            </div>
            {createError && <p className="ord-form-error">{createError}</p>}
          </form>
        )}

        {loading ? (
          <p className="ord-muted">Loading backorders…</p>
        ) : error ? (
          <div className="ord-error">{error}</div>
        ) : backorders.length === 0 ? (
          <p className="ord-empty">No backorders.</p>
        ) : (
          <table className="ord-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="ord-num">Ordered</th>
                <th className="ord-num">Fulfilled</th>
                <th>Status</th>
                <th>Fulfilled At</th>
                {canEdit && <th>Fulfil</th>}
              </tr>
            </thead>
            <tbody>
              {backorders.map((bo) => {
                const rs = rowState[bo.id] ?? { qty: '', submitting: false, error: null };
                const canFulfil = canEdit && bo.status !== 'fulfilled' && bo.status !== 'cancelled';
                return (
                  <tr key={bo.id}>
                    <td>{bo.product_name_snap}</td>
                    <td className="ord-num">{bo.qty_ordered}</td>
                    <td className="ord-num">{bo.qty_fulfilled}</td>
                    <td>
                      <span className={`ord-badge ord-badge-${bo.status}`}>
                        {STATUS_LABEL[bo.status] ?? bo.status}
                      </span>
                    </td>
                    <td>{bo.fulfilled_at ? new Date(bo.fulfilled_at).toLocaleDateString() : '—'}</td>
                    {canEdit && (
                      <td className="ord-actions">
                        {canFulfil ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <input
                                className="ord-input"
                                type="number"
                                placeholder="Qty"
                                value={rs.qty}
                                onChange={(e) => setRowQty(bo.id, e.target.value)}
                                min={1}
                                max={bo.qty_ordered - bo.qty_fulfilled}
                                style={{ width: 70 }}
                              />
                              <button
                                className="ord-btn ord-btn-sm"
                                onClick={() => handleFulfil(bo)}
                                disabled={rs.submitting}
                              >
                                {rs.submitting ? '…' : 'Fulfil'}
                              </button>
                            </div>
                            {rs.error && <p className="ord-form-error" style={{ margin: 0 }}>{rs.error}</p>}
                          </div>
                        ) : (
                          <span className="ord-muted">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
