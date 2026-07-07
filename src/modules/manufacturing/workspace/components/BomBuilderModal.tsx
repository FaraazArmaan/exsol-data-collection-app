import { useEffect, useState } from 'react';
import type { ProductPick } from '../../shared/types';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';

interface Row { product_id: string; qty: number; }

const money = (cents: number) => `₹${(cents / 100).toFixed(2)}`;

// BOM Designer: the visual builder. Beyond components/quantities it now surfaces a
// live cost rollup — each component's unit cost (editable, persisted per product)
// times its quantity, summed into the assembled cost. Costs live in
// manufacturing_product_costs and are shared across every BOM that uses the part.
export default function BomBuilderModal({ bomId, onClose, onSaved }: { bomId?: string; onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<ProductPick[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [outputId, setOutputId] = useState('');
  const [rows, setRows] = useState<Row[]>([{ product_id: '', qty: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [p, c] = await Promise.all([manufacturingApi.products(), manufacturingApi.costs()]);
        setProducts(p.items);
        setCosts(Object.fromEntries(c.costs.map((x) => [x.product_id, Number(x.unit_cost_cents)])));
        if (bomId) {
          const d = await manufacturingApi.getBom(bomId);
          setName(d.name); setOutputId(d.output_product_id);
          setRows(d.components.map((cc) => ({ product_id: cc.component_product_id, qty: cc.qty })));
        }
      } catch (e) { setError(e instanceof ManufacturingApiError ? e.code : 'load_failed'); }
    })();
  }, [bomId]);

  const setCost = (productId: string, cents: number) => setCosts((prev) => ({ ...prev, [productId]: cents }));
  const persistCost = async (productId: string) => {
    if (!productId) return;
    try { await manufacturingApi.setCost({ product_id: productId, unit_cost_cents: Math.max(0, Math.trunc(costs[productId] ?? 0)) }); }
    catch { /* non-fatal — rollup still reflects the local value */ }
  };

  const rollup = rows.reduce((sum, r) => sum + (r.product_id ? (costs[r.product_id] ?? 0) * r.qty : 0), 0);

  const save = async () => {
    setBusy(true); setError(null);
    const comps = rows.filter((r) => r.product_id && r.qty > 0);
    if (!name.trim() || !outputId || comps.length === 0) { setError('Fill name, output and at least one component.'); setBusy(false); return; }
    try {
      if (bomId) await manufacturingApi.updateBom(bomId, { name: name.trim(), components: comps });
      else await manufacturingApi.createBom({ name: name.trim(), output_product_id: outputId, components: comps });
      onSaved();
    } catch (e) { setError(e instanceof ManufacturingApiError ? e.code : 'save_failed'); setBusy(false); }
  };

  return (
    <div className="mfg-modal-backdrop" onClick={onClose}>
      <div className="mfg-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{bomId ? 'Edit BOM' : 'New BOM'}</h2>
        <label>Name<br /><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <p><label>Output product<br />
          <select value={outputId} onChange={(e) => setOutputId(e.target.value)} disabled={!!bomId}>
            <option value="">— select —</option>
            {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
          </select></label></p>
        <h4>Components</h4>
        <div className="mfg-comp-head">
          <span>Component</span><span>Qty</span><span>Unit cost</span><span>Line</span><span />
        </div>
        {rows.map((r, i) => (
          <div className="mfg-comp-row" key={i}>
            <select value={r.product_id} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, product_id: e.target.value } : x))}>
              <option value="">— component —</option>
              {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
            </select>
            <input type="number" min={1} value={r.qty} style={{ width: 60 }}
              onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} />
            <input type="number" min={0} step={1} style={{ width: 80 }}
              aria-label="Unit cost (cents)"
              value={r.product_id ? (costs[r.product_id] ?? 0) : 0}
              disabled={!r.product_id}
              onChange={(e) => r.product_id && setCost(r.product_id, Math.max(0, Number(e.target.value) || 0))}
              onBlur={() => void persistCost(r.product_id)} />
            <span className="mfg-line-cost">{r.product_id ? money((costs[r.product_id] ?? 0) * r.qty) : '—'}</span>
            <button className="mfg-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="mfg-btn" onClick={() => setRows([...rows, { product_id: '', qty: 1 }])}>+ Add component</button>
        <div className="mfg-rollup">Assembled cost: <strong>{money(rollup)}</strong></div>
        {error && <div className="mfg-shortfall">{error}</div>}
        <p style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="mfg-btn" onClick={onClose}>Cancel</button>
          <button className="mfg-btn primary" onClick={() => void save()} disabled={busy}>Save</button>
        </p>
      </div>
    </div>
  );
}
