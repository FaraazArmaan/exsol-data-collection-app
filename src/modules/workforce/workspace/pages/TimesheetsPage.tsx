import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { workforceApi, type TimesheetEntry, type StaffResource } from '../../api';
import '../../workforce.css';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// ---------- Week helpers (Monday-anchored) ----------

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatWeekLabel(monday: Date): string {
  const day = monday.getDate();
  const month = MONTH_NAMES[monday.getMonth()];
  const year = monday.getFullYear();
  return `Week of ${DAY_NAMES[monday.getDay()]} ${String(day).padStart(2, '0')} ${month} ${year}`;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ---------- Sub-components ----------

function ApprovedBadge() {
  return <span className="wf-ts-approved-badge">Approved</span>;
}

function EntryRow({
  entry,
  canApprove,
  canDelete,
  onApprove,
  onDelete,
}: {
  entry: TimesheetEntry;
  canApprove: boolean;
  canDelete: boolean;
  onApprove: () => void;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleApprove() {
    setBusy(true);
    try { await onApprove(); } finally { setBusy(false); }
  }

  async function handleDelete() {
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
  }

  const isApproved = !!entry.approved_at;

  return (
    <div className="wf-ts-entry-row">
      <span className="wf-ts-entry-date">{entry.entry_date}</span>
      <span className="wf-ts-entry-time">
        {entry.start_time.slice(0, 5)}–{entry.end_time.slice(0, 5)}
      </span>
      <span className="wf-ts-entry-notes">{entry.notes ?? '—'}</span>
      <span className="wf-ts-entry-actions">
        {isApproved
          ? <ApprovedBadge />
          : canApprove && (
            <button
              className="wf-ts-action-btn approve"
              onClick={handleApprove}
              disabled={busy}
            >
              Approve
            </button>
          )
        }
        {!isApproved && canDelete && (
          <button
            className="wf-ts-action-btn delete"
            onClick={handleDelete}
            disabled={busy}
          >
            Delete
          </button>
        )}
      </span>
    </div>
  );
}

function LogEntryForm({
  resources,
  onLogged,
}: {
  resources: StaffResource[];
  onLogged: () => void;
}) {
  const today = toISODate(new Date());
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '');
  const [entryDate, setEntryDate] = useState(today);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Keep default resource in sync if resources load after mount
  useEffect(() => {
    if (!resourceId && resources[0]) setResourceId(resources[0].id);
  }, [resources, resourceId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!resourceId) return;
    setSaving(true);
    setError('');
    try {
      await workforceApi.logTimesheet({
        resource_id: resourceId,
        entry_date: entryDate,
        start_time: startTime,
        end_time: endTime,
        notes: notes.trim() || undefined,
      });
      setNotes('');
      onLogged();
    } catch {
      setError('Could not log entry. Check the times and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wf-ts-log-form">
      <h4>Log entry</h4>
      <form onSubmit={submit} className="wf-ts-log-form-fields">
        <select
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          required
        >
          {resources.length === 0 && <option value="">No resources</option>}
          {resources.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)}
          required
        />
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
        />
        <span>to</span>
        <input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          required
        />
        <textarea
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={1}
        />
        <button type="submit" disabled={saving || !resourceId}>
          {saving ? 'Saving…' : 'Log'}
        </button>
      </form>
      {error && <p className="wf-error">{error}</p>}
    </div>
  );
}

// ---------- Main Page ----------

export default function TimesheetsPage({ slug, perms }: Props) {
  const canCreate = perms.has('workforce.employees.create');
  const canApprove = perms.has('workforce.employees.edit');
  const canDelete = perms.has('workforce.employees.delete');

  const [monday, setMonday] = useState<Date>(() => getMonday(new Date()));
  const [entries, setEntries] = useState<TimesheetEntry[] | null>(null);
  const [resources, setResources] = useState<StaffResource[]>([]);
  const [error, setError] = useState('');

  const weekStart = toISODate(monday);
  const weekEnd = toISODate(addDays(monday, 6));

  function loadEntries() {
    setEntries(null);
    setError('');
    workforceApi.listTimesheets({ from: weekStart, to: weekEnd })
      .then((r) => setEntries(r.entries))
      .catch(() => { setEntries([]); setError('Failed to load timesheet entries.'); });
  }

  useEffect(() => {
    workforceApi.listStaff()
      .then((r) => setResources(r.resources))
      .catch(() => setResources([]));
  }, []);

  useEffect(loadEntries, [weekStart, weekEnd]);

  function prevWeek() { setMonday((m) => getMonday(addDays(m, -7))); }
  function nextWeek() { setMonday((m) => getMonday(addDays(m, 7))); }

  // Group by resource_name (fall back to resource_id)
  const grouped = new Map<string, { label: string; entries: TimesheetEntry[] }>();
  for (const e of entries ?? []) {
    const key = e.resource_id;
    const label = e.resource_name ?? e.resource_id;
    if (!grouped.has(key)) grouped.set(key, { label, entries: [] });
    grouped.get(key)!.entries.push(e);
  }

  return (
    <div className="wf-page">
      <div className="wf-tabs">
        <Link to={`/c/${slug}/workforce`} className="wf-tab" style={{ textDecoration: 'none' }}>
          Staff & Schedule
        </Link>
        <button className="wf-tab active">Timesheets</button>
        <Link to={`/c/${slug}/workforce/projects`} className="wf-tab" style={{ textDecoration: 'none' }}>
          Projects
        </Link>
      </div>

      <h1>Timesheets</h1>

      <div className="wf-ts-week-nav">
        <button onClick={prevWeek}>&#8249;</button>
        <span>{formatWeekLabel(monday)}</span>
        <button onClick={nextWeek}>&#8250;</button>
      </div>

      {error && <p className="wf-error">{error}</p>}

      {entries === null && <p>Loading…</p>}

      {entries !== null && grouped.size === 0 && (
        <p className="wf-empty">No entries this week.</p>
      )}

      {entries !== null && grouped.size > 0 && (
        <div className="wf-ts-entries">
          {[...grouped.entries()].map(([resourceId, { label, entries: rowEntries }]) => (
            <div key={resourceId} className="wf-ts-resource-section">
              <h4>{label}</h4>
              {rowEntries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  canApprove={canApprove}
                  canDelete={canDelete}
                  onApprove={() =>
                    workforceApi.updateTimesheet(entry.id, { approve: true }).then(loadEntries)
                  }
                  onDelete={() =>
                    workforceApi.deleteTimesheet(entry.id).then(loadEntries)
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {canCreate && <LogEntryForm resources={resources} onLogged={loadEntries} />}
    </div>
  );
}
