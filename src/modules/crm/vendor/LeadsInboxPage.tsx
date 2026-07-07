import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { crmApi, type CrmLead, type LeadCounts, type LeadStatus } from '../shared/api';
import { dateTime } from '../format';
import { CrmNav } from '../components/CrmNav';
import '../crm.css';

const STATUSES: LeadStatus[] = ['new', 'converted', 'archived'];

export function LeadsInboxPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const [status, setStatus] = useState<LeadStatus>('new');
  const [leads, setLeads] = useState<CrmLead[] | null>(null);
  const [counts, setCounts] = useState<LeadCounts>({ new: 0, converted: 0, archived: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canConvert = perms.has('crm.customers.create');
  const canArchive = perms.has('crm.customers.edit');

  async function load(s: LeadStatus) {
    try { setError(null); const r = await crmApi.listLeads(s); setLeads(r.leads); setCounts(r.counts); }
    catch { setError('Could not load leads.'); setLeads([]); }
  }
  useEffect(() => { setLeads(null); load(status); }, [status]);

  async function act(lead: CrmLead, action: 'convert' | 'archive') {
    setBusyId(lead.id);
    try { await crmApi.leadAction(lead.id, action); await load(status); }
    catch { setError(`Could not ${action} this lead.`); }
    finally { setBusyId(null); }
  }

  const publicLink = `${window.location.origin}/c/${slug}/lead`;

  return (
    <div className="page">
      <h1 className="page-title">CRM</h1>
      <CrmNav slug={slug} />

      <div className="crm-lead-topbar">
        <div className="crm-kind-filter">
          {STATUSES.map((s) => (
            <button key={s} className={`crm-kind-chip ${status === s ? 'crm-kind-chip-on' : ''}`} onClick={() => setStatus(s)}>
              {s} ({counts[s]})
            </button>
          ))}
        </div>
        <a className="btn" href={publicLink} target="_blank" rel="noreferrer">Open public form ↗</a>
      </div>

      {error && <div className="error">{error}</div>}
      {leads === null && <div className="muted">Loading…</div>}
      {leads !== null && leads.length === 0 && !error && (
        <div className="muted" style={{ marginTop: 16 }}>
          {status === 'new' ? 'No new leads. Share your public form to collect some.' : `No ${status} leads.`}
        </div>
      )}
      {leads !== null && leads.map((l) => (
        <div className="crm-lead-card" key={l.id}>
          <div className="crm-lead-head">
            <div>
              <span className="crm-lead-name">{l.name}</span>{' '}
              <span className={`crm-badge crm-badge-${l.status}`}>{l.status}</span>
              <div className="crm-lead-contact">{l.phone ?? '—'} · {l.email ?? '—'} · {dateTime(l.created_at)}</div>
            </div>
            {l.status === 'new' && (
              <div className="crm-lead-actions">
                {canConvert && <button className="btn btn-primary" disabled={busyId === l.id} onClick={() => act(l, 'convert')}>Convert</button>}
                {canArchive && <button className="btn" disabled={busyId === l.id} onClick={() => act(l, 'archive')}>Archive</button>}
              </div>
            )}
            {l.status === 'converted' && l.converted_customer_id && (
              <Link className="btn" to={`/c/${slug}/crm/${l.converted_customer_id}`}>View customer →</Link>
            )}
          </div>
          {l.message && <p className="crm-lead-msg">{l.message}</p>}
        </div>
      ))}
    </div>
  );
}
