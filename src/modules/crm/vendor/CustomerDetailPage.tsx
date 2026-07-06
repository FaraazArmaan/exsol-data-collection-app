import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { crmApi, type CustomerDetail, type CrmNote } from '../api';
import { money, dateTime } from '../format';

export function CustomerDetailPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const { id = '' } = useParams();
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const canCreate = perms.has('crm.customers.create');
  const canEdit = perms.has('crm.customers.edit');
  const canDelete = perms.has('crm.customers.delete');

  async function load() {
    try { setError(null); setData(await crmApi.getCustomer(id)); }
    catch { setError('Could not load this customer.'); }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addNote() {
    if (!noteBody.trim()) return;
    setBusy(true);
    try { setNoteError(null); await crmApi.addNote(id, noteBody.trim()); setNoteBody(''); await load(); }
    catch { setNoteError('Could not add the note. Try again.'); }
    finally { setBusy(false); }
  }
  async function editNote(n: CrmNote) {
    const next = window.prompt('Edit note', n.body);
    if (next == null || !next.trim()) return;
    try { setNoteError(null); await crmApi.editNote(n.id, next.trim()); await load(); }
    catch { setNoteError('Could not update the note.'); }
  }
  async function deleteNote(n: CrmNote) {
    try { setNoteError(null); await crmApi.deleteNote(n.id); await load(); }
    catch { setNoteError('Could not delete the note.'); }
  }

  if (error) return <div className="page"><Link to={`/c/${slug}/crm`}>← Customers</Link><div className="error">{error}</div></div>;
  if (!data) return <div className="page"><div className="muted">Loading…</div></div>;
  const { customer, notes, timeline } = data;

  return (
    <div className="page">
      <Link to={`/c/${slug}/crm`}>← Customers</Link>
      <h1 className="page-title">{customer.display_name}</h1>
      <p className="muted">
        {customer.phone ?? '—'} · {customer.email ?? '—'} · <span className="crm-source-pill">{customer.source}</span>
        {' · '}first seen {dateTime(customer.first_seen)} · last seen {dateTime(customer.last_seen)}
      </p>

      <h2>Activity</h2>
      {timeline.length === 0 ? <div className="pm-empty">No activity yet.</div> : (
        <ul className="crm-timeline">
          {timeline.map((e) => (
            <li key={`${e.kind}-${e.id}`}>
              <span>{e.kind === 'sale' ? '🧾' : '📅'} {e.label} · {e.status}</span>
              <span>{money(e.amount_cents)} · {dateTime(e.when)}</span>
            </li>
          ))}
        </ul>
      )}

      <h2>Notes</h2>
      {noteError && <div className="error">{noteError}</div>}
      {canCreate && (
        <div className="crm-note-form">
          <input value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Add a note…" />
          <button className="btn" onClick={addNote} disabled={busy || !noteBody.trim()}>Add</button>
        </div>
      )}
      {notes.length === 0 ? <div className="pm-empty">No notes yet.</div> : notes.map((n) => (
        <div className="crm-note" key={n.id}>
          <div>{n.body}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {dateTime(n.created_at)}
            {canEdit && <button className="pm-link" onClick={() => editNote(n)}> · Edit</button>}
            {canDelete && <button className="pm-link" onClick={() => deleteNote(n)}> · Delete</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
