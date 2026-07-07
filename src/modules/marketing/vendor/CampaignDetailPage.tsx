import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { marketingApi, type CampaignDetail, type AbReport, CHANNEL_LABELS } from '../shared/api';
import { dateTime } from '../format';
import '../marketing.css';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// Winner = highest open rate (tie → higher click rate). Undecided until an open exists.
function isWinner(ab: AbReport, variant: string): boolean {
  const best = [...ab.variants].sort((a, b) => b.open_rate - a.open_rate || b.click_rate - a.click_rate)[0];
  if (!best || best.unique_opens === 0) return false;
  return best.variant === variant;
}

export function CampaignDetailPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const { id = '' } = useParams();
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [ab, setAb] = useState<AbReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canSend = perms.has('marketing.customers.edit');

  async function load() {
    try {
      setError(null);
      const d = await marketingApi.getCampaign(id);
      setData(d);
      // Opens/clicks only exist once sent; fetch the variant compare then.
      if (d.campaign.status === 'sent') marketingApi.abReport(id).then(setAb).catch(() => setAb(null));
    } catch { setError('Could not load this campaign.'); }
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
      <p className="muted">Subject: {campaign.subject} · <span className="mkt-channel">{CHANNEL_LABELS[campaign.channel] ?? campaign.channel}</span> · Audience: {campaign.audience === 'recent_30d' ? 'Recent (30d)' : 'All'} · <span className="mkt-status">{campaign.status}</span></p>
      {error && <div className="error">{error}</div>}
      <div className="mkt-preview" dangerouslySetInnerHTML={{ __html: campaign.body_html ?? '' }} />

      {campaign.status === 'draft' && canSend && (
        <p><button className="btn btn-primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send now'}</button></p>
      )}

      {campaign.status === 'sent' && ab && ab.variants.length > 0 && (
        <section className="mkt-ab-panel">
          <h2>{ab.is_ab ? 'A/B results' : 'Engagement'}</h2>
          <table className="pm-table mkt-ab-table">
            <thead>
              <tr>
                <th>Variant</th><th>Subject</th>
                <th className="mkt-num">Sends</th><th className="mkt-num">Opens</th>
                <th className="mkt-num">Open rate</th><th className="mkt-num">Clicks</th><th className="mkt-num">Click rate</th>
              </tr>
            </thead>
            <tbody>
              {ab.variants.map((v) => (
                <tr key={v.variant} className={ab.is_ab && isWinner(ab, v.variant) ? 'mkt-ab-winner' : ''}>
                  <td>{v.variant === 'all' ? '—' : v.variant}{ab.is_ab && isWinner(ab, v.variant) ? ' 🏆' : ''}</td>
                  <td>{v.variant === 'B' ? (ab.subject_b ?? '—') : ab.subject_a}</td>
                  <td className="mkt-num">{v.sends}</td>
                  <td className="mkt-num">{v.unique_opens}</td>
                  <td className="mkt-num">{pct(v.open_rate)}</td>
                  <td className="mkt-num">{v.unique_clicks}</td>
                  <td className="mkt-num">{pct(v.click_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ab.is_ab && ab.variants.every((v) => v.unique_opens === 0) && (
            <p className="mkt-hint">No opens tracked yet — the winner appears once recipients open the email.</p>
          )}
        </section>
      )}

      <h2>Send log</h2>
      {sends.length === 0 ? <div className="pm-empty">{campaign.status === 'draft' ? 'Not sent yet.' : 'No sends recorded.'}</div> : (
        <table className="pm-table">
          <thead><tr><th>Recipient</th><th>Channel</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {sends.map((s) => (
              <tr key={s.id}><td>{s.recipient_email ?? s.recipient_phone ?? '—'}</td><td><span className="mkt-channel">{CHANNEL_LABELS[s.channel] ?? s.channel}</span></td><td><span className="mkt-status">{s.status}</span></td><td>{dateTime(s.created_at)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
