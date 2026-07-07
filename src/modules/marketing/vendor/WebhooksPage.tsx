import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { marketingApi, type WebhooksReport, type Campaign } from '../shared/api';
import { dateTime } from '../format';
import '../marketing.css';

export function WebhooksPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const [report, setReport] = useState<WebhooksReport | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [newSecret, setNewSecret] = useState<{ token: string; secret: string } | null>(null);
  const [eventType, setEventType] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const canEdit = perms.has('marketing.customers.edit');

  async function load() {
    try {
      setError(null);
      const [r, cs] = await Promise.all([marketingApi.webhooks(), marketingApi.listCampaigns()]);
      setReport(r);
      setCampaigns(cs.campaigns);
    } catch { setError('Could not load webhooks.'); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createEndpoint() {
    if (!label.trim()) return;
    try {
      const r = await marketingApi.createWebhook(label.trim());
      setNewSecret({ token: r.endpoint.token, secret: r.secret });
      setLabel('');
      await load();
    } catch { setError('Could not create the endpoint.'); }
  }

  async function addTrigger() {
    if (!eventType.trim() || !campaignId) return;
    try {
      await marketingApi.createTrigger(eventType.trim(), campaignId);
      setEventType(''); setCampaignId('');
      await load();
    } catch { setError('Could not add the trigger.'); }
  }

  async function removeTrigger(id: string) {
    try { await marketingApi.deleteTrigger(id); await load(); }
    catch { setError('Could not remove the trigger.'); }
  }

  const webhookUrl = (token: string) => `${window.location.origin}/api/marketing/webhook/${token}`;

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Webhooks</h1>
        <Link className="btn" to={`/c/${slug}/marketing`}>Campaigns</Link>
      </div>
      {error && <div className="error">{error}</div>}
      {!report && !error && <div className="muted">Loading…</div>}

      {report && (
        <>
          {newSecret && (
            <div className="mkt-secret-callout">
              <strong>Save this signing secret now — it won't be shown again.</strong>
              <div><code>{newSecret.secret}</code></div>
              <div className="mkt-hint">POST signed events to <code>{webhookUrl(newSecret.token)}</code> with header <code>x-exsol-signature: HMAC-SHA256(body, secret)</code>.</div>
            </div>
          )}

          <section className="mkt-wh-section">
            <h2>Endpoints</h2>
            {report.endpoints.length === 0 ? (
              <div className="pm-empty">No endpoints yet. Create one to receive signed events.</div>
            ) : (
              <table className="pm-table">
                <thead><tr><th>Label</th><th>URL</th><th>Status</th><th>Created</th></tr></thead>
                <tbody>
                  {report.endpoints.map((e) => (
                    <tr key={e.id}>
                      <td>{e.label}</td>
                      <td><code className="mkt-url">{webhookUrl(e.token)}</code></td>
                      <td>{e.active ? 'Active' : 'Disabled'}</td>
                      <td>{dateTime(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canEdit && (
              <div className="mkt-inline-form">
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Storefront events" />
                <button className="btn" onClick={createEndpoint} disabled={!label.trim()}>Add endpoint</button>
              </div>
            )}
          </section>

          <section className="mkt-wh-section">
            <h2>Triggers</h2>
            {report.triggers.length === 0 ? (
              <div className="pm-empty">No triggers. Map an event type to a campaign to auto-send on inbound events.</div>
            ) : (
              <table className="pm-table">
                <thead><tr><th>Event type</th><th>Sends campaign</th>{canEdit && <th></th>}</tr></thead>
                <tbody>
                  {report.triggers.map((t) => (
                    <tr key={t.id}>
                      <td><code>{t.event_type}</code></td>
                      <td>{t.campaign_name}</td>
                      {canEdit && <td><button className="btn btn-sm" onClick={() => removeTrigger(t.id)}>Remove</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canEdit && (
              <div className="mkt-inline-form">
                <input value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="event_type e.g. abandoned_cart" />
                <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                  <option value="">Select campaign…</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="btn" onClick={addTrigger} disabled={!eventType.trim() || !campaignId}>Add trigger</button>
              </div>
            )}
          </section>

          <section className="mkt-wh-section">
            <h2>Recent events</h2>
            {report.events.length === 0 ? (
              <div className="pm-empty">No events received yet.</div>
            ) : (
              <table className="pm-table">
                <thead><tr><th>Event type</th><th className="mkt-num">Triggered</th><th>When</th></tr></thead>
                <tbody>
                  {report.events.map((e) => (
                    <tr key={e.id}><td><code>{e.event_type}</code></td><td className="mkt-num">{e.triggered_count}</td><td>{dateTime(e.created_at)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
