import { useEffect, useState } from 'react';
import { inventoryApi } from '../../shared/api';
import type { ProductLocations, StockRow } from '../../shared/types';

interface Props {
  row: StockRow;
  onClose: () => void;
}

// Warehousing bridge: one product's stock across warehouse locations, next to
// its inventory on-hand total. Loading/error/empty all handled.
export function LocationBreakdownDrawer({ row, onClose }: Props) {
  const [data, setData] = useState<ProductLocations | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inventoryApi.productLocations(row.product_id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [row.product_id]);

  return (
    <div className="inv-drawer-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="inv-drawer" role="dialog" aria-modal="true" aria-labelledby="inv-loc-title">
        <div className="inv-drawer-header">
          <h2 id="inv-loc-title">Locations — {row.name}</h2>
          <button type="button" className="inv-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="inv-drawer-body">
          {error && <div className="inv-error" role="alert">{error}</div>}
          {data === null && !error ? (
            <p className="inv-muted">Loading…</p>
          ) : data ? (
            <>
              <p className="inv-muted">
                On hand: <strong>{data.on_hand}</strong> · Across locations: <strong>{data.location_total}</strong>
              </p>
              {data.by_location.length === 0 ? (
                <p className="inv-empty">Not stocked in any warehouse location.</p>
              ) : (
                <table className="inv-table">
                  <thead>
                    <tr><th>Location</th><th>Kind</th><th className="inv-num">Qty</th></tr>
                  </thead>
                  <tbody>
                    {data.by_location.map((l) => (
                      <tr key={l.location_id}>
                        <td>{l.location_name}</td>
                        <td className="inv-muted">{l.location_kind}</td>
                        <td className="inv-num">{l.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
