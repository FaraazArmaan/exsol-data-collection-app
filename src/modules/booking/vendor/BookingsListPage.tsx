import { useEffect, useState } from 'react';
import { bookingApi, type VendorBooking } from '../shared/api';
import { formatRupees, formatTime, formatDateLong, isoDatePlus } from '../format';
import { BookingStatusPill } from '../components/BookingStatusPill';
import { BookingDetailDrawer } from './BookingDetailDrawer';
import { BookingTabs } from './BookingTabs';
import { Button } from '../../../components/ui/Button';
import { Field, Select } from '../../../components/ui/Field';
import { DateField } from '../../../components/ui/DateTimeField';
import { TableEmptyState, TableErrorState, TableFrame, TableLoadingState } from '../../../components/ui/Table';

interface Props { slug: string; perms: ReadonlySet<string>; }
const STATUSES = ['', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'blocked'];

export default function BookingsListPage({ slug, perms }: Props) {
  const [from, setFrom] = useState(isoDatePlus(0));
  const [to, setTo] = useState(isoDatePlus(30));
  const [status, setStatus] = useState('');
  const [bookings, setBookings] = useState<VendorBooking[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function reload() {
    setBookings(null);
    setLoadError(false);
    const p = new URLSearchParams({ from, to });
    if (status) p.set('status', status);
    bookingApi.list(p.toString()).then((r) => setBookings(r.bookings)).catch(() => setLoadError(true));
  }
  useEffect(reload, [from, to, status]);
  const mobileGroups = (bookings ?? []).reduce<Array<{ date: string; bookings: VendorBooking[] }>>(
    (groups, booking) => {
      const date = formatDateLong(booking.start_at);
      const group = groups.find((item) => item.date === date);
      if (group) group.bookings.push(booking);
      else groups.push({ date, bookings: [booking] });
      return groups;
    },
    [],
  );

  return (
    <div className="page page-canvas booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <h1 className="page-title">Bookings</h1>
      <div className="booking-filters">
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
        <Field label="Status">{(props) => <Select {...props} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </Select>}</Field>
      </div>

      <div className="booking-mobile-status-filters" aria-label="Booking status filters">
        {[
          ['', 'All'],
          ['confirmed', 'Confirmed'],
          ['pending', 'Pending'],
          ['completed', 'Completed'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={status === value ? 'is-active' : ''}
            aria-pressed={status === value}
            onClick={() => setStatus(value ?? '')}
          >
            {label}
          </button>
        ))}
      </div>

      {loadError ? <TableErrorState title="Could not load bookings." action={<Button variant="secondary" onClick={reload}>Retry</Button>}>Check your connection and try again.</TableErrorState>
        : !bookings ? <TableLoadingState title="Loading bookings…" />
          : bookings.length === 0 ? <TableEmptyState title="No bookings in this range.">Change the dates or status to see other bookings.</TableEmptyState>
            : <>
          <div className="booking-mobile-booking-list" aria-label="Bookings in the selected date range">
            {mobileGroups.map((group) => (
              <section key={group.date} aria-labelledby={`booking-day-${group.date.replaceAll(' ', '-')}`}>
                <h2 id={`booking-day-${group.date.replaceAll(' ', '-')}`}>{group.date}</h2>
                {group.bookings.sort((a, b) => a.start_at.localeCompare(b.start_at)).map((booking) => (
                  <Button
                    key={booking.id}
                    variant="secondary"
                    className={`booking-mobile-booking-card booking-mobile-booking-card--${booking.status}`}
                    onClick={() => setOpenId(booking.id)}
                    aria-label={`View details for ${booking.customer_name ?? 'blocked time'} on ${formatDateLong(booking.start_at)}`}
                  >
                    <span className="booking-mobile-booking-card__main">
                      <strong>{booking.customer_name ?? 'Blocked time'}</strong>
                      <span>{formatTime(booking.start_at)}–{formatTime(booking.end_at)}</span>
                    </span>
                    <span className="booking-mobile-booking-card__meta">
                      <span>{booking.status.replaceAll('_', ' ')}</span>
                      <span>{formatRupees(booking.price_cents)}</span>
                    </span>
                  </Button>
                ))}
              </section>
            ))}
          </div>
          <div className="booking-desktop-table"><TableFrame caption="Bookings in the selected date range" density="compact">
          <thead><tr><th>Date</th><th>Time</th><th>Customer</th><th>Status</th><th>Price</th><th>Actions</th></tr></thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id}>
                <td>{formatDateLong(b.start_at)}</td>
                <td>{formatTime(b.start_at)}–{formatTime(b.end_at)}</td>
                <td>{b.customer_name ?? <span className="muted">— blocked —</span>}</td>
                <td><BookingStatusPill status={b.status} /></td>
                <td>{formatRupees(b.price_cents)}</td>
                <td><Button size="compact" variant="secondary" onClick={() => setOpenId(b.id)} aria-label={`View details for booking on ${formatDateLong(b.start_at)}`}>View details</Button></td>
              </tr>
            ))}
          </tbody>
        </TableFrame></div>
        </>}

      {openId ? <BookingDetailDrawer bookingId={openId} perms={perms} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
    </div>
  );
}
