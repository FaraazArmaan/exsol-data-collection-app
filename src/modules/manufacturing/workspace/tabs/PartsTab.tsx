import { useCallback, useEffect, useState } from 'react';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';
import type { ConsumptionLot, ProductionOrder, ProductPick } from '../../shared/types';

interface Props {
  perms: ReadonlySet<string>;
}

// Part Tracking: record which component lots went into an order, then trace an order
// back to its lots or a lot forward to every order it fed (recall support).
export default function PartsTab({ perms }: Props) {
  const [orders, setOrders] = useState<ProductionOrder[] | null>(null);
  const [products, setProducts] = useState<ProductPick[]>([]);
  const [orderId, setOrderId] = useState('');
  const [componentId, setComponentId] = useState('');
  const [lotRef, setLotRef] = useState('');
  const [qty, setQty] = useState('1');
  const [traceLot, setTraceLot] = useState('');
  const [lots, setLots] = useState<ConsumptionLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = perms.has('manufacturing.products.edit');

  useEffect(() => {
    Promise.all([manufacturingApi.listOrders(), manufacturingApi.products()])
      .then(([o, p]) => { setOrders(o.items); setProducts(p.items); if (o.items[0]) setOrderId(o.items[0].id); })
      .catch((e) => { setOrders([]); setError(e instanceof ManufacturingApiError ? e.code : String(e)); });
  }, []);

  const loadByOrder = useCallback((oid: string) => {
    if (!oid) { setLots([]); return; }
    setError(null); setTraceLot('');
    manufacturingApi.lotsByOrder(oid).then((r) => setLots(r.lots)).catch((e) => { setLots([]); setError(e instanceof ManufacturingApiError ? e.code : String(e)); });
  }, []);

  useEffect(() => { loadByOrder(orderId); }, [orderId, loadByOrder]);

  const searchLot = async () => {
    if (!traceLot.trim()) return;
    setError(null);
    try { setLots((await manufacturingApi.lotsByRef(traceLot.trim())).lots); }
    catch (e) { setLots([]); setError(e instanceof ManufacturingApiError ? e.code : String(e)); }
  };

  const record = async () => {
    if (!orderId || !componentId || !lotRef.trim()) { setError('Pick an order, component and lot reference.'); return; }
    setError(null);
    try {
      await manufacturingApi.recordLot({ production_order_id: orderId, component_product_id: componentId, lot_ref: lotRef.trim(), qty: Math.max(1, Number(qty) || 1) });
      setLotRef(''); setQty('1');
      loadByOrder(orderId);
    } catch (e) { setError(e instanceof ManufacturingApiError ? e.code : String(e)); }
  };

  if (orders === null) return <p className="mfg-empty">Loading…</p>;
  if (orders.length === 0) return <div className="mfg-empty">No production orders yet.</div>;

  return (
    <div>
      {error && <div className="mfg-shortfall" role="alert">{error} <button type="button" className="mfg-btn" onClick={() => setError(null)}>dismiss</button></div>}

      {canEdit && (
        <div className="mfg-lot-form">
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)} aria-label="Order">
            {orders.map((o) => <option key={o.id} value={o.id}>{o.output_product_name} ×{o.qty}</option>)}
          </select>
          <select value={componentId} onChange={(e) => setComponentId(e.target.value)} aria-label="Component">
            <option value="">— component —</option>
            {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
          </select>
          <input placeholder="Lot / batch ref" value={lotRef} onChange={(e) => setLotRef(e.target.value)} />
          <input type="number" min={1} style={{ width: 70 }} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Qty" />
          <button className="mfg-btn primary" onClick={() => void record()}>Record lot</button>
        </div>
      )}

      <div className="mfg-toolbar">
        <label>Trace order&nbsp;
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.output_product_name} ×{o.qty}</option>)}
          </select>
        </label>
        <span className="mfg-trace-search">
          <input placeholder="…or trace a lot ref" value={traceLot} onChange={(e) => setTraceLot(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void searchLot(); }} />
          <button className="mfg-btn" onClick={() => void searchLot()} disabled={!traceLot.trim()}>Trace lot</button>
        </span>
      </div>

      {lots === null ? <p className="mfg-empty">Loading…</p>
        : lots.length === 0 ? <div className="mfg-empty">No lots recorded {traceLot ? `for "${traceLot}"` : 'for this order'}.</div>
        : (
          <table className="mfg-table">
            <thead><tr><th>Lot / batch</th><th>Component</th><th>Qty</th><th>Into order</th></tr></thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.id}>
                  <td><code>{l.lot_ref}</code></td>
                  <td>{l.component_name}</td>
                  <td>{l.qty}</td>
                  <td className="mfg-muted">{l.output_product_name} <span className={`mfg-badge ${l.order_status}`}>{l.order_status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
