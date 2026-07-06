import { useEffect, useState } from 'react';
import type { ProductPick } from '../../shared/types';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';

interface Row { product_id: string; qty: number; }

export default function BomBuilderModal({ bomId, onClose, onSaved }: { bomId?: string; onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<ProductPick[]>([]);
  const [name, setName] = useState('');
  const [outputId, setOutputId] = useState('');
  const [rows, setRows] = useState<Row[]>([{ product_id: '', qty: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await manufacturingApi.products();
        setProducts(p.items);
        if (bomId) {
          const d = await manufacturingApi.getBom(bomId);
          setName(d.name); setOutputId(d.output_product_id);
          setRows(d.components.map((c) => ({ product_id: c.component_product_id, qty: c.qty })));
        }
      } catch (e) { setError(e instanceof ManufacturingApiError ? e.code : 'load_failed'); }
    })();
  }, [bomId]);

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
        {rows.map((r, i) => (
          <div className="mfg-comp-row" key={i}>
            <select value={r.product_id} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, product_id: e.target.value } : x))}>
              <option value="">— component —</option>
              {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
            </select>
            <input type="number" min={1} value={r.qty} style={{ width: 70 }}
              onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} />
            <button className="mfg-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="mfg-btn" onClick={() => setRows([...rows, { product_id: '', qty: 1 }])}>+ Add component</button>
        {error && <div className="mfg-shortfall">{error}</div>}
        <p style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="mfg-btn" onClick={onClose}>Cancel</button>
          <button className="mfg-btn primary" onClick={() => void save()} disabled={busy}>Save</button>
        </p>
      </div>
    </div>
  );
}
