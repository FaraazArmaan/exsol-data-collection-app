import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { procurementApi } from '../../shared/api';
import type { PriceHistoryRow, ProductPick, Supplier, SupplierPrice } from '../../shared/types';
import { formatMoney } from '../../../../lib/currency';

interface Props {
  supplier: Supplier;
  canEdit: boolean;
  onClose: () => void;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Per-supplier price manager: current price per product + set-price form + a
// per-product price history. Prices default PO lines (see CreatePOModal).
export function SupplierPricesModal({ supplier, canEdit, onClose }: Props) {
  const [prices, setPrices] = useState<SupplierPrice[] | null>(null);
  const [products, setProducts] = useState<ProductPick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [productId, setProductId] = useState('');
  const [cost, setCost] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyOf, setHistoryOf] = useState<{ name: string } | null>(null);
  const [history, setHistory] = useState<PriceHistoryRow[] | null>(null);

  const load = useCallback(() => {
    setError(null);
    procurementApi.listPrices(supplier.id).then((r) => setPrices(r.prices)).catch((e) => { setPrices([]); setError(msg(e)); });
    procurementApi.listProducts().then((r) => setProducts(r.products)).catch(() => setProducts([]));
  }, [supplier.id]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = Number(cost);
    if (!productId || cost === '' || !(c >= 0) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await procurementApi.setPrice({
        supplier_id: supplier.id, product_id: productId,
        unit_cost_cents: Math.round(c * 100), effective_from: effectiveFrom || undefined,
      });
      setProductId(''); setCost(''); setEffectiveFrom('');
      setPrices(null);
      load();
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (p: SupplierPrice) => {
    setHistoryOf({ name: p.product_name });
    setHistory(null);
    try {
      setHistory((await procurementApi.priceHistory(supplier.id, p.product_id)).history);
    } catch (e) {
      setError(msg(e));
      setHistory([]);
    }
  };

  return (
    <div className="proc-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="proc-modal proc-modal-wide" role="dialog" aria-modal="true" aria-labelledby="proc-prices-title">
        <div className="proc-modal-header">
          <h2 id="proc-prices-title">Prices — {supplier.name}</h2>
          <button type="button" className="proc-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="proc-modal-body">
          {error && <div className="proc-error" role="alert">{error}</div>}

          {prices === null ? (
            <p className="proc-muted">Loading…</p>
          ) : prices.length === 0 ? (
            <p className="proc-empty">No prices set for this supplier yet.</p>
          ) : (
            <table className="proc-table">
              <thead>
                <tr><th>Product</th><th className="proc-num">Unit cost</th><th>Since</th><th aria-label="History" /></tr>
              </thead>
              <tbody>
                {prices.map((p) => (
                  <tr key={p.product_id}>
                    <td>{p.product_name}</td>
                    <td className="proc-num">{formatMoney(Number(p.unit_cost_cents))}</td>
                    <td className="proc-muted">{p.effective_from}</td>
                    <td><button type="button" className="proc-link" onClick={() => openHistory(p)}>History</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {historyOf && (
            <div className="proc-price-history">
              <h3 className="proc-subhead">History — {historyOf.name}</h3>
              {history === null ? (
                <p className="proc-muted">Loading…</p>
              ) : history.length === 0 ? (
                <p className="proc-muted">No history.</p>
              ) : (
                <ul className="proc-contacts">
                  {history.map((h) => (
                    <li key={h.id} className="proc-contact">
                      <span>{formatMoney(Number(h.unit_cost_cents))}</span>
                      <span className="proc-muted">from {h.effective_from}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {canEdit && (
            <form className="proc-price-form" onSubmit={submit}>
              <h3 className="proc-subhead">Set a price</h3>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Product">
                <option value="">Select a product…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
              </select>
              <input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Unit cost (₹)" aria-label="Unit cost" />
              <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} aria-label="Effective from" />
              <button type="submit" className="btn btn-primary" disabled={busy || !productId || cost === ''}>
                {busy ? 'Saving…' : 'Set price'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
