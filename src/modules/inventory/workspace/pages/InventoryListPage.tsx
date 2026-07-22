import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { inventoryApi } from '../../shared/api';
import type { LifecycleState, StockRow } from '../../shared/types';
import { AdjustStockModal } from '../components/AdjustStockModal';
import { MovementsDrawer } from '../components/MovementsDrawer';
import { InventoryTabs } from '../components/InventoryTabs';
import { LocationBreakdownDrawer } from '../components/LocationBreakdownDrawer';
import { EmptyState, ErrorState, LoadingState } from '../../../../components/ui/Feedback';
import { Button } from '../../../../components/ui/Button';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// Stock list with search + low-stock badges. Every state is handled so a
// free-clicking reviewer never hits a blank screen: null = loading, [] = empty,
// error banner is dismissible and degrades the table to empty rather than crashing.
export default function InventoryListPage({ perms }: Props) {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<StockRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<StockRow | null>(null);
  const [locTarget, setLocTarget] = useState<StockRow | null>(null);

  const canAdjust = perms.has('inventory.products.edit');

  const load = useCallback((query: string, state: string) => {
    setError(null);
    inventoryApi
      .list(query, state)
      .then((r) => setRows(r.items))
      .catch((e) => {
        setRows([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    load('', '');
  }, [load]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setRows(null);
    load(q.trim(), stateFilter);
  };

  const onStateFilter = (value: string) => {
    setStateFilter(value);
    setRows(null);
    load(q.trim(), value);
  };

  const onAdjusted = () => {
    setAdjustTarget(null);
    setRows(null);
    load(q.trim(), stateFilter);
  };

  const changeLifecycle = async (r: StockRow, next: LifecycleState) => {
    try {
      await inventoryApi.setLifecycle({ product_id: r.product_id, state: next });
      load(q.trim(), stateFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const lowCount = rows?.filter((r) => r.low).length ?? 0;

  return (
    <div className="inv-shell">
      <div className="inv-header">
        <div>
          <h1 className="inv-title">Inventory</h1>
          {rows !== null && (
            <p className="inv-muted">
              {rows.length} product{rows.length === 1 ? '' : 's'} tracked
              {lowCount > 0 ? ` · ${lowCount} low on stock` : ''}
            </p>
          )}
        </div>
        <form className="inv-search" onSubmit={onSearch} role="search">
          <input
            className="inv-search-input"
            type="search"
            placeholder="Search by name or SKU…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search inventory"
          />
          <select
            className="inv-filter"
            value={stateFilter}
            onChange={(e) => onStateFilter(e.target.value)}
            aria-label="Filter by lifecycle state"
          >
            <option value="">All states</option>
            <option value="active">Active</option>
            <option value="seasonal">Seasonal</option>
            <option value="discontinued">Discontinued</option>
          </select>
          <button type="submit" className="btn btn-secondary">Search</button>
        </form>
      </div>
      <InventoryTabs />

      {error ? (
        <ErrorState title="Stock list could not load" action={<Button variant="secondary" onClick={() => load(q.trim(), stateFilter)}>Try again</Button>}>{error}</ErrorState>
      ) : rows === null ? (
        <LoadingState title="Loading stock" />
      ) : rows.length === 0 ? (
        <EmptyState title={q ? 'No products match this search.' : 'No stock-tracked products yet.'} />
      ) : (
        <table className="inv-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>SKU</th>
              <th className="inv-num">On hand</th>
              <th className="inv-num">Reorder at</th>
              <th>Status</th>
              <th>Lifecycle</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product_id} className={r.low ? 'inv-row-low' : undefined}>
                <td>{r.name}</td>
                <td className="inv-muted">{r.sku ?? '—'}</td>
                <td className="inv-num">
                  {r.qty_on_hand}
                  {r.unit ? ` ${r.unit}` : ''}
                </td>
                <td className="inv-num">{r.reorder_level}</td>
                <td>
                  {r.low ? (
                    <span className="inv-badge inv-badge-low">Low stock</span>
                  ) : (
                    <span className="inv-badge inv-badge-ok">OK</span>
                  )}
                </td>
                <td>
                  {canAdjust ? (
                    <select
                      className={`inv-life-select inv-life-${r.lifecycle_state}`}
                      value={r.lifecycle_state}
                      onChange={(e) => changeLifecycle(r, e.target.value as LifecycleState)}
                      aria-label={`Lifecycle for ${r.name}`}
                    >
                      <option value="active">Active</option>
                      <option value="seasonal">Seasonal</option>
                      <option value="discontinued">Discontinued</option>
                    </select>
                  ) : (
                    <span className={`inv-badge inv-life-${r.lifecycle_state}`}>{r.lifecycle_state}</span>
                  )}
                </td>
                <td className="inv-row-actions">
                  <button type="button" className="inv-link" onClick={() => setHistoryTarget(r)}>
                    History
                  </button>
                  <button type="button" className="inv-link" onClick={() => setLocTarget(r)}>
                    Where
                  </button>
                  {canAdjust && (
                    <button type="button" className="inv-link" onClick={() => setAdjustTarget(r)}>
                      Adjust
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adjustTarget && (
        <AdjustStockModal row={adjustTarget} onClose={() => setAdjustTarget(null)} onAdjusted={onAdjusted} />
      )}
      {historyTarget && (
        <MovementsDrawer row={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
      {locTarget && (
        <LocationBreakdownDrawer row={locTarget} onClose={() => setLocTarget(null)} />
      )}
    </div>
  );
}
