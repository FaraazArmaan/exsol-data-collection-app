import { useCallback, useEffect, useState } from 'react';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';
import type { ProductionOrder, QcCheck } from '../../shared/types';

interface Props {
  perms: ReadonlySet<string>;
}

// Quality Control: per-order checklists. Recording 'fail' opens a disposition —
// scrap (removes defective output from stock) or rework (flagged for the floor).
export default function QualityTab({ perms }: Props) {
  const [orders, setOrders] = useState<ProductionOrder[] | null>(null);
  const [orderId, setOrderId] = useState('');
  const [checks, setChecks] = useState<QcCheck[] | null>(null);
  const [newItem, setNewItem] = useState('');
  const [failFor, setFailFor] = useState<string | null>(null);
  const [scrapQty, setScrapQty] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const canEdit = perms.has('manufacturing.products.edit');

  useEffect(() => {
    manufacturingApi.listOrders()
      .then((r) => { setOrders(r.items); if (r.items[0]) setOrderId(r.items[0].id); })
      .catch((e) => { setOrders([]); setError(e instanceof ManufacturingApiError ? e.code : String(e)); });
  }, []);

  const loadChecks = useCallback((oid: string) => {
    if (!oid) { setChecks([]); return; }
    setError(null);
    manufacturingApi.qcList(oid)
      .then((r) => setChecks(r.checks))
      .catch((e) => { setChecks([]); setError(e instanceof ManufacturingApiError ? e.code : String(e)); });
  }, []);

  useEffect(() => { loadChecks(orderId); }, [orderId, loadChecks]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); loadChecks(orderId); }
    catch (e) {
      setError(e instanceof ManufacturingApiError && e.code === 'insufficient_stock'
        ? 'Not enough output stock to scrap that quantity.'
        : (e instanceof ManufacturingApiError ? e.code : String(e)));
    }
  };

  const addItem = async () => {
    if (!newItem.trim()) return;
    await act(() => manufacturingApi.qcAdd({ production_order_id: orderId, item: newItem.trim() }));
    setNewItem('');
  };

  const recordFail = async (id: string, disposition: 'scrap' | 'rework') => {
    await act(() => manufacturingApi.qcResult({
      id, result: 'fail', disposition,
      scrap_qty: disposition === 'scrap' ? Math.max(1, Number(scrapQty) || 1) : 0,
    }));
    setFailFor(null);
    setScrapQty('1');
  };

  if (orders === null) return <p className="mfg-empty">Loading…</p>;
  if (orders.length === 0) return <div className="mfg-empty">No production orders yet. Create one to run QC.</div>;

  return (
    <div>
      <div className="mfg-toolbar">
        <label>Order&nbsp;
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.output_product_name} ×{o.qty} ({o.status.replace('_', ' ')})</option>)}
          </select>
        </label>
      </div>

      {error && <div className="mfg-shortfall" role="alert">{error} <button type="button" className="mfg-btn" onClick={() => setError(null)}>dismiss</button></div>}

      {canEdit && (
        <div className="mfg-qc-add">
          <input value={newItem} placeholder="Add a check (e.g. Surface finish)" onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addItem(); }} />
          <button className="mfg-btn primary" onClick={() => void addItem()} disabled={!newItem.trim()}>Add</button>
        </div>
      )}

      {checks === null ? <p className="mfg-empty">Loading…</p>
        : checks.length === 0 ? <div className="mfg-empty">No checks yet for this order.</div>
        : (
          <table className="mfg-table">
            <thead><tr><th>Check</th><th>Result</th><th>Disposition</th><th /></tr></thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.id}>
                  <td>{c.item}</td>
                  <td><span className={`mfg-qc mfg-qc-${c.result}`}>{c.result}</span></td>
                  <td className="mfg-muted">{c.disposition === 'none' ? '—' : c.disposition === 'scrap' ? `scrap ×${c.scrap_qty}` : 'rework'}</td>
                  <td>
                    {canEdit && c.result === 'pending' && failFor !== c.id && (
                      <>
                        <button className="mfg-btn mfg-btn-sm" onClick={() => void act(() => manufacturingApi.qcResult({ id: c.id, result: 'pass' }))}>Pass</button>{' '}
                        <button className="mfg-btn mfg-btn-sm" onClick={() => setFailFor(c.id)}>Fail</button>
                      </>
                    )}
                    {canEdit && failFor === c.id && (
                      <span className="mfg-qc-failform">
                        <input type="number" min={1} style={{ width: 56 }} value={scrapQty} onChange={(e) => setScrapQty(e.target.value)} aria-label="Scrap qty" />
                        <button className="mfg-btn mfg-btn-sm" onClick={() => void recordFail(c.id, 'scrap')}>Scrap</button>
                        <button className="mfg-btn mfg-btn-sm" onClick={() => void recordFail(c.id, 'rework')}>Rework</button>
                        <button className="mfg-btn mfg-btn-sm" onClick={() => setFailFor(null)}>✕</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
