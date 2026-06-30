import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { bookingApi, type VendorBooking, type VendorResource, type VendorService } from '../api';
import { formatTime, isoDatePlus } from '../format';
import { BookingStatusPill } from '../components/BookingStatusPill';
import { BookingDetailDrawer } from './BookingDetailDrawer';
import { ManualBookingDrawer } from './ManualBookingDrawer';

interface Props { slug: string; perms: ReadonlySet<string>; }

// Day view: one column per resource, that day's bookings as time-ordered cards.
export default function CalendarPage({ slug, perms }: Props) {
  const canCreate = perms.has('booking.customers.create');
  const [date, setDate] = useState(isoDatePlus(0));
  const [resources, setResources] = useState<VendorResource[]>([]);
  const [services, setServices] = useState<VendorService[]>([]);
  const [bookings, setBookings] = useState<VendorBooking[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ resourceId?: string } | null>(null);

  function reload() {
    bookingApi.list(new URLSearchParams({ from: date, to: date }).toString())
      .then((r) => setBookings(r.bookings)).catch(() => setBookings([]));
  }
  useEffect(() => {
    bookingApi.listResources().then((r) => setResources(r.resources.filter((x) => x.active))).catch(() => {});
    bookingApi.listServices().then((r) => setServices(r.services)).catch(() => {});
  }, []);
  useEffect(reload, [date]);

  const byResource = (rid: string) => (bookings ?? []).filter((b) => b.resource_id === rid).sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <div className="page booking-vendor">
      <div className="booking-cal-head">
        <h1 className="page-title">Calendar</h1>
        <div className="booking-cal-controls">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Link className="btn btn-ghost" to="list">List view</Link>
          {canCreate ? <button className="btn btn-primary" onClick={() => setCreating({})}>+ New booking</button> : null}
        </div>
      </div>

      {!bookings ? <div className="muted">Loading…</div> : resources.length === 0 ? (
        <p className="muted">No resources yet. Add one in <Link to="resources">Resources</Link>.</p>
      ) : (
        <div className="booking-cal-grid" style={{ gridTemplateColumns: `repeat(${resources.length}, minmax(160px, 1fr))` }}>
          {resources.map((r) => (
            <div key={r.id} className="booking-cal-col">
              <div className="booking-cal-col-head">{r.name}</div>
              {byResource(r.id).map((b) => (
                <button key={b.id} className="card booking-cal-card" onClick={() => setOpenId(b.id)}>
                  <span className="booking-cal-time">{formatTime(b.start_at)}–{formatTime(b.end_at)}</span>
                  <span>{b.customer_name ?? 'Blocked'}</span>
                  <BookingStatusPill status={b.status} />
                </button>
              ))}
              {byResource(r.id).length === 0 ? <span className="muted booking-cal-empty">—</span> : null}
            </div>
          ))}
        </div>
      )}

      {openId ? <BookingDetailDrawer bookingId={openId} perms={perms} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
      {creating ? <ManualBookingDrawer services={services} resources={resources} defaultResourceId={creating.resourceId}
        onClose={() => setCreating(null)} onCreated={reload} /> : null}
    </div>
  );
}
