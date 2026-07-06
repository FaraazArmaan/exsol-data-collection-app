import { useEffect, useState, type FormEvent } from 'react';
import { procurementApi, type NewPOItem } from '../../shared/api';
import type { ProductPick, Supplier } from '../../shared/types';

interface Props {
  onClose: () => void;
  onCreated: (id: string) => void;
}

interface DraftLine {
  product_id: string;
  qty: string;
  unit_cost: string; // rupees, string from the input
}

// Create a purchase order: pick a supplier, an optional expected date, and one
// or more line items (product + qty + unit cost). Guards the empty-supplier and
// empty-product cases so the reviewer never hits a dead form.
export function CreatePOModal({ onClose, onCreated }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [products, setProducts] = useState<ProductPick[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [expectedOn, setExpectedOn] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ product_id: '', qty: '1', unit_cost: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([procurementApi.listSuppliers(), procurementApi.listProducts()])
      .then(([s, p]) => { setSuppliers(s.suppliers); setProducts(p.products); })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { product_id: '', qty: '1', unit_cost: '' }]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));

  const parsedItems: NewPOItem[] = lines
    .filter((l) => l.product_id !== '' && Number(l.qty) > 0)
    .map((l) => ({
      product_id: l.product_id,
      qty: Math.trunc(Number(l.qty)),
      unit_cost_cents: Math.max(0, Math.round(Number(l.unit_cost || '0') * 100)),
    }));

  const valid = supplierId !== '' && parsedItems.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await procurementApi.createOrder({
        supplier_id: supplierId, expected_on: expectedOn, notes: '', items: parsedItems,
      });
      onCreated(r.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const loading = suppliers === null || products === null;

  return (
    <div className="proc-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="proc-modal proc-modal-wide" role="dialog" aria-modal="true" aria-labelledby="proc-po-title">
        <div className="proc-modal-header">
          <h2 id="proc-po-title">New purchase order</h2>
          <button type="button" className="proc-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="proc-modal-body">
          {loadError ? (
            <div className="proc-error" role="alert">{loadError}</div>
          ) : loading ? (
            <p className="proc-muted">Loading…</p>
          ) : suppliers!.length === 0 ? (
            <p className="proc-empty">Add a supplier first, then create a purchase order.</p>
          ) : products!.length === 0 ? (
            <p className="proc-empty">No products available to order. Add products in Product Manager first.</p>
          ) : (
            <form onSubmit={submit}>
              <label className="proc-field">
                <span>Supplier <span className="proc-req">*</span></span>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier">
                  <option value="">Select a supplier…</option>
                  {suppliers!.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="proc-field">
                <span>Expected on</span>
                <input type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} aria-label="Expected date" />
              </label>

              <div className="proc-lines">
                <div className="proc-lines-head">
                  <span>Product</span><span className="proc-num">Qty</span><span className="proc-num">Unit cost (₹)</span><span />
                </div>
                {lines.map((l, i) => (
                  <div className="proc-line" key={i}>
                    <select value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })} aria-label={`Product ${i + 1}`}>
                      <option value="">Select…</option>
                      {products!.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
                    </select>
                    <input className="proc-num" type="number" min="1" step="1" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label={`Quantity ${i + 1}`} />
                    <input className="proc-num" type="number" min="0" step="0.01" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} aria-label={`Unit cost ${i + 1}`} />
                    <button type="button" className="proc-icon-btn" aria-label={`Remove line ${i + 1}`} onClick={() => removeLine(i)} disabled={lines.length === 1}>✕</button>
                  </div>
                ))}
                <button type="button" className="proc-link" onClick={addLine}>+ Add line</button>
              </div>

              {error && <div className="proc-error" role="alert">{error}</div>}
              <div className="proc-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
                  {busy ? 'Creating…' : 'Create purchase order'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
