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

  return (
    <div className="page booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <h1 className="page-title">Bookings</h1>
      <div className="booking-filters">
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
        <Field label="Status">{(props) => <Select {...props} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
        </Select>}</Field>
      </div>

      {loadError ? <TableErrorState title="Could not load bookings." action={<Button variant="secondary" onClick={reload}>Retry</Button>}>Check your connection and try again.</TableErrorState>
        : !bookings ? <TableLoadingState title="Loading bookings…" />
          : bookings.length === 0 ? <TableEmptyState title="No bookings in this range.">Change the dates or status to see other bookings.</TableEmptyState>
            : <TableFrame caption="Bookings in the selected date range" density="compact">
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
        </TableFrame>}

      {openId ? <BookingDetailDrawer bookingId={openId} perms={perms} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
    </div>
  );
}
