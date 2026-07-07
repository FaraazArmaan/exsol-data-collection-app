import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { crmApi, type SocialCard, type SocialProvider } from '../shared/api';
import { dateTime } from '../format';
import { CrmNav } from '../components/CrmNav';
import '../crm.css';

export function SocialSyncPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const [cards, setCards] = useState<SocialCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const canEdit = perms.has('crm.customers.edit');

  async function load() {
    try { setError(null); const r = await crmApi.listSocial(); setCards(r.providers); }
    catch { setError('Could not load connections.'); setCards([]); }
  }
  useEffect(() => { void load(); }, []);

  async function act(provider: SocialProvider, action: 'connect' | 'disconnect' | 'import') {
    setBusy(provider); setMsg(null); setError(null);
    try {
      const r = await crmApi.socialAction(provider, action);
      setCards(r.providers);
      if (action === 'import') setMsg(`Imported ${r.imported ?? 0} contacts into Leads.`);
    } catch { setError(`Could not ${action}.`); }
    finally { setBusy(null); }
  }

  return (
    <div className="page">
      <h1 className="page-title">CRM</h1>
      <CrmNav slug={slug} />
      <p className="muted" style={{ marginBottom: 12 }}>
        Connect a contact source to import leads.{' '}
        <em>Demo mode — connections are simulated; imported contacts land in{' '}
          <Link to={`/c/${slug}/crm/leads`}>Leads</Link>.</em>
      </p>

      {error && <div className="error">{error}</div>}
      {msg && <div className="muted" style={{ color: 'var(--success)' }}>{msg}</div>}
      {cards === null && <div className="muted">Loading…</div>}

      {cards && (
        <div className="crm-social-grid">
          {cards.map((c) => (
            <div className="crm-social-card" key={c.provider}>
              <div className="crm-social-provider">{c.label}</div>
              <div className="crm-social-status">
                {c.status === 'connected'
                  ? <>✓ Connected{c.account_label ? ` · ${c.account_label}` : ''}</>
                  : 'Not connected'}
              </div>
              <div className="crm-social-status">
                {c.imported_total > 0 ? `${c.imported_total} contacts imported` : 'No imports yet'}
                {c.last_imported_at ? ` · ${dateTime(c.last_imported_at)}` : ''}
              </div>
              {canEdit && (
                <div className="crm-social-actions">
                  {c.status === 'disconnected' ? (
                    <button className="btn btn-primary" disabled={busy === c.provider} onClick={() => act(c.provider, 'connect')}>
                      Connect
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-primary" disabled={busy === c.provider} onClick={() => act(c.provider, 'import')}>
                        Import contacts
                      </button>
                      <button className="btn" disabled={busy === c.provider} onClick={() => act(c.provider, 'disconnect')}>
                        Disconnect
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
