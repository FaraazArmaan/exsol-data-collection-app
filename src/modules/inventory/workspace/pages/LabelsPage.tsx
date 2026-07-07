import { useEffect, useState } from 'react';
import { inventoryApi } from '../../shared/api';
import type { WarehouseLocation } from '../../shared/types';
import { InventoryTabs } from '../components/InventoryTabs';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Label generator. The PDF endpoints are plain same-origin GETs (cookie auth),
// so anchors open/download them directly. Shelf labels are per warehouse location.
export default function LabelsPage(_props: Props) {
  const [locations, setLocations] = useState<WarehouseLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inventoryApi.byLocation()
      .then((d) => setLocations(d.locations))
      .catch((e) => { setLocations([]); setError(msg(e)); });
  }, []);

  return (
    <div className="inv-shell">
      <div className="inv-header"><h1 className="inv-title">Inventory</h1></div>
      <InventoryTabs />

      {error && <div className="inv-error" role="alert">{error}</div>}

      <section className="inv-dash-panel">
        <h2 className="inv-dash-h2">Product labels</h2>
        <p className="inv-muted">
          A printable sheet of every stock-tracked product with its SKU, on-hand quantity and reorder level.
        </p>
        <a className="btn btn-primary" href="/api/inventory/labels?kind=product" target="_blank" rel="noopener noreferrer">
          Download product labels (PDF)
        </a>
      </section>

      <section className="inv-dash-panel inv-dash-wide">
        <h2 className="inv-dash-h2">Shelf labels by location</h2>
        {locations === null ? (
          <p className="inv-muted">Loading…</p>
        ) : locations.length === 0 ? (
          <p className="inv-muted">No warehouse locations yet — add locations in the Warehouse module to print shelf labels.</p>
        ) : (
          <ul className="inv-label-locs">
            {locations.map((l) => (
              <li key={l.id}>
                <span>{l.name}</span>
                <a
                  className="inv-link"
                  href={`/api/inventory/labels?kind=shelf&location_id=${encodeURIComponent(l.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Shelf labels (PDF)
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
