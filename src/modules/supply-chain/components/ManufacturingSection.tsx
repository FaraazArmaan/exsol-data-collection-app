import { useSupplyChain } from '../hooks/useSupplyChain';
import type { ManufacturingResponse } from '../types';
import { formatCount } from '../format';
import { Section } from './Section';
import { KpiTile } from './KpiTile';

export function ManufacturingSection() {
  const { data, loading, error } = useSupplyChain<ManufacturingResponse>('manufacturing');
  const empty = !!data && data.orders.length === 0;
  return (
    <Section
      title="Manufacturing"
      loading={loading}
      error={error}
      empty={empty}
      emptyText="No in-progress production orders."
    >
      {data && (
        <>
          <div className="sc-kpis">
            <KpiTile label="In-progress orders" value={formatCount(data.kpis.inProgressCount)} />
            <KpiTile label="Units in production" value={formatCount(data.kpis.unitsInProduction)} />
          </div>
          <table className="sc-table">
            <thead>
              <tr><th>Product</th><th>BOM</th><th>Qty</th><th>Started</th></tr>
            </thead>
            <tbody>
              {data.orders.map((r) => (
                <tr key={r.id}>
                  <td>{r.product}</td>
                  <td>{r.bomName}</td>
                  <td>{r.qty}</td>
                  <td>{r.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
