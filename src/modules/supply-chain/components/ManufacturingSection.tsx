import { useState, Fragment } from 'react';
import { useSupplyChain } from '../hooks/useSupplyChain';
import type { ManufacturingResponse } from '../shared/types';
import { formatCount } from '../format';
import { Section } from './Section';
import { KpiTile } from './KpiTile';
import { DrillPanel } from './DrillPanel';

export function ManufacturingSection() {
  const { data, loading, error } = useSupplyChain<ManufacturingResponse>('manufacturing');
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
                <Fragment key={r.id}>
                  <tr
                    className={`sc-row-clickable${expandedId === r.id ? ' sc-row-selected' : ''}`}
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  >
                    <td>{r.product}</td>
                    <td>{r.bomName}</td>
                    <td>{r.qty}</td>
                    <td>{r.createdAt}</td>
                  </tr>
                  {expandedId === r.id && (
                    <DrillPanel
                      type="production-bom"
                      id={r.id}
                      onClose={() => setExpandedId(null)}
                      colSpan={4}
                    />
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
