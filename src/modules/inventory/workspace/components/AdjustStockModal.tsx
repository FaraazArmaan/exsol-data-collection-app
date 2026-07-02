import { useState, type FormEvent } from 'react';
import { inventoryApi } from '../../shared/api';
import type { StockRow } from '../../shared/types';

interface Props {
  row: StockRow;
  onClose: () => void;
  onAdjusted: () => void;
}

// Adjust-stock modal. A reason is required (the ledger's audit trail depends on
// it). The quantity change is a signed delta: +N restock, -N shrinkage/count fix.
export function AdjustStockModal({ row, onClose, onAdjusted }: Props) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deltaNum = Number(delta);
  const valid = delta.trim() !== '' && Number.isInteger(deltaNum) && deltaNum !== 0 && reason.trim().length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await inventoryApi.adjust({ product_id: row.product_id, qty_delta: deltaNum, reason: reason.trim() });
      onAdjusted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="inv-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="inv-modal" role="dialog" aria-modal="true" aria-labelledby="inv-adjust-title">
        <div className="inv-modal-header">
          <h2 id="inv-adjust-title">Adjust stock — {row.name}</h2>
          <button type="button" className="inv-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <form className="inv-modal-body" onSubmit={submit}>
          <p className="inv-muted">
            On hand: <strong>{row.qty_on_hand}</strong>. Enter a change — <code>+10</code> to
            restock, <code>-3</code> for shrinkage.
          </p>
          <label className="inv-field">
            <span>Quantity change</span>
            <input
              type="number"
              step="1"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              autoFocus
              aria-label="Quantity change"
            />
          </label>
          <label className="inv-field">
            <span>
              Reason <span className="inv-req">*</span>
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Restock, damage, count correction…"
              aria-label="Reason"
            />
          </label>
          {error && (
            <div className="inv-error" role="alert">{error}</div>
          )}
          <div className="inv-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
              {busy ? 'Saving…' : 'Save adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
