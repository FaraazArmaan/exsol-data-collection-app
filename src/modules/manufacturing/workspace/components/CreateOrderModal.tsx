import { useState } from 'react';
import type { BomListItem } from '../../shared/types';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';

export default function CreateOrderModal({ boms, onClose, onSaved }: { boms: BomListItem[]; onClose: () => void; onSaved: () => void }) {
  const [bomId, setBomId] = useState('');
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!bomId || qty <= 0) { setError('Pick a BOM and a positive quantity.'); return; }
    setBusy(true); setError(null);
    try { await manufacturingApi.createOrder({ bom_id: bomId, qty }); onSaved(); }
    catch (e) { setError(e instanceof ManufacturingApiError ? e.code : 'save_failed'); setBusy(false); }
  };

  return (
    <div className="mfg-modal-backdrop" onClick={onClose}>
      <div className="mfg-modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Production Order</h2>
        {boms.length === 0 && <div className="mfg-empty">Create a BOM first.</div>}
        <p><label>BOM<br />
          <select value={bomId} onChange={(e) => setBomId(e.target.value)}>
            <option value="">— select —</option>
            {boms.map((b) => <option key={b.id} value={b.id}>{b.name} → {b.output_product_name}</option>)}
          </select></label></p>
        <p><label>Quantity<br />
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} /></label></p>
        {error && <div className="mfg-shortfall">{error}</div>}
        <p style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="mfg-btn" onClick={onClose}>Cancel</button>
          <button className="mfg-btn primary" onClick={() => void save()} disabled={busy || boms.length === 0}>Create</button>
        </p>
      </div>
    </div>
  );
}
