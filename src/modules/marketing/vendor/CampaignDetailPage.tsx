import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { marketingApi, type CampaignDetail } from '../shared/api';
import { dateTime } from '../format';

export function CampaignDetailPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const { id = '' } = useParams();
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canSend = perms.has('marketing.customers.edit');

  async function load() {
    try { setError(null); setData(await marketingApi.getCampaign(id)); }
    catch { setError('Could not load this campaign.'); }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setBusy(true); setError(null);
    try { await marketingApi.send(id); await load(); }
    catch { setError('Send failed.'); } finally { setBusy(false); }
  }

  if (error && !data) return <div className="page"><Link to={`/c/${slug}/marketing`}>← Campaigns</Link><div className="error">{error}</div></div>;
  if (!data) return <div className="page"><div className="muted">Loading…</div></div>;
  const { campaign, sends } = data;

  return (
    <div className="page">
      <Link to={`/c/${slug}/marketing`}>← Campaigns</Link>
      <h1 className="page-title">{campaign.name}</h1>
      <p className="muted">Subject: {campaign.subject} · Audience: {campaign.audience === 'recent_30d' ? 'Recent (30d)' : 'All'} · <span className="mkt-status">{campaign.status}</span></p>
      {error && <div className="error">{error}</div>}
      <div className="mkt-preview" dangerouslySetInnerHTML={{ __html: campaign.body_html ?? '' }} />

      {campaign.status === 'draft' && canSend && (
        <p><button className="btn btn-primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send now'}</button></p>
      )}

      <h2>Send log</h2>
      {sends.length === 0 ? <div className="pm-empty">{campaign.status === 'draft' ? 'Not sent yet.' : 'No sends recorded.'}</div> : (
        <table className="pm-table">
          <thead><tr><th>Recipient</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {sends.map((s) => (
              <tr key={s.id}><td>{s.recipient_email}</td><td><span className="mkt-status">{s.status}</span></td><td>{dateTime(s.created_at)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
