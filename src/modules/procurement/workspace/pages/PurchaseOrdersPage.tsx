import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { procurementApi } from '../../shared/api';
import type { PurchaseOrderRow } from '../../shared/types';
import { formatMoney, STATUS_LABEL, STATUS_VARIANT } from '../../shared/format';
import { ProcurementTabs } from '../ProcurementTabs';
import { CreatePOModal } from '../components/CreatePOModal';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// Purchase-order list. null=loading, []=empty, error banner. Rows open the detail.
export default function PurchaseOrdersPage({ slug, perms }: Props) {
  const nav = useNavigate();
  const [rows, setRows] = useState<PurchaseOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdInput, setThresholdInput] = useState('');
  const canCreate = perms.has('procurement.products.create');
  const canEdit = perms.has('procurement.products.edit');

  const load = useCallback(() => {
    setError(null);
    procurementApi.listOrders()
      .then((r) => setRows(r.orders))
      .catch((e) => { setRows([]); setError(e instanceof Error ? e.message : String(e)); });
    procurementApi.getSettings().then((s) => setThreshold(s.po_approval_threshold_cents)).catch(() => setThreshold(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveThreshold = async (e: FormEvent) => {
    e.preventDefault();
    const cents = Math.max(0, Math.round(Number(thresholdInput || '0') * 100));
    try {
      const r = await procurementApi.setSettings({ po_approval_threshold_cents: cents });
      setThreshold(r.po_approval_threshold_cents);
      setEditingThreshold(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onCreated = (id: string) => { setCreating(false); nav(`/c/${slug}/procurement/orders/${id}`); };

  return (
    <div className="proc-shell">
      <div className="proc-header">
        <h1 className="proc-title">Procurement</h1>
        {canCreate && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New purchase order</button>
        )}
      </div>
      <ProcurementTabs />

      {threshold !== null && (
        <div className="proc-threshold">
          {editingThreshold ? (
            <form className="proc-threshold-edit" onSubmit={saveThreshold}>
              <span className="proc-muted">POs over ₹</span>
              <input
                type="number" min="0" step="0.01" value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)} aria-label="Approval threshold"
              />
              <span className="proc-muted">require approval</span>
              <button type="submit" className="btn btn-primary">Save</button>
              <button type="button" className="proc-link" onClick={() => setEditingThreshold(false)}>Cancel</button>
            </form>
          ) : (
            <span className="proc-muted">
              {threshold > 0 ? `POs over ${formatMoney(threshold)} require approval. ` : 'No PO approval required. '}
              {canEdit && (
                <button
                  type="button" className="proc-link"
                  onClick={() => { setThresholdInput((threshold / 100).toString()); setEditingThreshold(true); }}
                >
                  Edit threshold
                </button>
              )}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="proc-error" role="alert">
          {error} <button type="button" className="proc-link" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {rows === null ? (
        <p className="proc-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="proc-empty">No purchase orders yet. {canCreate ? 'Create one to restock from a supplier.' : ''}</p>
      ) : (
        <table className="proc-table">
          <thead>
            <tr>
              <th>Supplier</th><th>Status</th>
              <th className="proc-num">Items</th><th className="proc-num">Total</th>
              <th>Expected</th><th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {rows.map((po) => (
              <tr key={po.id} className="proc-row-click" onClick={() => nav(`/c/${slug}/procurement/orders/${po.id}`)}>
                <td>{po.supplier_name}</td>
                <td><span className={`proc-badge proc-badge-${STATUS_VARIANT[po.status]}`}>{STATUS_LABEL[po.status]}</span></td>
                <td className="proc-num">{po.item_count}</td>
                <td className="proc-num">{formatMoney(po.total_cents)}</td>
                <td className="proc-muted">{po.expected_on ?? '—'}</td>
                <td className="proc-link">View →</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && <CreatePOModal onClose={() => setCreating(false)} onCreated={onCreated} />}
    </div>
  );
}
