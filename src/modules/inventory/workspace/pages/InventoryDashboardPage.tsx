import { useCallback, useEffect, useState } from 'react';
import { inventoryApi } from '../../shared/api';
import type { DashboardData } from '../../shared/types';
import { InventoryTabs } from '../components/InventoryTabs';
import { formatMoney } from '../../../../lib/currency';
import { ErrorState, LoadingState } from '../../../../components/ui/Feedback';
import { Button } from '../../../../components/ui/Button';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

const TYPE_LABEL: Record<string, string> = {
  sale: 'Sale', purchase: 'Purchase', adjustment: 'Adjustment',
  production: 'Production', transfer: 'Transfer', return: 'Return', writeoff: 'Write-off',
};

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: 'danger' | 'ok' }) {
  return (
    <div className={`inv-kpi${tone ? ` inv-kpi-${tone}` : ''}`}>
      <div className="inv-kpi-value">{value}</div>
      <div className="inv-kpi-label">{label}</div>
    </div>
  );
}

// Inventory overview. Every state handled: null=loading, error banner, empty
// panels degrade to friendly copy rather than blank space.
export default function InventoryDashboardPage(_props: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    inventoryApi.dashboard()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="inv-shell">
      <div className="inv-header">
        <h1 className="inv-title">Inventory</h1>
      </div>
      <InventoryTabs />

      {error ? (
        <ErrorState title="Inventory could not load" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</ErrorState>
      ) : !data ? (
        <LoadingState title="Loading inventory overview" />
      ) : data ? (
        <>
          <div className="inv-kpis">
            <Kpi label="SKUs tracked" value={data.kpis.total_skus} />
            <Kpi label="Units on hand" value={data.kpis.total_units} />
            <Kpi
              label="Low on stock"
              value={data.kpis.low_stock_count}
              tone={data.kpis.low_stock_count > 0 ? 'danger' : 'ok'}
            />
            <Kpi label="Movements (30d)" value={data.kpis.movement_volume_30d} />
            {data.kpis.stock_value_minor != null && (
              <Kpi label="Stock value" value={formatMoney(data.kpis.stock_value_minor)} />
            )}
          </div>

          <div className="inv-dash-grid">
            <section className="inv-dash-panel inv-priority-panel">
              <h2 className="inv-dash-h2">Needs attention</h2>
              {data.lowStock.length === 0 ? (
                <p className="inv-muted">Everything is above its reorder level.</p>
              ) : (
                <table className="inv-table">
                  <thead>
                    <tr><th>Product</th><th>SKU</th><th className="inv-num">On hand</th><th className="inv-num">Reorder</th></tr>
                  </thead>
                  <tbody>
                    {data.lowStock.map((r) => (
                      <tr key={r.product_id} className="inv-row-low">
                        <td>{r.name}</td>
                        <td className="inv-muted">{r.sku ?? '—'}</td>
                        <td className="inv-num">{r.qty_on_hand}</td>
                        <td className="inv-num">{r.reorder_level}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="inv-dash-panel">
              <h2 className="inv-dash-h2">Recent movements</h2>
              {data.recentMovements.length === 0 ? (
                <p className="inv-muted">No stock movements yet.</p>
              ) : (
                <ul className="inv-movements">
                  {data.recentMovements.map((m) => (
                    <li key={m.id} className="inv-movement">
                      <span className={`inv-badge inv-badge-${m.qty_delta < 0 ? 'low' : 'ok'}`}>
                        {m.qty_delta > 0 ? `+${m.qty_delta}` : m.qty_delta}
                      </span>
                      <span className="inv-movement-type">{TYPE_LABEL[m.type] ?? m.type}</span>
                      <span className="inv-movement-ref">{m.product_name}</span>
                      <time className="inv-muted" dateTime={m.created_at}>
                        {new Date(m.created_at).toLocaleDateString()}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {data.topValue.length > 0 && (
            <section className="inv-dash-panel inv-dash-wide">
              <h2 className="inv-dash-h2">Highest-value stock (moving-average cost)</h2>
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Product</th><th className="inv-num">On hand</th>
                    <th className="inv-num">Unit cost</th><th className="inv-num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topValue.map((v) => (
                    <tr key={v.product_id}>
                      <td>{v.name}</td>
                      <td className="inv-num">{v.qty_on_hand}</td>
                      <td className="inv-num">{formatMoney(v.unit_cost_minor)}</td>
                      <td className="inv-num">{formatMoney(v.value_minor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
