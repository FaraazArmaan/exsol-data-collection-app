import { useEffect, useState } from 'react';
import { bookingApi, type VendorBooking } from '../shared/api';
import { formatRupees, formatTime, formatDateLong, isoDatePlus } from '../format';
import { BookingStatusPill } from '../components/BookingStatusPill';
import { BookingDetailDrawer } from './BookingDetailDrawer';
import { BookingTabs } from './BookingTabs';

interface Props { slug: string; perms: ReadonlySet<string>; }
const STATUSES = ['', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'blocked'];

export default function BookingsListPage({ slug, perms }: Props) {
  const [from, setFrom] = useState(isoDatePlus(0));
  const [to, setTo] = useState(isoDatePlus(30));
  const [status, setStatus] = useState('');
  const [bookings, setBookings] = useState<VendorBooking[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  function reload() {
    const p = new URLSearchParams({ from, to });
    if (status) p.set('status', status);
    bookingApi.list(p.toString()).then((r) => setBookings(r.bookings)).catch(() => setBookings([]));
  }
  useEffect(reload, [from, to, status]);

  return (
    <div className="page booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <h1 className="page-title">Bookings</h1>
      <div className="booking-filters">
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || 'all'}</option>)}
        </select></label>
      </div>

      {!bookings ? <div className="muted">Loading…</div> : (
        <table className="booking-table">
          <thead><tr><th>Date</th><th>Time</th><th>Customer</th><th>Status</th><th>Price</th></tr></thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id} onClick={() => setOpenId(b.id)} style={{ cursor: 'pointer' }}>
                <td>{formatDateLong(b.start_at)}</td>
                <td>{formatTime(b.start_at)}–{formatTime(b.end_at)}</td>
                <td>{b.customer_name ?? <span className="muted">— blocked —</span>}</td>
                <td><BookingStatusPill status={b.status} /></td>
                <td>{formatRupees(b.price_cents)}</td>
              </tr>
            ))}
            {bookings.length === 0 ? <tr><td colSpan={5} className="muted">No bookings in this range.</td></tr> : null}
          </tbody>
        </table>
      )}

      {openId ? <BookingDetailDrawer bookingId={openId} perms={perms} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
    </div>
  );
}
