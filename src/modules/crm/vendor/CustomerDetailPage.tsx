import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { crmApi, type CrmCustomer, type StreamEvent, type TimelineKind } from '../shared/api';
import { money, dateTime } from '../format';
import { RepeatCartModal } from '../components/RepeatCartModal';
import '../crm.css';

const KIND_META: Record<TimelineKind, { icon: string; label: string; cls: string }> = {
  sale: { icon: '🧾', label: 'Sales', cls: 'crm-stream-sale' },
  booking: { icon: '📅', label: 'Bookings', cls: 'crm-stream-booking' },
  note: { icon: '📝', label: 'Notes', cls: 'crm-stream-note' },
  email: { icon: '✉️', label: 'Emails', cls: 'crm-stream-email' },
  campaign: { icon: '📣', label: 'Campaigns', cls: 'crm-stream-campaign' },
};
const ALL_KINDS: TimelineKind[] = ['sale', 'booking', 'note', 'email', 'campaign'];

export function CustomerDetailPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const { id = '' } = useParams();
  const [customer, setCustomer] = useState<CrmCustomer | null>(null);
  const [events, setEvents] = useState<StreamEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<TimelineKind>>(new Set());
  const [showRepeat, setShowRepeat] = useState(false);

  const canCreate = perms.has('crm.customers.create');
  const canEdit = perms.has('crm.customers.edit');
  const canDelete = perms.has('crm.customers.delete');

  async function loadStream() {
    const t = await crmApi.timeline(id);
    setEvents(t.events);
  }
  useEffect(() => {
    setError(null); setCustomer(null); setEvents(null);
    Promise.all([
      crmApi.getCustomer(id).then((d) => setCustomer(d.customer)),
      loadStream(),
    ]).catch(() => setError('Could not load this customer.'));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addNote() {
    if (!noteBody.trim()) return;
    setBusy(true);
    try { setNoteError(null); await crmApi.addNote(id, noteBody.trim()); setNoteBody(''); await loadStream(); }
    catch { setNoteError('Could not add the note.'); }
    finally { setBusy(false); }
  }
  async function editNote(e: StreamEvent) {
    const next = window.prompt('Edit note', e.subtitle ?? '');
    if (next == null || !next.trim()) return;
    try { setNoteError(null); await crmApi.editNote(e.id, next.trim()); await loadStream(); }
    catch { setNoteError('Could not update the note.'); }
  }
  async function deleteNote(e: StreamEvent) {
    try { setNoteError(null); await crmApi.deleteNote(e.id); await loadStream(); }
    catch { setNoteError('Could not delete the note.'); }
  }
  function toggleKind(k: TimelineKind) {
    setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }

  if (error) return <div className="page"><Link to={`/c/${slug}/crm`}>← Customers</Link><div className="error">{error}</div></div>;
  if (!customer || events === null) return <div className="page"><div className="muted">Loading…</div></div>;

  const visible = events.filter((e) => !hidden.has(e.kind));

  return (
    <div className="page">
      <Link to={`/c/${slug}/crm`}>← Customers</Link>
      <h1 className="page-title">{customer.display_name}</h1>
      <p className="muted">
        {customer.phone ?? '—'} · {customer.email ?? '—'} · <span className="crm-source-pill">{customer.source}</span>
        {' · '}first seen {dateTime(customer.first_seen)} · last seen {dateTime(customer.last_seen)}
      </p>

      <button className="btn btn-primary" onClick={() => setShowRepeat(true)}>🛒 Repeat order</button>
      {showRepeat && <RepeatCartModal customerId={id} slug={slug} onClose={() => setShowRepeat(false)} />}

      <h2 className="crm-section-title">Communication timeline</h2>
      {noteError && <div className="error">{noteError}</div>}
      {canCreate && (
        <div className="crm-note-form">
          <input
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="Add a note…"
            onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
          />
          <button className="btn" onClick={addNote} disabled={busy || !noteBody.trim()}>Add note</button>
        </div>
      )}

      <div className="crm-kind-filter">
        {ALL_KINDS.map((k) => (
          <button
            key={k}
            className={`crm-kind-chip ${hidden.has(k) ? '' : 'crm-kind-chip-on'}`}
            onClick={() => toggleKind(k)}
          >
            {KIND_META[k].icon} {KIND_META[k].label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="pm-empty">No activity to show.</div>
      ) : (
        <ul className="crm-stream">
          {visible.map((e) => (
            <li key={`${e.kind}-${e.id}`} className={`crm-stream-item ${KIND_META[e.kind].cls}`}>
              <span className="crm-stream-icon">{KIND_META[e.kind].icon}</span>
              <div className="crm-stream-body">
                <div className="crm-stream-title">
                  {e.title}{e.status ? ` · ${e.status}` : ''}
                  {e.editable && canEdit && <button className="pm-link" onClick={() => editNote(e)}> · Edit</button>}
                  {e.editable && canDelete && <button className="pm-link" onClick={() => deleteNote(e)}> · Delete</button>}
                </div>
                {e.subtitle && <div className="crm-stream-sub">{e.subtitle}</div>}
              </div>
              <div className="crm-stream-meta">
                {e.amount_cents != null && <span className="crm-stream-amt">{money(e.amount_cents)}</span>}
                <span className="crm-stream-when">{dateTime(e.when)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
