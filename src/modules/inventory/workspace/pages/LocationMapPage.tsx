import { useEffect, useState } from 'react';
import { inventoryApi } from '../../shared/api';
import type { ByLocationData } from '../../shared/types';
import { InventoryTabs } from '../components/InventoryTabs';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// Stock-by-location map, integrated with warehouse_locations. Empty state guides
// the owner to set up warehouse locations; per-location empty state handled too.
export default function LocationMapPage(_props: Props) {
  const [data, setData] = useState<ByLocationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inventoryApi.byLocation()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="inv-shell">
      <div className="inv-header"><h1 className="inv-title">Inventory</h1></div>
      <InventoryTabs />

      {error && <div className="inv-error" role="alert">{error}</div>}

      {!data && !error ? (
        <p className="inv-muted">Loading…</p>
      ) : data && data.locations.length === 0 ? (
        <p className="inv-empty">
          No warehouse locations yet. Add locations in the Warehouse module to map stock by location.
        </p>
      ) : data ? (
        <div className="inv-loc-grid">
          {data.locations.map((loc) => {
            const items = data.items.filter((i) => i.location_id === loc.id);
            return (
              <section key={loc.id} className="inv-loc-card">
                <div className="inv-loc-head">
                  <h2 className="inv-dash-h2">{loc.name}</h2>
                  <span className="inv-badge inv-badge-ok">{loc.kind}</span>
                </div>
                {items.length === 0 ? (
                  <p className="inv-muted">No stock recorded here.</p>
                ) : (
                  <table className="inv-table">
                    <thead>
                      <tr><th>Product</th><th>SKU</th><th className="inv-num">Qty</th></tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.product_id}>
                          <td>{it.product_name}</td>
                          <td className="inv-muted">{it.sku ?? '—'}</td>
                          <td className="inv-num">{it.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
