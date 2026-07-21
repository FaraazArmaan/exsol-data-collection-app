import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  bookingApi,
  type VendorBooking,
  type VendorResource,
  type VendorService,
  type BookingSettings,
} from '../shared/api';
import { formatTime, isoDatePlus } from '../format';
import { BookingDetailDrawer } from './BookingDetailDrawer';
import { ManualBookingDrawer } from './ManualBookingDrawer';
import { BookingTabs } from './BookingTabs';
import { DateField } from '../../../components/ui/DateTimeField';
import { Button } from '../../../components/ui/Button';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

const PX_PER_MIN = 1.4; // ~84px/hour
const RESOURCE_PAGE_SIZE = 8;
const WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const localMin = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};
const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function weekOf(dateStr: string): string[] {
  const d = new Date(`${dateStr}T12:00:00`);
  const start = new Date(d);
  start.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    return localDate(x.toISOString());
  });
}

// Greedy lane-packing so concurrent bookings in one day column sit side by side.
function packDay(
  events: VendorBooking[],
): Array<{ b: VendorBooking; lane: number; lanes: number }> {
  const sorted = [...events].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const laneEnds: number[] = [];
  const rows = sorted.map((b) => {
    const s = localMin(b.start_at),
      e = localMin(b.end_at);
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else {
      laneEnds[lane] = e;
    }
    return { b, lane };
  });
  const lanes = Math.max(1, laneEnds.length);
  return rows.map((r) => ({ ...r, lanes }));
}

