import { useEffect, useState } from 'react';
import { bookingApi, type VendorBooking, type BookingAction } from '../shared/api';
import { Overlay } from '../../../components/ui/Overlay';
import { Button } from '../../../components/ui/Button';
import { InlineNotice, LoadingState } from '../../../components/ui/Feedback';
import { DateField, TimeField } from '../../../components/ui/DateTimeField';
import { formatRupees, formatTime, formatDateLong } from '../format';
import { BookingStatusPill } from '../components/BookingStatusPill';

interface Props {
  bookingId: string;
  perms: ReadonlySet<string>;
  onClose: () => void;
  onChanged: () => void;
}

// Which FSM actions the current status permits (mirrors the server FSM ALLOWED_FROM).
function allowedActions(status: string): BookingAction[] {
  if (status === 'pending' || status === 'confirmed') {
    return status === 'confirmed' ? ['complete', 'noShow', 'cancel'] : ['cancel'];
  }
  if (status === 'blocked') return ['unblock'];
  return [];
}
const LABEL: Record<BookingAction, string> = {
  cancel: 'Cancel',
  complete: 'Mark completed',
  noShow: 'Mark no-show',
  unblock: 'Unblock',
};
const canReschedule = (status: string) => status === 'pending' || status === 'confirmed';
function toLocalParts(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

export function BookingDetailDrawer({ bookingId, perms, onClose, onChanged }: Props) {
  const canEdit = perms.has('booking.customers.edit');
  const [b, setB] = useState<VendorBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newStart, setNewStart] = useState<{ date: string; time: string } | null>(null);

  useEffect(() => {
    bookingApi
      .get(bookingId)
      .then(setB)
      .catch(() => setError('not_found'));
  }, [bookingId]);

  async function act(action: BookingAction) {
    setBusy(true);
    setError(null);
    try {
      await bookingApi.transition(bookingId, action);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.code ?? 'error');
      setBusy(false);
    }
  }
  async function reschedule() {
    if (!newStart?.date || !newStart.time) return;
    setBusy(true);
    setError(null);
    try {
      await bookingApi.reschedule(bookingId, new Date(`${newStart.date}T${newStart.time}`).toISOString());
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.code === 'slot_taken' ? 'That time is taken' : (e?.code ?? 'error'));
      setBusy(false);
    }
  }
  async function recordCash() {
    setBusy(true);
    setError(null);
    try {
      await bookingApi.recordCash(bookingId);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.code ?? 'error');
      setBusy(false);
    }
  }
  async function checkIn() {
    setBusy(true);
    setError(null);
    try {
      await bookingApi.checkIn(bookingId);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.code ?? 'error');
      setBusy(false);
    }
  }

  return (
    <Overlay open title="Booking detail" onClose={onClose} variant="drawer">
      {error === 'not_found' ? (
        <InlineNotice tone="danger" title="This booking is no longer available." />
      ) : !b ? (
        <LoadingState title="Loading booking…" />
      ) : (
        <div className="ui-detail">
          <section className="ui-detail__summary" aria-label="Booking summary">
            <BookingStatusPill status={b.status} />
            <p className="ui-detail__meta">{formatDateLong(b.start_at)} · {formatTime(b.start_at)}–{formatTime(b.end_at)}</p>
            {b.customer_name ? <div className="ui-detail__customer">{b.customer_name}{b.customer_phone ? ` · ${b.customer_phone}` : ''}</div> : <div className="ui-detail__customer">Blocked time</div>}
            <div className="ui-detail__amount">{formatRupees(b.price_cents)}</div>
            {b.payment_status ? <p className="ui-detail__supporting">Payment: {b.payment_status.replaceAll('_', ' ')}</p> : null}
          </section>
          {error && error !== 'not_found' ? (
            <InlineNotice tone="danger" title="Couldn’t update this booking.">{error}</InlineNotice>
          ) : null}
          {canEdit ? (
            <section className="ui-detail__section" aria-labelledby="booking-actions-heading">
              <h3 id="booking-actions-heading">Appointment actions</h3>
              <div className="ui-action-group">
              {allowedActions(b.status).map((a) => (
                <Button
                  key={a}
                  variant={a === 'complete' ? 'primary' : a === 'cancel' ? 'danger' : 'secondary'}
                  disabled={busy}
                  onClick={() => act(a)}
                >
                  {LABEL[a]}
                </Button>
              ))}
              {canReschedule(b.status) && newStart === null ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setNewStart(toLocalParts(b.start_at))}
                >
                  Reschedule
                </Button>
              ) : null}
              {b.status === 'confirmed' ? (
                <Button variant="secondary" disabled={busy} onClick={checkIn}>
                  Check in
                </Button>
              ) : null}
              </div>
            </section>
          ) : null}
          {canEdit && b.payment_status && !['paid', 'refunded', 'waived'].includes(b.payment_status) ? (
            <section className="ui-detail__section" aria-labelledby="booking-payment-heading">
              <h3 id="booking-payment-heading">Payment</h3>
              <div className="ui-action-group">
                <Button variant="secondary" disabled={busy} onClick={recordCash}>Record cash received</Button>
              </div>
            </section>
          ) : null}
          {canEdit && newStart !== null ? (
            <section className="ui-detail__section ui-inline-form" aria-labelledby="booking-reschedule-heading">
              <h3 id="booking-reschedule-heading">Reschedule appointment</h3>
              <div className="booking-date-time-fields">
                <DateField label="New appointment date" value={newStart.date} onChange={(date) => setNewStart((current) => current && { ...current, date })} required />
                <TimeField label="New appointment time" value={newStart.time} onChange={(time) => setNewStart((current) => current && { ...current, time })} required stepMinutes={15} />
              </div>
              <div className="ui-inline-form__actions">
                <Button variant="primary" disabled={busy} onClick={reschedule}>Save time</Button>
                <Button variant="quiet" disabled={busy} onClick={() => setNewStart(null)}>Cancel</Button>
              </div>
            </section>
          ) : null}
          {b.events?.length ? (
            <section className="ui-detail__section" aria-labelledby="booking-history-heading">
              <h3 id="booking-history-heading">History</h3>
              <ul className="ui-timeline">
                {b.events.map((event) => (
                  <li key={event.id}>
                    <strong>{event.event_type.replaceAll('_', ' ')}</strong>
                    <span className="ui-timeline__meta">{new Date(event.created_at).toLocaleString()}{event.reason ? ` · ${event.reason}` : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Overlay>
  );
}
