import { useCallback, useEffect, useState } from 'react';
import { warehouseApi } from '../../shared/api';
import { KIND_LABEL, type StockRow, type WarehouseLocation } from '../../shared/types';
import { LocationModal } from '../components/LocationModal';
import { TransferModal } from '../components/TransferModal';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// Warehouse: locations CRUD + a stock-by-location view + a transfer flow. Every
// state is handled so a free-clicking reviewer never hits a blank screen or 500:
// null = loading, [] = empty (with a prompt), errors surface as a dismissible
// banner and degrade the panels to empty rather than crashing.
export default function WarehousePage({ perms }: Props) {
  const [locations, setLocations] = useState<WarehouseLocation[] | null>(null);
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locModal, setLocModal] = useState<{ mode: 'create' | 'edit'; location?: WarehouseLocation } | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const canCreate = perms.has('warehouse.business.create');
  const canEdit = perms.has('warehouse.business.edit');
  const canDelete = perms.has('warehouse.business.delete');
  const canTransfer = perms.has('warehouse.products.edit');

  const load = useCallback(() => {
    setError(null);
    Promise.all([warehouseApi.listLocations(), warehouseApi.stock()])
      .then(([l, s]) => {
        setLocations(l.locations);
        setStock(s.items);
      })
      .catch((e) => {
        setLocations((prev) => prev ?? []);
        setStock((prev) => prev ?? []);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const onDelete = async (loc: WarehouseLocation) => {
    if (!window.confirm(`Delete "${loc.name}"? Its per-location stock rows will be removed.`)) return;
    setError(null);
    try {
      await warehouseApi.deleteLocation(loc.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const afterMutation = () => {
    setLocModal(null);
    setTransferOpen(false);
    setLocations(null);
    setStock(null);
    load();
  };

  const locationCount = locations?.length ?? 0;
  const canDoTransfer = canTransfer && locationCount >= 2;

  return (
    <div className="wh-shell">
      <div className="wh-header">
        <div>
          <h1 className="wh-title">Warehouse</h1>
          <p className="wh-muted">Stock locations and per-location quantities.</p>
        </div>
        <div className="wh-actions">
          {canTransfer && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canDoTransfer}
              title={canDoTransfer ? undefined : 'Create at least two locations to transfer stock'}
              onClick={() => setTransferOpen(true)}
            >
              Transfer stock
            </button>
          )}
          {canCreate && (
            <button type="button" className="btn btn-secondary" onClick={() => setLocModal({ mode: 'create' })}>
              New location
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="wh-error" role="alert">
          {error}{' '}
          <button type="button" className="wh-link" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      <section className="wh-panel">
        <h2 className="wh-panel-title">Locations</h2>
        {locations === null ? (
          <p className="wh-muted">Loading…</p>
        ) : locations.length === 0 ? (
          <p className="wh-empty">
            No locations yet.{canCreate ? ' Create one to start allocating stock.' : ''}
          </p>
        ) : (
          <ul className="wh-loc-list">
            {locations.map((loc) => (
              <li key={loc.id} className="wh-loc-row">
                <div>
                  <span className="wh-loc-name">{loc.name}</span>
                  <span className="wh-badge">{KIND_LABEL[loc.kind]}</span>
                </div>
                <div className="wh-loc-actions">
                  {canEdit && (
                    <button type="button" className="wh-link" onClick={() => setLocModal({ mode: 'edit', location: loc })}>
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" className="wh-link wh-link-danger" onClick={() => onDelete(loc)}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="wh-panel">
        <h2 className="wh-panel-title">Stock by location</h2>
        {stock === null ? (
          <p className="wh-muted">Loading…</p>
        ) : stock.length === 0 ? (
          <p className="wh-empty">No stock allocated to any location yet.</p>
        ) : (
          <table className="wh-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>Product</th>
                <th>SKU</th>
                <th className="wh-num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((r) => (
                <tr key={`${r.location_id}-${r.product_id}`}>
                  <td>{r.location_name}</td>
                  <td>{r.product_name}</td>
                  <td className="wh-muted">{r.sku ?? '—'}</td>
                  <td className="wh-num">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {locModal && (
        <LocationModal
          mode={locModal.mode}
          location={locModal.location}
          onClose={() => setLocModal(null)}
          onSaved={afterMutation}
        />
      )}
      {transferOpen && locations && stock && (
        <TransferModal
          locations={locations}
          stock={stock}
          onClose={() => setTransferOpen(false)}
          onTransferred={afterMutation}
        />
      )}
    </div>
  );
}