export default function CalendarPage({ slug, perms }: Props) {
  const canCreate = perms.has('booking.customers.create');
  const canConfigure = perms.has('booking.employees.view');
  const [view, setView] = useState<'day' | 'week'>('day');
  const [date, setDate] = useState(isoDatePlus(0));
  const [resources, setResources] = useState<VendorResource[]>([]);
  const [services, setServices] = useState<VendorService[]>([]);
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [bookings, setBookings] = useState<VendorBooking[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mobileResourceId, setMobileResourceId] = useState<string | null>(null);
  const [resourcePage, setResourcePage] = useState(0);
  const [creating, setCreating] = useState<{ resourceId?: string; defaultStart?: string } | null>(
    null,
  );

  const days = weekOf(date);
  function reload() {
    const range = view === 'week' ? { from: days[0]!, to: days[6]! } : { from: date, to: date };
    bookingApi
      .list(new URLSearchParams(range).toString())
      .then((r) => setBookings(r.bookings))
      .catch(() => setBookings([]));
  }
  useEffect(() => {
    bookingApi
      .listResources()
      .then((r) => setResources(r.resources.filter((x) => x.active)))
      .catch(() => {});
    bookingApi
      .listServices()
      .then((r) => setServices(r.services))
      .catch(() => {});
    bookingApi
      .getSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);
  useEffect(reload, [date, view]); // eslint-disable-line

  const resName = (rid: string) => resources.find((r) => r.id === rid)?.name ?? '';
  const byResource = (rid: string) => (bookings ?? []).filter((b) => b.resource_id === rid);
  const interval = settings?.slot_interval_min ?? 30;

  // Time window. Day: the selected weekday's hours. Week: union of all weekdays' hours.
  // Both expand to cover any off-grid bookings so nothing is clipped.
  let gStart = 9 * 60,
    gEnd = 18 * 60;
  if (settings) {
    const wins =
      view === 'week'
        ? Object.values(settings.weekly_schedule).flat()
        : (settings.weekly_schedule[WEEKDAY[new Date(`${date}T12:00:00`).getDay()]!] ?? []);
    if (wins.length) {
      gStart = Math.min(...wins.map((w) => toMin(w.open)));
      gEnd = Math.max(...wins.map((w) => toMin(w.close)));
    }
  }
  for (const b of bookings ?? []) {
    gStart = Math.min(gStart, localMin(b.start_at));
    gEnd = Math.max(gEnd, localMin(b.end_at));
  }
  gStart = Math.floor(gStart / 60) * 60;
  gEnd = Math.ceil(gEnd / 60) * 60;
  const gridH = Math.max(120, (gEnd - gStart) * PX_PER_MIN);
  const hours: number[] = [];
  for (let h = gStart; h <= gEnd; h += 60) hours.push(h);

  function snapAt(e: React.MouseEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return gStart + Math.round((e.clientY - rect.top) / PX_PER_MIN / interval) * interval;
  }
  const posStyle = (b: VendorBooking, lane = 0, lanes = 1) => ({
    top: (localMin(b.start_at) - gStart) * PX_PER_MIN,
    height: Math.max(34, (localMin(b.end_at) - localMin(b.start_at)) * PX_PER_MIN - 2),
    left: `calc(${(lane * 100) / lanes}% + 3px)`,
    width: `calc(${100 / lanes}% - 6px)`,
    right: 'auto' as const,
  });
  const mobileDays = Array.from({ length: 7 }, (_, index) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + index - 3);
    return localDate(d.toISOString());
  });
  const mobileBookings = (bookings ?? [])
    .filter((booking) => localDate(booking.start_at) === date)
    .filter((booking) => !mobileResourceId || booking.resource_id === mobileResourceId)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const resourcePageCount = Math.max(1, Math.ceil(resources.length / RESOURCE_PAGE_SIZE));
  const safeResourcePage = Math.min(resourcePage, resourcePageCount - 1);
  const visibleResources = resources.slice(
    safeResourcePage * RESOURCE_PAGE_SIZE,
    safeResourcePage * RESOURCE_PAGE_SIZE + RESOURCE_PAGE_SIZE,
  );

  return (
    <div className="page page-canvas booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <div className="booking-cal-head">
        <h1 className="page-title">Calendar</h1>
        <div className="booking-cal-controls">
          <div className="booking-viewtoggle">
            <button className={view === 'day' ? 'is-active' : ''} onClick={() => setView('day')}>
              Day
            </button>
            <button className={view === 'week' ? 'is-active' : ''} onClick={() => setView('week')}>
              Week
            </button>
          </div>
          <DateField label="Calendar date" value={date} onChange={setDate} />
          <Link className="btn btn-ghost" to="list">
            List view
          </Link>
          {canCreate ? (
            <button className="btn btn-primary" onClick={() => setCreating({})}>
              + New booking
            </button>
          ) : null}
        </div>
      </div>

      {bookings && settings && resources.length > 0 ? (
        <section className="booking-mobile-agenda" aria-label="Daily booking agenda">
          <div className="booking-mobile-agenda__days" aria-label="Choose calendar day">
            {mobileDays.map((day) => {
              const dayDate = new Date(`${day}T12:00:00`);
              return (
                <button
                  key={day}
                  className={day === date ? 'is-active' : ''}
                  aria-pressed={day === date}
                  onClick={() => setDate(day)}
                >
                  <span>{dayDate.toLocaleDateString([], { weekday: 'short' })}</span>
                  <strong>{dayDate.getDate()}</strong>
                </button>
              );
            })}
          </div>
          <div className="booking-mobile-agenda__filters" aria-label="Filter by staff member">
            <button
              className={mobileResourceId === null ? 'is-active' : ''}
              aria-pressed={mobileResourceId === null}
              onClick={() => setMobileResourceId(null)}
            >
              All staff
            </button>
            {resources.map((resource) => (
              <button
                key={resource.id}
                className={mobileResourceId === resource.id ? 'is-active' : ''}
                aria-pressed={mobileResourceId === resource.id}
                onClick={() => setMobileResourceId(resource.id)}
              >
                {resource.name}
              </button>
            ))}
          </div>
          {mobileBookings.length ? (
            <ol className="booking-mobile-agenda__list">
              {mobileBookings.map((booking) => (
                <li key={booking.id}>
                  <time>{formatTime(booking.start_at)}</time>
                  <button
                    className={`booking-mobile-agenda__booking block-${booking.status}`}
                    onClick={() => setOpenId(booking.id)}
                  >
                    <strong>{booking.customer_name ?? 'Blocked time'}</strong>
                    <span>{resName(booking.resource_id)} · {formatTime(booking.start_at)}–{formatTime(booking.end_at)}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="booking-mobile-agenda__empty">No bookings for this day.</p>
          )}
        </section>
      ) : null}

      {!bookings || !settings ? (
        <div className="muted">Loading…</div>
      ) : view === 'week' ? (
        <div
          className="booking-grid"
          style={{ gridTemplateColumns: `56px repeat(7, minmax(120px, 1fr))` }}
        >
          <div className="booking-grid-corner" />
          {days.map((d) => {
            const dd = new Date(`${d}T12:00:00`);
            return (
              <button
                key={d}
                className={`booking-grid-colhead booking-week-head${d === date ? ' is-today' : ''}`}
                onClick={() => {
                  setDate(d);
                  setView('day');
                }}
              >
                <span>{dd.toLocaleDateString([], { weekday: 'short' })}</span>
                <strong>{dd.getDate()}</strong>
              </button>
            );
          })}
          <div className="booking-grid-gutter" style={{ height: gridH }}>
            {hours.map((h) => (
              <span
                key={h}
                className="booking-grid-hourlabel"
                style={{ top: (h - gStart) * PX_PER_MIN }}
              >
                {pad(Math.floor(h / 60))}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const packed = packDay((bookings ?? []).filter((b) => localDate(b.start_at) === d));
            return (
              <div
                key={d}
                className="booking-grid-col"
                style={{ height: gridH }}
                onClick={(e) => {
                  if (canCreate) {
                    const m = snapAt(e);
                    setCreating({ defaultStart: `${d}T${pad(Math.floor(m / 60))}:${pad(m % 60)}` });
                  }
                }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="booking-grid-line"
                    style={{ top: (h - gStart) * PX_PER_MIN }}
                  />
                ))}
                {packed.map(({ b, lane, lanes }) => (
                  <button
                    key={b.id}
                    className={`booking-grid-block block-${b.status}`}
                    style={posStyle(b, lane, lanes)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenId(b.id);
                    }}
                  >
                    <span className="booking-grid-block-time">{formatTime(b.start_at)}</span>
                    <span className="booking-grid-block-name">{b.customer_name ?? 'Blocked'}</span>
                    {lanes === 1 ? (
                      <span className="booking-week-res">{resName(b.resource_id)}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : resources.length === 0 ? (
        <p className="muted">
          No booking capacity has been configured yet.{' '}
          {canConfigure ? (
            <>
              Complete <Link to="setup">Booking Setup</Link>.
            </>
          ) : (
            'Ask a workspace administrator to complete Booking Setup.'
          )}
        </p>
      ) : (
        <>
          {resources.length > RESOURCE_PAGE_SIZE ? (
            <div className="booking-resource-pager" aria-label="Visible staff in calendar">
              <div>
                <strong>Staff</strong>
                <span aria-live="polite">
                  Showing {safeResourcePage * RESOURCE_PAGE_SIZE + 1}–
                  {Math.min((safeResourcePage + 1) * RESOURCE_PAGE_SIZE, resources.length)} of {resources.length}
                </span>
              </div>
              <div className="booking-resource-pager__actions">
                <Button
                  size="compact"
                  variant="secondary"
                  disabled={safeResourcePage === 0}
                  onClick={() => setResourcePage((page) => Math.max(0, page - 1))}
                >
                  Previous staff
                </Button>
                <Button
                  size="compact"
                  variant="secondary"
                  disabled={safeResourcePage === resourcePageCount - 1}
                  onClick={() => setResourcePage((page) => Math.min(resourcePageCount - 1, page + 1))}
                >
                  Next staff
                </Button>
              </div>
            </div>
          ) : null}
          <div
            className="booking-grid"
            style={{ gridTemplateColumns: `56px repeat(${visibleResources.length}, minmax(140px, 1fr))` }}
          >
          <div className="booking-grid-corner" />
          {visibleResources.map((r) => (
            <div key={r.id} className="booking-grid-colhead">
              {r.name}
            </div>
          ))}
          <div className="booking-grid-gutter" style={{ height: gridH }}>
            {hours.map((h) => (
              <span
                key={h}
                className="booking-grid-hourlabel"
                style={{ top: (h - gStart) * PX_PER_MIN }}
              >
                {pad(Math.floor(h / 60))}:00
              </span>
            ))}
          </div>
          {visibleResources.map((r) => (
            <div
              key={r.id}
              className="booking-grid-col"
              style={{ height: gridH }}
              onClick={(e) => {
                if (canCreate) {
                  const m = snapAt(e);
                  setCreating({
                    resourceId: r.id,
                    defaultStart: `${date}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`,
                  });
                }
              }}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="booking-grid-line"
                  style={{ top: (h - gStart) * PX_PER_MIN }}
                />
              ))}
              {byResource(r.id).map((b) => (
                <button
                  key={b.id}
                  className={`booking-grid-block block-${b.status}`}
                  style={posStyle(b)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenId(b.id);
                  }}
                >
                  <span className="booking-grid-block-time">
                    {formatTime(b.start_at)}–{formatTime(b.end_at)}
                  </span>
                  <span className="booking-grid-block-name">
                    {b.customer_name ?? 'Blocked time'}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
        </>
      )}

      {openId ? (
        <BookingDetailDrawer
          bookingId={openId}
          perms={perms}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      ) : null}
      {creating ? (
        <ManualBookingDrawer
          services={services}
          resources={resources}
          defaultResourceId={creating.resourceId}
          defaultStart={creating.defaultStart}
          onClose={() => setCreating(null)}
          onCreated={reload}
        />
      ) : null}
    </div>
  );
}
