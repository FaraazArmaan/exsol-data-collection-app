import { useSupplyChain } from '../hooks/useSupplyChain';
import type { ProcurementResponse } from '../shared/types';
import { formatCount, formatCents } from '../format';
import { Section } from './Section';
import { KpiTile } from './KpiTile';

export function ProcurementSection() {
  const { data, loading, error } = useSupplyChain<ProcurementResponse>('procurement');
  const empty = !!data && data.openPos.length === 0;
  return (
    <Section
      title="Procurement"
      loading={loading}
      error={error}
      empty={empty}
      emptyText="No open purchase orders."
    >
      {data && (
        <>
          <div className="sc-kpis">
            <KpiTile label="Open purchase orders" value={formatCount(data.kpis.openPoCount)} />
            <KpiTile label="Open PO value" value={formatCents(data.kpis.openValueCents)} />
          </div>
          <table className="sc-table">
            <thead>
              <tr><th>Supplier</th><th>Expected</th><th>Items</th><th>Total</th></tr>
            </thead>
            <tbody>
              {data.openPos.map((r) => (
                <tr key={r.id}>
                  <td>{r.supplier}</td>
                  <td>{r.expectedOn ?? '—'}</td>
                  <td>{r.itemCount}</td>
                  <td>{formatCents(r.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
