import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { marketingApi, type Campaign } from '../api';
import { dateTime } from '../format';

export function CampaignsListPage({ slug }: { slug: string; perms: ReadonlySet<string> }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marketingApi.listCampaigns().then((r) => setCampaigns(r.campaigns)).catch(() => { setError('Could not load campaigns.'); setCampaigns([]); });
  }, []);

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Campaigns</h1>
        <Link className="btn" to={`/c/${slug}/marketing/new`}>New campaign</Link>
      </div>
      {error && <div className="error">{error}</div>}
      {campaigns === null && <div className="muted">Loading…</div>}
      {campaigns !== null && campaigns.length === 0 && !error && (
        <div className="pm-empty">No campaigns yet. Create your first one.</div>
      )}
      {campaigns !== null && campaigns.length > 0 && (
        <table className="pm-table">
          <thead><tr><th>Name</th><th>Audience</th><th>Status</th><th>Sent</th></tr></thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/c/${slug}/marketing/${c.id}`}>{c.name}</Link></td>
                <td>{c.audience === 'recent_30d' ? 'Recent (30d)' : 'All'}</td>
                <td><span className="mkt-status">{c.status}</span></td>
                <td>{c.sent_at ? dateTime(c.sent_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
