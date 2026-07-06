import { useMemo, useState, type FormEvent } from 'react';
import { warehouseApi } from '../../shared/api';
import type { StockRow, WarehouseLocation } from '../../shared/types';

interface Props {
  locations: WarehouseLocation[];
  stock: StockRow[];
  onClose: () => void;
  onTransferred: () => void;
}

// Move stock between two locations. The source product list is derived from the
// already-loaded stock (only products with qty > 0 at the chosen source), so the
// reviewer can only pick a valid transfer — no dead ends.
export function TransferModal({ locations, stock, onClose, onTransferred }: Props) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Products available at the source (qty > 0).
  const sourceProducts = useMemo(
    () => stock.filter((s) => s.location_id === fromId && s.qty > 0),
    [stock, fromId],
  );
  const selected = sourceProducts.find((s) => s.product_id === productId) ?? null;
  const available = selected?.qty ?? 0;
  const qtyNum = Number(qty);

  const valid =
    fromId !== '' && toId !== '' && productId !== '' && fromId !== toId &&
    Number.isInteger(qtyNum) && qtyNum > 0 && qtyNum <= available;

  const onFromChange = (id: string) => {
    setFromId(id);
    setProductId('');
    setQty('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await warehouseApi.transfer({
        product_id: productId, from_location_id: fromId, to_location_id: toId, qty: qtyNum,
      });
      onTransferred();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="wh-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wh-modal" role="dialog" aria-modal="true" aria-label="Transfer stock">
        <h2 className="wh-modal-title">Transfer stock</h2>
        <form onSubmit={submit}>
          <label className="wh-field">
            <span>From</span>
            <select className="wh-input" value={fromId} onChange={(e) => onFromChange(e.target.value)} autoFocus>
              <option value="">Select source…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>

          {fromId !== '' && sourceProducts.length === 0 ? (
            <p className="wh-empty">This location has no stock to transfer.</p>
          ) : (
            <label className="wh-field">
              <span>Product</span>
              <select
                className="wh-input"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                disabled={fromId === ''}
              >
                <option value="">{fromId === '' ? 'Choose a source first' : 'Select product…'}</option>
                {sourceProducts.map((s) => (
                  <option key={s.product_id} value={s.product_id}>
                    {s.product_name} ({s.qty} available)
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="wh-field">
            <span>To</span>
            <select className="wh-input" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Select destination…</option>
              {locations.filter((l) => l.id !== fromId).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>

          <label className="wh-field">
            <span>Quantity{selected ? ` (max ${available})` : ''}</span>
            <input
              className="wh-input"
              type="number"
              min={1}
              max={available || undefined}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              disabled={!selected}
              placeholder="0"
            />
          </label>

          {error && <p className="wh-error" role="alert">{error}</p>}
          <div className="wh-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
              {busy ? 'Transferring…' : 'Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
