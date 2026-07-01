import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { bookingApi, type VendorBooking, type VendorResource, type VendorService, type BookingSettings } from '../api';
import { formatTime, isoDatePlus } from '../format';
import { BookingDetailDrawer } from './BookingDetailDrawer';
import { ManualBookingDrawer } from './ManualBookingDrawer';
import { BookingTabs } from './BookingTabs';

interface Props { slug: string; perms: ReadonlySet<string>; }

const PX_PER_MIN = 1.4;                 // vertical scale of the time grid (~84px/hour)
const WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const localMin = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

// Day-view time grid: columns = resources, rows = time. Bookings are positioned
// blocks (top = start, height = duration). Click a block → detail; click empty
// column space → new booking pre-filled at that resource + snapped time.
export default function CalendarPage({ slug, perms }: Props) {
  const canCreate = perms.has('booking.customers.create');
  const [date, setDate] = useState(isoDatePlus(0));
  const [resources, setResources] = useState<VendorResource[]>([]);
  const [services, setServices] = useState<VendorService[]>([]);
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [bookings, setBookings] = useState<VendorBooking[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ resourceId?: string; defaultStart?: string } | null>(null);

  function reload() {
    bookingApi.list(new URLSearchParams({ from: date, to: date }).toString())
      .then((r) => setBookings(r.bookings)).catch(() => setBookings([]));
  }
  useEffect(() => {
    bookingApi.listResources().then((r) => setResources(r.resources.filter((x) => x.active))).catch(() => {});
    bookingApi.listServices().then((r) => setServices(r.services)).catch(() => {});
    bookingApi.getSettings().then(setSettings).catch(() => {});
  }, []);
  useEffect(reload, [date]);

  const byResource = (rid: string) => (bookings ?? []).filter((b) => b.resource_id === rid);
  const interval = settings?.slot_interval_min ?? 30;

  // Grid time window: the weekday's open window, expanded to cover any off-grid bookings.
  const wd = WEEKDAY[new Date(`${date}T12:00:00`).getDay()]!;
  const wins = settings?.weekly_schedule?.[wd] ?? [];
  let dayStart = wins.length ? Math.min(...wins.map((w) => toMin(w.open))) : 9 * 60;
  let dayEnd = wins.length ? Math.max(...wins.map((w) => toMin(w.close))) : 18 * 60;
  for (const b of bookings ?? []) { dayStart = Math.min(dayStart, localMin(b.start_at)); dayEnd = Math.max(dayEnd, localMin(b.end_at)); }
  dayStart = Math.floor(dayStart / 60) * 60; dayEnd = Math.ceil(dayEnd / 60) * 60;
  const gridH = Math.max(120, (dayEnd - dayStart) * PX_PER_MIN);
  const hours: number[] = [];
  for (let h = dayStart; h <= dayEnd; h += 60) hours.push(h);

  function createAt(resourceId: string, e: React.MouseEvent<HTMLDivElement>) {
    if (!canCreate) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const snapped = dayStart + Math.round(((e.clientY - rect.top) / PX_PER_MIN) / interval) * interval;
    setCreating({ resourceId, defaultStart: `${date}T${pad(Math.floor(snapped / 60))}:${pad(snapped % 60)}` });
  }

  return (
    <div className="page booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <div className="booking-cal-head">
        <h1 className="page-title">Calendar</h1>
        <div className="booking-cal-controls">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Link className="btn btn-ghost" to="list">List view</Link>
          {canCreate ? <button className="btn btn-primary" onClick={() => setCreating({})}>+ New booking</button> : null}
        </div>
      </div>

      {!bookings || !settings ? <div className="muted">Loading…</div> : resources.length === 0 ? (
        <p className="muted">No resources yet. Add one in <Link to="resources">Resources</Link>.</p>
      ) : (
        <div className="booking-grid" style={{ gridTemplateColumns: `56px repeat(${resources.length}, minmax(140px, 1fr))` }}>
          <div className="booking-grid-corner" />
          {resources.map((r) => <div key={r.id} className="booking-grid-colhead">{r.name}</div>)}

          <div className="booking-grid-gutter" style={{ height: gridH }}>
            {hours.map((h) => (
              <span key={h} className="booking-grid-hourlabel" style={{ top: (h - dayStart) * PX_PER_MIN }}>{pad(Math.floor(h / 60))}:00</span>
            ))}
          </div>
          {resources.map((r) => (
            <div key={r.id} className="booking-grid-col" style={{ height: gridH }} onClick={(e) => createAt(r.id, e)}>
              {hours.map((h) => <div key={h} className="booking-grid-line" style={{ top: (h - dayStart) * PX_PER_MIN }} />)}
              {byResource(r.id).map((b) => {
                const top = (localMin(b.start_at) - dayStart) * PX_PER_MIN;
                const height = Math.max(38, (localMin(b.end_at) - localMin(b.start_at)) * PX_PER_MIN - 2);
                return (
                  <button key={b.id} className={`booking-grid-block block-${b.status}`} style={{ top, height }}
                    onClick={(e) => { e.stopPropagation(); setOpenId(b.id); }}>
                    <span className="booking-grid-block-time">{formatTime(b.start_at)}–{formatTime(b.end_at)}</span>
                    <span className="booking-grid-block-name">{b.customer_name ?? 'Blocked time'}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {openId ? <BookingDetailDrawer bookingId={openId} perms={perms} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
      {creating ? <ManualBookingDrawer services={services} resources={resources} defaultResourceId={creating.resourceId}
        defaultStart={creating.defaultStart} onClose={() => setCreating(null)} onCreated={reload} /> : null}
    </div>
  );
}

function toMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); }
