import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getClientBuckets, type BucketSummary, type ClientHeader } from '../api';

export default function ClientDashboard() {
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<ClientHeader | null>(null);
  const [buckets, setBuckets] = useState<BucketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const r = await getClientBuckets(clientId);
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.error.code === 'not_found' ? 'Client not found.' : `Failed to load (${r.error.code}).`);
        return;
      }
      setClient(r.data.client);
      setBuckets(r.data.buckets);
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (!clientId) return <p className="error">Invalid client URL.</p>;
  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!client) return null;

  const created = new Date(client.created_at);

  const loginUrl = `${window.location.origin}/c/${client.slug}/login`;

  return (
    <section>
      <header style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>{client.name}</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            {client.template_label} · created {created.toLocaleDateString()}
          </p>
        </div>
        <Link to={`/clients/${clientId}/settings`} className="btn btn-primary">Manage buckets</Link>
      </header>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>User login URL</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Share this URL with users (owners, employees, etc.) you've created logins for.
        </p>
        <code style={{
          display: 'block', padding: '8px 10px', border: '1px solid var(--border-subtle)',
          borderRadius: 4, fontSize: 13, wordBreak: 'break-all',
          background: 'var(--bg-elevated, #1a1a1a)',
        }}>{loginUrl}</code>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Buckets</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>Role</th>
              <th style={{ padding: '6px 8px' }}>Type</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.role} style={{ borderTop: '1px solid var(--border, #2a2a2a)' }}>
                <td style={{ padding: '8px' }}>{b.label}</td>
                <td style={{ padding: '8px', fontSize: 13 }} className="muted">
                  {b.cardinality === 'singleton' ? 'singleton (max 1)' : 'multi'}
                </td>
                <td style={{ padding: '8px', textAlign: 'right' }}>
                  {b.cardinality === 'singleton' ? `${b.count} / 1` : b.count}
                </td>
              </tr>
            ))}
            {buckets.length === 0 && (
              <tr><td colSpan={3} className="muted" style={{ padding: 12 }}>No roles defined.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
