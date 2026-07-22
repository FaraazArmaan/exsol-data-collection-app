import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { warehouseApi } from '../../shared/api';
import {
  CADENCES, SEVERITIES, type Cadence, type SafetyChecklist, type SafetyIncident, type Severity,
} from '../../shared/types';
import { Button } from '../../../../components/ui/Button';
import { ErrorState } from '../../../../components/ui/Feedback';

interface Props {
  perms: ReadonlySet<string>;
}

// Safety: an incident log + recurring checklists with signoff. Two panels, each
// with create + act flows. Every state handled (loading/empty/error).
export default function SafetyTab({ perms }: Props) {
  const [incidents, setIncidents] = useState<SafetyIncident[] | null>(null);
  const [checklists, setChecklists] = useState<SafetyChecklist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incModal, setIncModal] = useState(false);
  const [chkModal, setChkModal] = useState(false);

  const canCreate = perms.has('warehouse.business.create');
  const canEdit = perms.has('warehouse.business.edit');
  const canDelete = perms.has('warehouse.business.delete');

  const load = useCallback(() => {
    setError(null);
    warehouseApi.safetyIncidents('all').then((r) => setIncidents(r.incidents)).catch((e) => {
      setIncidents([]); setError(e instanceof Error ? e.message : String(e));
    });
    warehouseApi.safetyChecklists().then((r) => setChecklists(r.checklists)).catch((e) => {
      setChecklists([]); setError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const openIncidentCount = incidents?.filter((incident) => incident.status === 'open').length ?? 0;
  const dueChecklistCount = checklists?.filter((checklist) => checklist.due).length ?? 0;

  return (
    <div>
      {error && <ErrorState title="Safety information could not load" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</ErrorState>}
      {(openIncidentCount > 0 || dueChecklistCount > 0) && (
        <section className="wh-priority" aria-label="Safety attention needed">
          <div><strong>Needs attention</strong><p>{openIncidentCount > 0 && `${openIncidentCount} open incident${openIncidentCount === 1 ? '' : 's'}`}{openIncidentCount > 0 && dueChecklistCount > 0 ? ' · ' : ''}{dueChecklistCount > 0 && `${dueChecklistCount} checklist${dueChecklistCount === 1 ? '' : 's'} due`}</p></div>
        </section>
      )}

      <section className="wh-panel">
        <div className="wh-panel-head">
          <h2 className="wh-panel-title">Incident log</h2>
          {canCreate && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIncModal(true)}>Log incident</button>
          )}
        </div>
        {incidents === null ? (
          <p className="wh-muted">Loading…</p>
        ) : incidents.length === 0 ? (
          <p className="wh-empty">No incidents logged. A clean record — keep it that way.</p>
        ) : (
          <table className="wh-table">
            <thead>
              <tr><th>Date</th><th>Severity</th><th>Title</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id}>
                  <td className="wh-muted">{i.occurred_on}</td>
                  <td><span className={`wh-sev wh-sev-${i.severity}`}>{i.severity}</span></td>
                  <td>{i.title}</td>
                  <td><span className={`wh-pill wh-pill-${i.status === 'open' ? 'pending' : 'received'}`}>{i.status}</span></td>
                  <td className="wh-num">
                    {canEdit && i.status === 'open' && (
                      <button type="button" className="wh-link" onClick={() => act(() => warehouseApi.safetyIncidentUpdate(i.id, { status: 'closed' }))}>Close</button>
                    )}
                    {canDelete && (
                      <button type="button" className="wh-link wh-link-danger" onClick={() => {
                        if (window.confirm('Delete this incident?')) act(() => warehouseApi.safetyIncidentDelete(i.id));
                      }}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="wh-panel">
        <div className="wh-panel-head">
          <h2 className="wh-panel-title">Recurring checklists</h2>
          {canCreate && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChkModal(true)}>New checklist</button>
          )}
        </div>
        {checklists === null ? (
          <p className="wh-muted">Loading…</p>
        ) : checklists.length === 0 ? (
          <p className="wh-empty">No checklists yet. Add a recurring safety check to track signoffs.</p>
        ) : (
          <ul className="wh-loc-list">
            {checklists.map((c) => (
              <li key={c.id} className="wh-loc-row">
                <div>
                  <span className="wh-loc-name">{c.title}</span>
                  <span className="wh-badge">{c.cadence}</span>
                  {c.due
                    ? <span className="wh-sev wh-sev-high">Due</span>
                    : <span className="wh-sev wh-sev-low">Up to date</span>}
                  {c.last_signed_at && (
                    <span className="wh-muted wh-signed"> · last signed {new Date(c.last_signed_at).toLocaleDateString()}</span>
                  )}
                </div>
                {canEdit && (
                  <div className="wh-loc-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(() => warehouseApi.safetySignoff({ checklist_id: c.id }))}>
                      Sign off
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {incModal && <IncidentModal onClose={() => setIncModal(false)} onSaved={() => { setIncModal(false); load(); }} />}
      {chkModal && <ChecklistModal onClose={() => setChkModal(false)} onSaved={() => { setChkModal(false); load(); }} />}
    </div>
  );
}

function IncidentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Severity>('low');
  const [occurredOn, setOccurredOn] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await warehouseApi.safetyIncidentCreate({
        title: title.trim(), severity,
        occurred_on: occurredOn || undefined,
        description: description.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="wh-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wh-modal" role="dialog" aria-modal="true" aria-label="Log incident">
        <h2 className="wh-modal-title">Log incident</h2>
        <form onSubmit={submit}>
          <label className="wh-field">
            <span>Title</span>
            <input className="wh-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Forklift near-miss" autoFocus />
          </label>
          <div className="wh-field-row">
            <label className="wh-field">
              <span>Severity</span>
              <select className="wh-input" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="wh-field">
              <span>Occurred on</span>
              <input className="wh-input" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
            </label>
          </div>
          <label className="wh-field">
            <span>Description</span>
            <textarea className="wh-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened?" />
          </label>
          {error && <p className="wh-error" role="alert">{error}</p>}
          <div className="wh-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!title.trim() || busy}>{busy ? 'Saving…' : 'Log incident'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChecklistModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState<Cadence>('weekly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await warehouseApi.safetyChecklistCreate({ title: title.trim(), cadence });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="wh-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wh-modal" role="dialog" aria-modal="true" aria-label="New checklist">
        <h2 className="wh-modal-title">New checklist</h2>
        <form onSubmit={submit}>
          <label className="wh-field">
            <span>Title</span>
            <input className="wh-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fire-exit inspection" autoFocus />
          </label>
          <label className="wh-field">
            <span>Cadence</span>
            <select className="wh-input" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
              {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {error && <p className="wh-error" role="alert">{error}</p>}
          <div className="wh-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!title.trim() || busy}>{busy ? 'Saving…' : 'Create checklist'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
