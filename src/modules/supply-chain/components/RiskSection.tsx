import { useState, useEffect } from 'react';
import type { RiskItem, RiskResponse } from '../shared/types';
import { fetchRisk } from '../shared/api';
import { Section } from './Section';

const KIND_LABEL: Record<RiskItem['kind'], string> = {
  single_supplier: 'Single Supplier',
  lead_time_collision: 'Lead Time',
  overdue_po: 'Overdue PO',
};

export function RiskSection() {
  const [data, setData] = useState<RiskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRisk()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const empty = !!data && data.risks.length === 0;

  return (
    <Section
      title="Risk Analysis"
      loading={loading}
      error={error}
      empty={empty}
      emptyText="No supply-chain risks detected."
    >
      {data && (
        <>
          <div className="sc-risk-counts">
            <span className="sc-risk-count sc-risk-count-high">{data.counts.high} High</span>
            <span className="sc-risk-count sc-risk-count-medium">{data.counts.medium} Medium</span>
            <span className="sc-risk-count sc-risk-count-low">{data.counts.low} Low</span>
          </div>
          <table className="sc-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Kind</th>
                <th>Title</th>
                <th>Detail</th>
                <th>Alternate</th>
              </tr>
            </thead>
            <tbody>
              {data.risks.map((r) => (
                <tr key={r.id}>
                  <td className={`sc-severity-${r.severity}`}>{r.severity.charAt(0).toUpperCase() + r.severity.slice(1)}</td>
                  <td>{KIND_LABEL[r.kind]}</td>
                  <td>{r.title}</td>
                  <td>{r.detail}</td>
                  <td>
                    {r.suggestedAlternate
                      ? `${r.suggestedAlternate.supplierName} (${r.suggestedAlternate.leadTimeDays}d)`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
