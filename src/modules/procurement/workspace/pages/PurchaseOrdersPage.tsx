import { useCallback, useEffect, useState } from 'react';
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
  const canCreate = perms.has('procurement.products.create');

  const load = useCallback(() => {
    setError(null);
    procurementApi.listOrders()
      .then((r) => setRows(r.orders))
      .catch((e) => { setRows([]); setError(e instanceof Error ? e.message : String(e)); });
  }, []);

  useEffect(() => { load(); }, [load]);

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
