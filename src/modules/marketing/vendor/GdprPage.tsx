import { useState } from 'react';
import { Link } from 'react-router-dom';
import { marketingApi, type ConsentEntry, type ConsentChannel, type ErasureAffected } from '../shared/api';
import { dateTime } from '../format';
import '../marketing.css';

export function GdprPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const [email, setEmail] = useState('');
  const [active, setActive] = useState('');            // the email currently loaded
  const [consent, setConsent] = useState<ConsentEntry[] | null>(null);
  const [channel, setChannel] = useState<ConsentChannel>('all');
  const [confirmErase, setConfirmErase] = useState(false);
  const [erased, setErased] = useState<ErasureAffected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = perms.has('marketing.customers.edit');
  const canDelete = perms.has('marketing.customers.delete');

  async function lookup() {
    const e = email.trim();
    if (!e) return;
    setError(null); setErased(null); setConfirmErase(false);
    try {
      const r = await marketingApi.gdprConsentHistory(e);
      setConsent(r.consent);
      setActive(e);
    } catch { setError('Could not load consent history.'); setConsent([]); setActive(e); }
  }

  async function setConsentFlag(granted: boolean) {
    try {
      await marketingApi.recordConsent(active, channel, granted, 'gdpr_toolbox');
      const r = await marketingApi.gdprConsentHistory(active);
      setConsent(r.consent);
    } catch { setError('Could not record consent.'); }
  }

  async function doErase() {
    try {
      const r = await marketingApi.gdprErase(active);
      setErased(r.affected);
      setConfirmErase(false);
      const c = await marketingApi.gdprConsentHistory(active);
      setConsent(c.consent);
    } catch { setError('Erasure failed.'); }
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">GDPR toolbox</h1>
        <Link className="btn" to={`/c/${slug}/marketing`}>Campaigns</Link>
      </div>
      <p className="muted">Look up a customer by email to export their data, record consent, or erase their personal information.</p>
      {error && <div className="error">{error}</div>}

      <div className="mkt-inline-form">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" onKeyDown={(e) => e.key === 'Enter' && lookup()} />
        <button className="btn" onClick={lookup} disabled={!email.trim()}>Look up</button>
      </div>

      {active && consent !== null && (
        <>
          <section className="mkt-wh-section">
            <h2>{active}</h2>
            <a className="btn" href={marketingApi.gdprExportUrl(active)}>Download data export (JSON)</a>
          </section>

          <section className="mkt-wh-section">
            <h2>Consent</h2>
            {canEdit && (
              <div className="mkt-inline-form">
                <select value={channel} onChange={(e) => setChannel(e.target.value as ConsentChannel)}>
                  <option value="all">All channels</option>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
                <button className="btn" onClick={() => setConsentFlag(true)}>Record opt-in</button>
                <button className="btn" onClick={() => setConsentFlag(false)}>Record opt-out</button>
              </div>
            )}
            {consent.length === 0 ? (
              <div className="pm-empty">No consent records for this email.</div>
            ) : (
              <table className="pm-table">
                <thead><tr><th>Channel</th><th>Consent</th><th>Source</th><th>When</th></tr></thead>
                <tbody>
                  {consent.map((c) => (
                    <tr key={c.id}>
                      <td>{c.channel}</td>
                      <td>{c.granted ? 'Opted in' : 'Opted out'}</td>
                      <td>{c.source ?? '—'}</td>
                      <td>{dateTime(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {canDelete && (
            <section className="mkt-wh-section">
              <h2>Right to erasure</h2>
              {erased ? (
                <div className="mkt-secret-callout">
                  <strong>Personal data anonymized for {active}.</strong>
                  <div className="mkt-hint">
                    CRM {erased.crm_customers} · notes {erased.crm_notes} · sales {erased.sales} · bookings {erased.bookings} · sends {erased.campaign_sends}
                  </div>
                </div>
              ) : !confirmErase ? (
                <button className="btn btn-danger" onClick={() => setConfirmErase(true)}>Erase personal data…</button>
              ) : (
                <div className="mkt-erase-confirm">
                  <p>This anonymizes {active} across CRM, sales, bookings and sends. Financial records are kept but stripped of personal data. This cannot be undone.</p>
                  <button className="btn btn-danger" onClick={doErase}>Yes, erase</button>
                  <button className="btn" onClick={() => setConfirmErase(false)}>Cancel</button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
