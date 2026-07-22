import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  bookingApi,
  BookingApiError,
  type BookingSettings,
  type BookingSetup,
} from '../shared/api';
import { BookingTabs } from './BookingTabs';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { DateField, TimeField } from '../../../components/ui/DateTimeField';
import { ErrorState, InlineNotice, LoadingState } from '../../../components/ui/Feedback';

const DAYS: Array<[string, string]> = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
];

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

export default function SettingsPage({ slug, perms }: Props) {
  const canEdit = perms.has('booking.employees.edit');
  const [s, setS] = useState<BookingSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [setup, setSetup] = useState<BookingSetup | null>(null);

  function loadSettings() {
    setError(null);
    bookingApi.getSettings().then(setS).catch(() => setError('load_error'));
  }
  useEffect(() => { loadSettings(); }, []);
  useEffect(() => {
    bookingApi
      .getSetup()
      .then(setSetup)
      .catch(() => {});
  }, []);
  if (error === 'load_error') return <div className="page page-readable booking-vendor"><BookingTabs slug={slug} perms={perms} /><h1 className="page-title">Booking settings</h1><ErrorState title="Couldn’t load settings." action={<Button size="compact" onClick={loadSettings}>Try again</Button>} /></div>;
  if (!s) return <div className="page page-readable booking-vendor"><BookingTabs slug={slug} perms={perms} /><h1 className="page-title">Booking settings</h1><LoadingState title="Loading settings…" /></div>;

  function setDay(day: string, open: string, close: string) {
    setS(
      (prev) =>
        prev && {
          ...prev,
          weekly_schedule: {
            ...prev.weekly_schedule,
            [day]: open && close ? [{ open, close }] : [],
          },
        },
    );
  }
  function win(day: string) {
    return s!.weekly_schedule[day]?.[0] ?? { open: '', close: '' };
  }

  function setOpen(day: string, open: boolean) {
    setDay(day, open ? '09:00' : '', open ? '17:00' : '');
  }

  function addClosedDate() {
    if (!newDate) return;
    setS((prev) => {
      if (!prev) return prev;
      if (prev.date_overrides.some((o) => o.date === newDate)) return prev; // no dupes
      return {
        ...prev,
        date_overrides: [...prev.date_overrides, { date: newDate, closed: true }].sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
      };
    });
    setNewDate('');
  }
  function removeOverride(date: string) {
    setS(
      (prev) =>
        prev && { ...prev, date_overrides: prev.date_overrides.filter((o) => o.date !== date) },
    );
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await bookingApi.putSettings(s);
      setS(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof BookingApiError ? e.code : 'save_error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page page-readable booking-vendor booking-settings-page">
      <BookingTabs slug={slug} perms={perms} />
      <h1 className="page-title">Booking settings</h1>

      <div className="card booking-settings-timing">
        <h2 className="section-title">Grid & timing</h2>
        <label>
          Slot interval (min)
          <input
            type="number"
            min={5}
            max={240}
            value={s.slot_interval_min}
            disabled={!canEdit}
            onChange={(e) => setS({ ...s, slot_interval_min: Number(e.target.value) })}
          />
        </label>
        <label>
          Minimum lead time (min)
          <input
            type="number"
            min={0}
            value={s.lead_time_min}
            disabled={!canEdit}
            onChange={(e) => setS({ ...s, lead_time_min: Number(e.target.value) })}
          />
        </label>
        <label>
          Cancellation cutoff (min before start)
          <input
            type="number"
            min={0}
            value={s.cancel_cutoff_min}
            disabled={!canEdit}
            onChange={(e) => setS({ ...s, cancel_cutoff_min: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="card booking-settings-business">
        <h2 className="section-title">Business hours</h2>
        {setup?.availability_source === 'workforce' &&
        setup.booking_party_mode !== 'nobody_specific' ? (
          <div className="booking-settings-notice">
            <strong>Team availability also requires Workforce shifts.</strong> These business hours
            limit online bookings, but they do not make a team member available by themselves. A
            customer sees a time only where these hours overlap an active staff shift and approved
            leave does not block it.{' '}
            <Link to={`/c/${slug}/workforce`}>Open Staff &amp; Schedule</Link>.
          </div>
        ) : (
          <p className="muted">Customers can book only inside the open hours selected below.</p>
        )}
        <div className="ui-schedule-panel" aria-label="Weekly business hours">
          <div className="ui-schedule-head" aria-hidden="true"><span>Day</span><span>Availability</span><span>Opens</span><span>Closes</span></div>
          {DAYS.map(([key, label]) => {
            const w = win(key);
            const isOpen = Boolean(w.open && w.close);
            return (
              <div key={key} className="ui-schedule-row">
                <span className="ui-schedule-day">{label}</span>
                <div className="ui-segmented-control" aria-label={`${label} availability`}>
                  <Button type="button" size="compact" variant={!isOpen ? 'primary' : 'secondary'} disabled={!canEdit} aria-label={`Set ${label} closed`} aria-pressed={!isOpen} onClick={() => setOpen(key, false)}>Closed</Button>
                  <Button type="button" size="compact" variant={isOpen ? 'primary' : 'secondary'} disabled={!canEdit} aria-label={`Set ${label} open`} aria-pressed={isOpen} onClick={() => setOpen(key, true)}>Open</Button>
                </div>
                {isOpen ? (
                  <>
                    <TimeField label={`${label} opening time`} labelHidden value={w.open} disabled={!canEdit} stepMinutes={15} onChange={(open) => setDay(key, open, w.close)} />
                    <TimeField label={`${label} closing time`} labelHidden value={w.close} disabled={!canEdit} stepMinutes={15} onChange={(close) => setDay(key, w.open, close)} />
                  </>
                ) : <>
                  <span className="ui-schedule-closed">—</span>
                  <span className="ui-schedule-closed">—</span>
                </>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card booking-settings-holidays">
        <h2 className="section-title">Closed dates (holidays)</h2>
        <ul className="booking-list-plain">
          {s.date_overrides
            .filter((o) => o.closed)
            .map((o) => (
              <li key={o.date}>
                <span>
                  {new Date(`${o.date}T12:00:00`).toLocaleDateString([], {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                {canEdit ? (
                  <button className="btn btn-ghost" onClick={() => removeOverride(o.date)}>
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          {s.date_overrides.filter((o) => o.closed).length === 0 ? (
            <li className="muted">No closed dates.</li>
          ) : null}
        </ul>
        {canEdit ? (
          <div className="booking-form-inline">
            <DateField label="Closed date" value={newDate} onChange={setNewDate} />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={addClosedDate}
              disabled={!newDate}
            >
              Add closed date
            </button>
          </div>
        ) : null}
        <p className="muted">
          Closed dates block all online bookings for that day. Remember to Save.
        </p>
      </div>

      {error ? <InlineNotice tone="danger" title={`Couldn’t save (${error}).`} /> : null}
      {saved ? <InlineNotice tone="success" title="Settings saved." /> : null}
      {canEdit ? (
        <Button className="booking-settings-save" variant="primary" onClick={save} loading={saving} loadingLabel="Saving settings…">Save settings</Button>
      ) : (
        <p className="muted">You have read-only access to settings.</p>
      )}
    </div>
  );
}
