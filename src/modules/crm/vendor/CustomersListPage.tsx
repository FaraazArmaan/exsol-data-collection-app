import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { crmApi, type CrmCustomer } from '../api';
import { dateOnly } from '../format';

export function CustomersListPage({ slug, perms: _perms }: { slug: string; perms: ReadonlySet<string> }) {
  const [customers, setCustomers] = useState<CrmCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load(query = '') {
    try { setError(null); const r = await crmApi.listCustomers(query); setCustomers(r.customers); }
    catch { setError('Could not load customers.'); setCustomers([]); }
  }
  async function refreshThenLoad() {
    setRefreshing(true);
    try { await crmApi.refresh(); } catch { /* best-effort */ }
    await load(q);
    setRefreshing(false);
  }
  useEffect(() => { refreshThenLoad(); /* on mount */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 className="page-title">Customers</h1>
        <button className="btn" onClick={refreshThenLoad} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <form style={{ display: 'flex', gap: '8px', marginBottom: '16px' }} onSubmit={(e) => { e.preventDefault(); load(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, or email…" />
        <button className="btn" type="submit">Search</button>
      </form>

      {error && <div className="error">{error}</div>}
      {customers === null && <div className="muted">Loading…</div>}
      {customers !== null && customers.length === 0 && !error && (
        <div className="muted" style={{ marginTop: '24px' }}>No customers yet. They appear here after a sale or booking.</div>
      )}
      {customers !== null && customers.length > 0 && (
        <table className="pm-table">
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Source</th><th>Last seen</th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/c/${slug}/crm/${c.id}`}>{c.display_name}</Link></td>
                <td>{c.phone ?? '—'}</td>
                <td>{c.email ?? '—'}</td>
                <td><span className="crm-source-pill">{c.source}</span></td>
                <td>{dateOnly(c.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
