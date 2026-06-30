import { useEffect, useState } from 'react';
import { bookingApi, type VendorBooking, type BookingAction } from '../api';
import { formatRupees, formatTime, formatDateLong } from '../format';
import { BookingStatusPill } from '../components/BookingStatusPill';

interface Props { bookingId: string; perms: ReadonlySet<string>; onClose: () => void; onChanged: () => void; }

// Which FSM actions the current status permits (mirrors the server FSM ALLOWED_FROM).
function allowedActions(status: string): BookingAction[] {
  if (status === 'pending' || status === 'confirmed') {
    return status === 'confirmed' ? ['complete', 'noShow', 'cancel'] : ['cancel'];
  }
  if (status === 'blocked') return ['unblock'];
  return [];
}
const LABEL: Record<BookingAction, string> = { cancel: 'Cancel', complete: 'Mark completed', noShow: 'Mark no-show', unblock: 'Unblock' };

export function BookingDetailDrawer({ bookingId, perms, onClose, onChanged }: Props) {
  const canEdit = perms.has('booking.customers.edit');
  const [b, setB] = useState<VendorBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { bookingApi.get(bookingId).then(setB).catch(() => setError('not_found')); }, [bookingId]);

  async function act(action: BookingAction) {
    setBusy(true); setError(null);
    try { await bookingApi.transition(bookingId, action); onChanged(); onClose(); }
    catch (e: any) { setError(e?.code ?? 'error'); setBusy(false); }
  }

  return (
    <aside role="dialog" aria-label="Booking detail" className="pos-drawer booking-drawer">
      <div className="booking-drawer-head">
        <h2 className="section-title">Booking</h2>
        <button className="btn btn-ghost" onClick={onClose}>✕</button>
      </div>
      {error === 'not_found' ? <p className="error">Not found.</p>
        : !b ? <div className="muted">Loading…</div>
        : (
          <>
            <BookingStatusPill status={b.status} />
            <div className="muted">{formatDateLong(b.start_at)} · {formatTime(b.start_at)}–{formatTime(b.end_at)}</div>
            {b.customer_name ? <div><strong>{b.customer_name}</strong>{b.customer_phone ? ` · ${b.customer_phone}` : ''}</div> : <div className="muted">Blocked time</div>}
            <div>{formatRupees(b.price_cents)}</div>
            {error && error !== 'not_found' ? <p className="error">Couldn’t apply ({error}).</p> : null}
            {canEdit ? (
              <div className="booking-actions">
                {allowedActions(b.status).map((a) => (
                  <button key={a} className={`btn ${a === 'cancel' ? 'btn-danger' : 'btn-secondary'}`} disabled={busy} onClick={() => act(a)}>{LABEL[a]}</button>
                ))}
              </div>
            ) : null}
          </>
        )}
    </aside>
  );
}
