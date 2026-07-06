import { useSupplyChain } from '../hooks/useSupplyChain';
import type { InventoryResponse } from '../types';
import { formatCount } from '../format';
import { Section } from './Section';
import { KpiTile } from './KpiTile';
import { MovementChart } from './MovementChart';

export function InventorySection() {
  const { data, loading, error } = useSupplyChain<InventoryResponse>('inventory');
  const empty = !!data && data.lowStock.length === 0 && data.movementSeries.every((p) => p.volume === 0);
  return (
    <Section
      title="Inventory"
      loading={loading}
      error={error}
      empty={empty}
      emptyText="No low-stock items and no recent movements."
    >
      {data && (
        <>
          <div className="sc-kpis">
            <KpiTile label="Low-stock items" value={formatCount(data.kpis.lowStockCount)} />
            <KpiTile label="30-day movement volume" value={formatCount(data.kpis.movementVolume30d)} />
          </div>
          <MovementChart series={data.movementSeries} />
          {data.lowStock.length === 0 ? (
            <p className="sc-note">All tracked items are above their reorder level.</p>
          ) : (
            <table className="sc-table">
              <thead>
                <tr><th>Product</th><th>SKU</th><th>On hand</th><th>Reorder</th><th>Deficit</th></tr>
              </thead>
              <tbody>
                {data.lowStock.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.name}</td>
                    <td>{r.sku ?? '—'}</td>
                    <td>{r.qtyOnHand}</td>
                    <td>{r.reorderLevel}</td>
                    <td className="sc-deficit">{r.deficit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Section>
  );
}
