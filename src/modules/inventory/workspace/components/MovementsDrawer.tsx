import { useEffect, useState } from 'react';
import { inventoryApi } from '../../shared/api';
import type { Movement, StockRow } from '../../shared/types';

interface Props {
  row: StockRow;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  sale: 'Sale',
  purchase: 'Purchase',
  adjustment: 'Adjustment',
  production: 'Production',
  transfer: 'Transfer',
};

// Per-product movement history. States: null = loading, [] = empty, error banner.
export function MovementsDrawer({ row, onClose }: Props) {
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inventoryApi
      .movements(row.product_id)
      .then((r) => setMovements(r.movements))
      .catch((e) => {
        setMovements([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [row.product_id]);

  return (
    <div
      className="inv-drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="inv-drawer" role="dialog" aria-modal="true" aria-labelledby="inv-hist-title">
        <div className="inv-drawer-header">
          <h2 id="inv-hist-title">Movements — {row.name}</h2>
          <button type="button" className="inv-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="inv-drawer-body">
          {error && (
            <div className="inv-error" role="alert">{error}</div>
          )}
          {movements === null ? (
            <p className="inv-muted">Loading…</p>
          ) : movements.length === 0 ? (
            <p className="inv-empty">No movements recorded yet.</p>
          ) : (
            <ul className="inv-movements">
              {movements.map((m) => (
                <li key={m.id} className="inv-movement">
                  <span className={`inv-badge inv-badge-${m.qty_delta < 0 ? 'low' : 'ok'}`}>
                    {m.qty_delta > 0 ? `+${m.qty_delta}` : m.qty_delta}
                  </span>
                  <span className="inv-movement-type">{TYPE_LABEL[m.type] ?? m.type}</span>
                  {m.ref && <span className="inv-movement-ref">{m.ref}</span>}
                  <time className="inv-muted" dateTime={m.created_at}>
                    {new Date(m.created_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
