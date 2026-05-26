import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getClientBuckets, type BucketSummary } from '../api';
import { BucketPanel } from '../components/BucketPanel';

export default function ClientSettings() {
  const { clientId } = useParams<{ clientId: string }>();
  const [clientName, setClientName] = useState<string>('');
  const [buckets, setBuckets] = useState<BucketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    const r = await getClientBuckets(clientId);
    setLoading(false);
    if (!r.ok) {
      setError(`Failed to load: ${r.error.code}`);
      return;
    }
    setClientName(r.data.client.name);
    setBuckets(r.data.buckets);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) return <p className="error">Invalid client URL.</p>;

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>{clientName || 'Client'}</h1>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Settings</p>
      </header>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && buckets.map((bucket, i) => (
        <BucketPanel
          key={bucket.role}
          clientId={clientId}
          bucket={bucket}
          initialOpen={i < 2}
          onChange={refresh}
        />
      ))}
    </section>
  );
}
