import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { crmApi, type CrmDashboard } from '../shared/api';
import { money, dateOnly } from '../format';
import { CrmNav } from '../components/CrmNav';
import '../crm.css';

export function CustomerDashboardPage({ slug }: { slug: string; perms: ReadonlySet<string> }) {
  const [data, setData] = useState<CrmDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    crmApi.dashboard()
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError('Could not load the dashboard.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">CRM</h1>
      <CrmNav slug={slug} />

      {error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading…</div>}

      {!loading && data && (
        <>
          <div className="crm-kpis">
            <Kpi label="Customers" value={String(data.kpis.total_customers)} />
            <Kpi label="Active (bought)" value={String(data.kpis.active_customers)} />
            <Kpi label="Total LTV" value={money(data.kpis.total_ltv_cents)} />
            <Kpi label="Avg LTV" value={money(data.kpis.avg_ltv_cents)} />
            <Kpi label="Avg orders" value={String(data.kpis.avg_txns)} />
            <Kpi label="Repeat rate" value={`${data.kpis.repeat_rate}%`} />
            <Kpi label="New (30d)" value={String(data.kpis.new_last_30d)} />
          </div>

          <h2 className="crm-section-title">Top customers by lifetime value</h2>
          {data.top_customers.length === 0 ? (
            <div className="muted">No customer purchases yet. They appear here after a sale or booking.</div>
          ) : (
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="crm-num">LTV</th>
                  <th className="crm-num">Orders</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {data.top_customers.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/c/${slug}/crm/${c.id}`}>{c.display_name}</Link></td>
                    <td className="crm-num">{money(c.ltv_cents)}</td>
                    <td className="crm-num">{c.txns}</td>
                    <td>{c.last_activity ? dateOnly(c.last_activity) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="crm-kpi">
      <div className="crm-kpi-label">{label}</div>
      <div className="crm-kpi-value">{value}</div>
    </div>
  );
}
