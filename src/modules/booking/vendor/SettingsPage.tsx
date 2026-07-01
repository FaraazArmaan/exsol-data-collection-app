import { useEffect, useState } from 'react';
import { bookingApi, BookingApiError, type BookingSettings } from '../api';
import { BookingTabs } from './BookingTabs';

const DAYS: Array<[string, string]> = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];

interface Props { slug: string; perms: ReadonlySet<string>; }

export default function SettingsPage({ slug, perms }: Props) {
  const canEdit = perms.has('booking.employees.edit');
  const [s, setS] = useState<BookingSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newDate, setNewDate] = useState('');

  useEffect(() => { bookingApi.getSettings().then(setS).catch(() => setError('load_error')); }, []);
  if (error === 'load_error') return <p className="error">Couldn’t load settings.</p>;
  if (!s) return <div className="muted">Loading…</div>;

  function setDay(day: string, open: string, close: string) {
    setS((prev) => prev && ({ ...prev, weekly_schedule: { ...prev.weekly_schedule, [day]: open && close ? [{ open, close }] : [] } }));
  }
  function win(day: string) { return s!.weekly_schedule[day]?.[0] ?? { open: '', close: '' }; }

  function addClosedDate() {
    if (!newDate) return;
    setS((prev) => {
      if (!prev) return prev;
      if (prev.date_overrides.some((o) => o.date === newDate)) return prev; // no dupes
      return { ...prev, date_overrides: [...prev.date_overrides, { date: newDate, closed: true }].sort((a, b) => a.date.localeCompare(b.date)) };
    });
    setNewDate('');
  }
  function removeOverride(date: string) {
    setS((prev) => prev && ({ ...prev, date_overrides: prev.date_overrides.filter((o) => o.date !== date) }));
  }

  async function save() {
    if (!s) return;
    setSaving(true); setSaved(false); setError(null);
    try { const updated = await bookingApi.putSettings(s); setS(updated); setSaved(true); }
    catch (e) { setError(e instanceof BookingApiError ? e.code : 'save_error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="page booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <h1 className="page-title">Booking settings</h1>

      <div className="card">
        <h2 className="section-title">Grid & timing</h2>
        <label>Slot interval (min)<input type="number" min={5} max={240} value={s.slot_interval_min} disabled={!canEdit}
          onChange={(e) => setS({ ...s, slot_interval_min: Number(e.target.value) })} /></label>
        <label>Minimum lead time (min)<input type="number" min={0} value={s.lead_time_min} disabled={!canEdit}
          onChange={(e) => setS({ ...s, lead_time_min: Number(e.target.value) })} /></label>
        <label>Cancellation cutoff (min before start)<input type="number" min={0} value={s.cancel_cutoff_min} disabled={!canEdit}
          onChange={(e) => setS({ ...s, cancel_cutoff_min: Number(e.target.value) })} /></label>
      </div>

      <div className="card">
        <h2 className="section-title">Weekly hours</h2>
        {DAYS.map(([key, label]) => {
          const w = win(key);
          return (
            <div key={key} className="booking-day-row">
              <span className="booking-day-label">{label}</span>
              <input type="time" value={w.open} disabled={!canEdit} onChange={(e) => setDay(key, e.target.value, w.close)} />
              <span className="muted">to</span>
              <input type="time" value={w.close} disabled={!canEdit} onChange={(e) => setDay(key, w.open, e.target.value)} />
              {!w.open && !w.close ? <span className="muted">closed</span> : null}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2 className="section-title">Closed dates (holidays)</h2>
        <ul className="booking-list-plain">
          {s.date_overrides.filter((o) => o.closed).map((o) => (
            <li key={o.date}>
              <span>{new Date(`${o.date}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
              {canEdit ? <button className="btn btn-ghost" onClick={() => removeOverride(o.date)}>Remove</button> : null}
            </li>
          ))}
          {s.date_overrides.filter((o) => o.closed).length === 0 ? <li className="muted">No closed dates.</li> : null}
        </ul>
        {canEdit ? (
          <div className="booking-form-inline">
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            <button type="button" className="btn btn-secondary" onClick={addClosedDate} disabled={!newDate}>Add closed date</button>
          </div>
        ) : null}
        <p className="muted">Closed dates block all online bookings for that day. Remember to Save.</p>
      </div>

      {error ? <p className="error">Couldn’t save ({error}).</p> : null}
      {saved ? <p className="muted">Saved.</p> : null}
      {canEdit ? <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        : <p className="muted">You have read-only access to settings.</p>}
    </div>
  );
}
