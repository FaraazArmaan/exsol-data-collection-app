import { useEffect, useState } from 'react';
import { bookingApi, BookingApiError, type BookingSettings } from '../api';

const DAYS: Array<[string, string]> = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];

interface Props { slug: string; perms: ReadonlySet<string>; }

export default function SettingsPage({ perms }: Props) {
  const canEdit = perms.has('booking.employees.edit');
  const [s, setS] = useState<BookingSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { bookingApi.getSettings().then(setS).catch(() => setError('load_error')); }, []);
  if (error === 'load_error') return <p className="error">Couldn’t load settings.</p>;
  if (!s) return <div className="muted">Loading…</div>;

  function setDay(day: string, open: string, close: string) {
    setS((prev) => prev && ({ ...prev, weekly_schedule: { ...prev.weekly_schedule, [day]: open && close ? [{ open, close }] : [] } }));
  }
  function win(day: string) { return s!.weekly_schedule[day]?.[0] ?? { open: '', close: '' }; }

  async function save() {
    if (!s) return;
    setSaving(true); setSaved(false); setError(null);
    try { const updated = await bookingApi.putSettings(s); setS(updated); setSaved(true); }
    catch (e) { setError(e instanceof BookingApiError ? e.code : 'save_error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="page booking-vendor">
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

      {error ? <p className="error">Couldn’t save ({error}).</p> : null}
      {saved ? <p className="muted">Saved.</p> : null}
      {canEdit ? <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        : <p className="muted">You have read-only access to settings.</p>}
    </div>
  );
}
