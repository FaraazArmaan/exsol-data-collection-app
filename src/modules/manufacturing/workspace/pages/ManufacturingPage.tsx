import { useCallback, useEffect, useState } from 'react';
import type { BomListItem, ProductionOrder, ProductionStatus } from '../../shared/types';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';
import BomBuilderModal from '../components/BomBuilderModal';
import CreateOrderModal from '../components/CreateOrderModal';
import '../../manufacturing.css';

const NEXT: Record<ProductionStatus, { to: ProductionStatus; label: string }[]> = {
  planned: [{ to: 'in_progress', label: 'Start' }, { to: 'cancelled', label: 'Cancel' }],
  in_progress: [{ to: 'done', label: 'Complete' }, { to: 'cancelled', label: 'Cancel' }],
  done: [],
  cancelled: [],
};

export default function ManufacturingPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const canCreate = perms.has('manufacturing.products.create');
  const canEdit = perms.has('manufacturing.products.edit');
  const [tab, setTab] = useState<'boms' | 'orders'>('boms');
  const [boms, setBoms] = useState<BomListItem[] | null>(null);
  const [orders, setOrders] = useState<ProductionOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bomModal, setBomModal] = useState<{ id?: string } | null>(null);
  const [orderModal, setOrderModal] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, o] = await Promise.all([manufacturingApi.listBoms(), manufacturingApi.listOrders()]);
      setBoms(b.items); setOrders(o.items);
    } catch (e) {
      setError(e instanceof ManufacturingApiError ? e.code : 'load_failed');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const advance = async (id: string, to: ProductionStatus) => {
    setRowError(null);
    try {
      await manufacturingApi.advanceOrder(id, to);
      await load();
    } catch (e) {
      if (e instanceof ManufacturingApiError && e.code === 'insufficient_stock') {
        const sf = (e.detail as any)?.error?.details?.shortfalls ?? [];
        setRowError(sf.length
          ? `Insufficient stock: ${sf.map((s: any) => `${s.name} (need ${s.need}, have ${s.have})`).join(', ')}`
          : 'Insufficient component stock.');
      } else {
        setRowError(e instanceof ManufacturingApiError ? e.code : 'advance_failed');
      }
    }
  };

  return (
    <div className="mfg-page">
      <h1>Manufacturing</h1>
      <div className="mfg-tabs">
        <button className={`mfg-tab ${tab === 'boms' ? 'is-active' : ''}`} onClick={() => setTab('boms')}>BOMs</button>
        <button className={`mfg-tab ${tab === 'orders' ? 'is-active' : ''}`} onClick={() => setTab('orders')}>Production Orders</button>
      </div>

      {error && <div className="mfg-error">Could not load Manufacturing ({error}). <button className="mfg-btn" onClick={() => void load()}>Retry</button></div>}
      {rowError && <div className="mfg-shortfall">{rowError}</div>}

      {tab === 'boms' && !error && (
        <>
          <div className="mfg-toolbar">
            <span>{boms ? `${boms.length} BOM(s)` : 'Loading…'}</span>
            {canCreate && <button className="mfg-btn primary" onClick={() => setBomModal({})}>New BOM</button>}
          </div>
          {boms && boms.length === 0 && <div className="mfg-empty">No BOMs yet. Create one to define what you assemble.</div>}
          {boms && boms.length > 0 && (
            <table className="mfg-table">
              <thead><tr><th>Name</th><th>Output</th><th>Components</th><th></th></tr></thead>
              <tbody>
                {boms.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td><td>{b.output_product_name}</td><td>{b.component_count}</td>
                    <td>{canEdit && <button className="mfg-btn" onClick={() => setBomModal({ id: b.id })}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === 'orders' && !error && (
        <>
          <div className="mfg-toolbar">
            <span>{orders ? `${orders.length} order(s)` : 'Loading…'}</span>
            {canCreate && <button className="mfg-btn primary" onClick={() => setOrderModal(true)}>New Order</button>}
          </div>
          {orders && orders.length === 0 && <div className="mfg-empty">No production orders yet.</div>}
          {orders && orders.length > 0 && (
            <table className="mfg-table">
              <thead><tr><th>Output</th><th>Qty</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.output_product_name}</td><td>{o.qty}</td>
                    <td><span className={`mfg-badge ${o.status}`}>{o.status.replace('_', ' ')}</span></td>
                    <td>{canEdit && NEXT[o.status].map((n) => (
                      <button key={n.to} className="mfg-btn" onClick={() => void advance(o.id, n.to)} style={{ marginRight: 4 }}>{n.label}</button>
                    ))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {bomModal && <BomBuilderModal bomId={bomModal.id} onClose={() => setBomModal(null)} onSaved={() => { setBomModal(null); void load(); }} />}
      {orderModal && <CreateOrderModal boms={boms ?? []} onClose={() => setOrderModal(false)} onSaved={() => { setOrderModal(false); void load(); }} />}
    </div>
  );
}
