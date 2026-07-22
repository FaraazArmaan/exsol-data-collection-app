import { useEffect, useState } from 'react';
import { inventoryApi } from '../../shared/api';
import type { ByLocationData } from '../../shared/types';
import { InventoryTabs } from '../components/InventoryTabs';
import { EmptyState, ErrorState, LoadingState } from '../../../../components/ui/Feedback';
import { Button } from '../../../../components/ui/Button';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// Stock-by-location map, integrated with warehouse_locations. Empty state guides
// the owner to set up warehouse locations; per-location empty state handled too.
export default function LocationMapPage(_props: Props) {
  const [data, setData] = useState<ByLocationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setData(null);
    inventoryApi.byLocation()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    load();
    // One initial request; the retry action above deliberately starts another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="inv-shell">
      <div className="inv-header"><h1 className="inv-title">Inventory</h1></div>
      <InventoryTabs />

      {error ? (
        <ErrorState title="Locations could not load" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</ErrorState>
      ) : !data ? (
        <LoadingState title="Loading stock by location" />
      ) : data && data.locations.length === 0 ? (
        <EmptyState title="No warehouse locations yet.">Add locations in Warehouse to map stock by location.</EmptyState>
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
